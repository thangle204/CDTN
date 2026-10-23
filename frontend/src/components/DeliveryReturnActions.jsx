import { useState, useRef } from 'react';

export const isDeliveryReturnOrder = order => ['Giao thất bại', 'Đã xử lý hoàn hàng'].includes(order?.orderStatus);
export const canConfirmOrderRefund = order => Boolean(order?.isPaid && !order.paymentReviewRequired && order.refundStatus === 'pending'
  && !order.cancellationLock && (order.orderStatus === 'Đã hủy'
    || order.orderStatus === 'Đã xử lý hoàn hàng' && order.deliveryReturn?.state === 'completed' && order.deliveryReturn.refundAmount > 0));
const money = value => `${Number(value || 0).toLocaleString('vi-VN')} ₫`;
const itemLabel = item => `${item.name}${item.color ? ` · Màu ${item.color}` : ''}${item.size != null ? ` · Size ${item.size}` : ''}`;

export const DeliveryReturnSummary = ({ order, admin = false }) => {
  if (!isDeliveryReturnOrder(order)) return null;
  const returned = order.deliveryReturn;
  return <section className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2" aria-label="Thông tin giao thất bại và hoàn hàng">
    <h4 className="font-semibold text-orange-900">Giao thất bại / hàng quay về</h4>
    <p><strong>Lý do:</strong> {order.deliveryFailure?.reason || 'Chưa có thông tin'}</p>
    {admin && order.deliveryFailure?.notes && <p>Ghi chú giao hàng: {order.deliveryFailure.notes}</p>}
    {order.deliveryFailure?.failedAt && <p className="text-sm text-gray-600">Ghi nhận: {new Date(order.deliveryFailure.failedAt).toLocaleString('vi-VN')}</p>}
    {!returned?.state && <p>Đang chờ cửa hàng nhận lại và kiểm tra hàng. Chưa hoàn kho, chưa chốt tiền hoàn.</p>}
    {returned?.state === 'processing' && <p role="status" className="font-semibold text-orange-900">Đang xử lý kết quả kiểm hàng. Cửa hàng sẽ tiếp tục đối soát; chưa xác nhận hoàn tiền.</p>}
    {returned?.state === 'completed' && <p className="font-semibold text-green-800">Đã kiểm hàng và xử lý hàng quay về.</p>}
    {returned?.inspection?.length > 0 && <ul className="space-y-1">{returned.inspection.map(line => <li key={line.itemIndex}>
      {itemLabel(order.orderItems?.[line.itemIndex] || { name: `Sản phẩm ${line.itemIndex + 1}` })}: tốt {line.restockQuantity}, hỏng {line.damagedQuantity}, thất lạc {line.missingQuantity}.
    </li>)}</ul>}
    {returned?.state && <>
      <p>Phí giao ban đầu đã giữ lại: <strong>{money(returned.retainedShippingFee)}</strong></p>
      {admin && <p>Phí vận chuyển hàng quay về do cửa hàng chịu: <strong>{money(returned.returnShippingCost)}</strong></p>}
      {admin && returned.notes && <p>Ghi chú kiểm hàng: {returned.notes}</p>}
      <p><strong>Tiền hoàn cho khách: {money(returned.refundAmount)}</strong></p>
      {returned.state === 'completed' && (returned.refundAmount > 0
        ? <p>{order.refundStatus === 'refunded' ? 'Cửa hàng đã xác nhận hoàn tiền' : 'Đang chờ cửa hàng xử lý hoàn tiền'}{order.refundedAt && ` (${new Date(order.refundedAt).toLocaleString('vi-VN')})`}</p>
        : <p>Không phát sinh khoản hoàn tiền{!order.isPaid ? ' vì đơn chưa thanh toán' : ''}.</p>)}
    </>}
  </section>;
};

const DeliveryReturnActions = ({ order, busy = false, onMarkFailed, onSettleReturn }) => {
  const [mode, setMode] = useState('');
  const [reason, setReason] = useState('');
  const [failureNotes, setFailureNotes] = useState('');
  const [inspection, setInspection] = useState(() => (order.orderItems || []).map((_, itemIndex) => ({ itemIndex, restockQuantity: '', damagedQuantity: '', missingQuantity: '' })));
  const [returnShippingCost, setReturnShippingCost] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const frozen = order.deliveryReturn?.state === 'processing';
  const locked = busy || submitting || Boolean(order.cancellationLock);
  const paidShipping = order.isPaid ? Number(order.shippingPrice || 0) : 0;
  const refundAmount = order.isPaid ? Math.max(0, Number(order.totalPrice || 0) - paidShipping) : 0;
  const currentInspection = frozen ? order.deliveryReturn.inspection : inspection;
  const currentShippingCost = frozen ? order.deliveryReturn.returnShippingCost : returnShippingCost;
  const currentNotes = frozen ? order.deliveryReturn.notes || '' : returnNotes;
  const setLine = (itemIndex, field, value) => setInspection(previous => previous.map(line => line.itemIndex === itemIndex ? { ...line, [field]: value } : line));

  const submit = async event => {
    event.preventDefault();
    if (pending.current || locked) return;
    setError('');
    let callback;
    let payload;
    if (mode === 'failure' && order.orderStatus === 'Đang giao') {
      if (!reason.trim() || reason.trim().length > 300 || failureNotes.trim().length > 1000) {
        setError('Nhập lý do giao thất bại (tối đa 300 ký tự), ghi chú tối đa 1.000 ký tự.'); return;
      }
      if (!window.confirm('Ghi nhận giao thất bại? Đơn chưa được giao thành công; thao tác này không thu tiền COD và không tự hoàn kho.')) return;
      callback = onMarkFailed;
      payload = { reason: reason.trim(), notes: failureNotes.trim() };
    } else if (order.orderStatus === 'Giao thất bại' && (mode === 'inspection' || frozen)) {
      const lines = (currentInspection || []).map(line => ({ itemIndex: line.itemIndex,
        restockQuantity: Number(line.restockQuantity), damagedQuantity: Number(line.damagedQuantity), missingQuantity: Number(line.missingQuantity) }));
      const complete = lines.length === order.orderItems.length && lines.every((line, index) => {
        const original = currentInspection[index];
        return line.itemIndex === index && ['restockQuantity', 'damagedQuantity', 'missingQuantity'].every(field => original[field] !== '' && original[field] != null && Number.isSafeInteger(line[field]) && line[field] >= 0)
          && line.restockQuantity + line.damagedQuantity + line.missingQuantity === order.orderItems[index].quantity;
      });
      if (!complete) { setError('Nhập đủ số lượng tốt, hỏng và thất lạc cho từng dòng. Tổng phải bằng số lượng đã giao đi.'); return; }
      const cost = Number(currentShippingCost);
      if (currentShippingCost === '' || currentShippingCost == null || !Number.isSafeInteger(cost) || cost < 0 || currentNotes.trim().length > 1000) {
        setError('Nhập phí vận chuyển hàng quay về là số nguyên từ 0 đồng; ghi chú tối đa 1.000 ký tự.'); return;
      }
      if (!window.confirm(frozen
        ? 'Tiếp tục xử lý đúng kết quả kiểm hàng đã ghi nhận? Hệ thống sẽ không nhập kho lại các dòng đã hoàn tất.'
        : `Bạn đã nhận và kiểm tra thực tế toàn bộ hàng quay về? Chỉ số lượng tốt được nhập lại kho. Tiền hoàn: ${money(refundAmount)}. Thao tác này không tự chuyển tiền.`)) return;
      callback = onSettleReturn;
      payload = { inspection: lines, returnShippingCost: cost, notes: currentNotes.trim() };
    } else return;
    pending.current = true;
    setSubmitting(true);
    try {
      const result = await callback(order._id, payload);
      if (result !== false) setMode('');
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message || 'Không thể lưu. Vui lòng kiểm tra lại trạng thái đơn hàng.');
    } finally { pending.current = false; setSubmitting(false); }
  };

  return <>
    <DeliveryReturnSummary order={order} admin />
    {order.orderStatus === 'Đang giao' && mode !== 'failure' && <button type="button" disabled={locked} onClick={() => { setMode('failure'); setError(''); }} className="mt-4 rounded border border-orange-400 bg-orange-50 px-4 py-2 font-semibold text-orange-900 disabled:opacity-50">Báo giao thất bại / từ chối nhận</button>}
    {order.orderStatus === 'Giao thất bại' && !frozen && mode !== 'inspection' && <button type="button" disabled={locked} onClick={() => { setMode('inspection'); setError(''); }} className="mt-4 rounded bg-orange-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Xác nhận hàng quay về và kiểm hàng</button>}
    {((mode === 'failure' && order.orderStatus === 'Đang giao') || (order.orderStatus === 'Giao thất bại' && (mode === 'inspection' || frozen))) && <form onSubmit={submit} className="mt-4 space-y-4 rounded-lg border border-orange-200 bg-white p-4" aria-label={mode === 'failure' ? 'Báo giao thất bại' : 'Kiểm tra hàng quay về'}>
      {mode === 'failure' ? <>
        <h4 className="font-semibold">Ghi nhận giao thất bại / từ chối nhận</h4>
        <label className="block">Lý do giao thất bại *<textarea required maxLength={300} disabled={locked} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded border p-2" placeholder="Ví dụ: Khách từ chối nhận COD" /></label>
        <label className="block">Ghi chú giao hàng<textarea maxLength={1000} disabled={locked} value={failureNotes} onChange={event => setFailureNotes(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <p className="text-sm text-gray-600">Chỉ ghi nhận giao thất bại. Chờ hàng quay về và kiểm tra thực tế trước khi hoàn kho, chốt khoản hoàn tiền.</p>
      </> : <>
        <h4 className="font-semibold">{frozen ? 'Tiếp tục kết quả kiểm hàng đã ghi nhận' : 'Kiểm tra hàng quay về'}</h4>
        {frozen && <p role="status" className="text-orange-900">Dữ liệu đã được chốt để xử lý. Không thay đổi số lượng hoặc chi phí khi tiếp tục.{order.deliveryReturn.recoveryRequired && ' Đơn cần tiếp tục đối soát.'}</p>}
        {(order.orderItems || []).map((item, itemIndex) => <fieldset key={item._id || itemIndex} disabled={locked || frozen} className="min-w-0 rounded border p-3">
          <legend className="px-1 font-medium">{itemLabel(item)} — Đã giao đi: {item.quantity}</legend>
          <div className="grid gap-3 sm:grid-cols-3">{[['restockQuantity', 'Hàng tốt nhập lại kho'], ['damagedQuantity', 'Hàng hỏng không nhập kho'], ['missingQuantity', 'Thất lạc / không nhận lại']].map(([field, label]) => <label key={field} className="block">{label} *<input type="number" min="0" max={item.quantity} step="1" required value={currentInspection?.[itemIndex]?.[field] ?? ''} onChange={event => setLine(itemIndex, field, event.target.value)} aria-label={`${label} — dòng ${itemIndex + 1}`} className="mt-1 w-full rounded border p-2" /></label>)}</div>
        </fieldset>)}
        <label className="block">Phí vận chuyển hàng quay về cửa hàng chịu (đ) *<input type="number" min="0" step="1" required disabled={locked || frozen} value={currentShippingCost} onChange={event => setReturnShippingCost(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="block">Ghi chú kiểm hàng<textarea maxLength={1000} disabled={locked || frozen} value={currentNotes} onChange={event => setReturnNotes(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <div className="rounded bg-gray-50 p-3 space-y-1"><p>Phí giao ban đầu giữ lại: <strong>{money(frozen ? order.deliveryReturn.retainedShippingFee : paidShipping)}</strong></p><p>Tiền hoàn cho khách: <strong>{money(frozen ? order.deliveryReturn.refundAmount : refundAmount)}</strong></p><p className="text-sm text-gray-600">{order.isPaid ? 'Hoàn phần tiền hàng thực trả sau giảm giá; không hoàn phí giao ban đầu. Phí hàng quay về do cửa hàng chịu.' : 'Đơn chưa thanh toán nên không có tiền hoàn và không thu phí giao từ khách.'} Hàng hỏng hoặc thất lạc không được cộng vào kho bán.</p></div>
      </>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={locked} className="rounded bg-orange-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{submitting ? 'Đang xử lý…' : mode === 'failure' ? 'Ghi nhận giao thất bại' : frozen ? 'Tiếp tục xử lý kết quả đã chốt' : 'Xác nhận đã kiểm hàng và xử lý'}</button>{!frozen && <button type="button" disabled={locked} onClick={() => { setMode(''); setError(''); }} className="rounded bg-gray-100 px-4 py-2">Đóng</button>}</div>
    </form>}
  </>;
};

export default DeliveryReturnActions;

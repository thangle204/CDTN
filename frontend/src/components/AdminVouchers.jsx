import { useEffect, useRef, useState } from 'react';
import { vouchersAPI } from '../utils/api';
import { voucherBenefit, voucherDateLabel, voucherForm, voucherMoney, voucherPayload, voucherRule } from '../utils/vouchers';

const status = voucher => !voucher.isActive ? 'Đã ngừng' : new Date(voucher.endDate) < new Date() ? 'Hết hạn'
  : new Date(voucher.startDate) > new Date() ? 'Sắp bắt đầu' : voucher.usedCount >= voucher.maxUses ? 'Hết lượt' : 'Đang áp dụng';
const fieldClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2';

export default function AdminVouchers() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(() => voucherForm());
  const [formError, setFormError] = useState('');
  const submitting = useRef(false);
  const fetchVouchers = async () => {
    try { setError(''); const { data } = await vouchersAPI.getAllVouchersAdmin(); setVouchers(data); }
    catch (failure) { setError(failure.response?.data?.message || 'Không tải được mã ưu đãi'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchVouchers(); }, []);
  const edit = voucher => {
    setEditingVoucher(voucher || null); setFormData(voucherForm(voucher)); setFormError(''); setShowModal(true);
  };
  const change = event => {
    const { name, value, type, checked } = event.target;
    setFormData(previous => ({ ...previous, [name]: type === 'checkbox' ? checked : value,
      ...(name === 'type' && value === 'shipping' ? { discount: 30000, maxDiscount: '' } : {}),
      ...(name === 'eligibility' && value === 'after_purchase' ? { visibility: 'private' } : {}),
      ...(name === 'eligibility' && value === 'first_order' ? { perCustomerLimit: 1 } : {}),
      ...(name === 'visibility' && value === 'public' && previous.eligibility === 'after_purchase' ? { eligibility: 'all' } : {}),
      ...(name === 'visibility' && value === 'private' && previous.eligibility === 'all' ? { eligibility: 'first_order', perCustomerLimit: 1 } : {}),
    }));
  };
  const submit = async event => {
    event.preventDefault(); if (submitting.current) return;
    let payload;
    try { payload = voucherPayload(formData, editingVoucher); } catch (failure) { setFormError(failure.message); return; }
    submitting.current = true; setSaving(true); setFormError('');
    try {
      if (editingVoucher) await vouchersAPI.updateVoucher(editingVoucher._id, payload);
      else await vouchersAPI.createVoucher(payload);
      setShowModal(false); setEditingVoucher(null); await fetchVouchers();
    } catch (failure) { setFormError(failure.response?.data?.message || 'Không lưu được chương trình. Vui lòng thử lại'); }
    finally { submitting.current = false; setSaving(false); }
  };
  const toggle = async voucher => {
    if (actionId) return;
    setActionId(voucher._id);
    try { await vouchersAPI.toggleVoucher(voucher._id, { version: voucher.__v ?? 0 }); await fetchVouchers(); }
    catch (failure) { setError(failure.response?.data?.message || 'Không cập nhật được trạng thái'); }
    finally { setActionId(null); }
  };
  const visible = vouchers.filter(voucher => `${voucher.code} ${voucher.description}`.toLocaleLowerCase('vi-VN').includes(searchTerm.toLocaleLowerCase('vi-VN'))
    && (filterStatus === 'all' || status(voucher) === filterStatus));
  if (loading) return <p role="status" className="py-12 text-center">Đang tải ưu đãi...</p>;
  return <div>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-bold">Chương trình ưu đãi</h2><p className="mt-1 text-sm text-gray-600">Quản lý mã công khai và quà riêng theo tài khoản.</p></div><button onClick={() => edit()} className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white">+ Tạo ưu đãi</button></div>
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error} <button onClick={fetchVouchers} className="underline">Tải lại</button></p>}
    <div className="mb-4 flex flex-wrap gap-3"><input aria-label="Tìm mã ưu đãi" placeholder="Tìm mã hoặc mô tả..." value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-4 py-2" /><select aria-label="Lọc trạng thái ưu đãi" value={filterStatus} onChange={event => setFilterStatus(event.target.value)} className="rounded-lg border px-3 py-2">{['all', 'Đang áp dụng', 'Sắp bắt đầu', 'Hết hạn', 'Hết lượt', 'Đã ngừng'].map(value => <option key={value} value={value}>{value === 'all' ? 'Tất cả trạng thái' : value}</option>)}</select></div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr>{['Mã / quyền lợi', 'Phát hành', 'Điều kiện', 'Lượt đã dùng / đang giữ', 'Hiệu lực (giờ VN)', 'Thao tác'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{visible.map(voucher => <tr key={voucher._id}>
      <td className="min-w-[220px] px-4 py-4"><strong className="text-red-600">{voucher.code}</strong><p className="mt-1 font-semibold">{voucherBenefit(voucher)}</p><p className="mt-1 max-w-xs text-gray-500">{voucher.description}</p></td>
      <td className="px-4 py-4"><p>{voucher.visibility === 'private' ? 'Mã riêng' : 'Công khai'}</p><p className="mt-1 text-gray-500">{voucherRule(voucher)}</p></td>
      <td className="whitespace-nowrap px-4 py-4"><p>Từ {voucherMoney(voucher.minOrder)}</p><p className="mt-1 text-gray-500">{voucher.perCustomerLimit ? `${voucher.perCustomerLimit} lần/khách` : 'Không giới hạn mỗi khách'}</p></td>
      <td className="px-4 py-4">{voucher.usedCount || 0}/{voucher.maxUses}<p className="mt-1 text-xs text-gray-500">Gồm đơn đang giữ ưu đãi</p></td>
      <td className="whitespace-nowrap px-4 py-4"><p>{status(voucher)}</p><p className="mt-1 text-xs text-gray-500">{voucherDateLabel(voucher.startDate)}<br />→ {voucherDateLabel(voucher.endDate)}</p></td>
      <td className="whitespace-nowrap px-4 py-4"><button onClick={() => edit(voucher)} className="mr-3 font-semibold text-red-600">Chỉnh sửa</button><button disabled={Boolean(actionId)} onClick={() => toggle(voucher)} className="rounded-lg border px-3 py-2 disabled:opacity-50">{voucher.isActive ? 'Ngừng áp dụng' : 'Kích hoạt'}</button></td>
    </tr>)}</tbody></table>{!visible.length && <p className="p-8 text-center text-gray-500">Chưa có ưu đãi phù hợp.</p>}</div>
    <p className="mt-3 text-sm text-gray-500">Lưu/nhận mã không giữ trước lượt. Đơn đã tạo giữ nguyên số tiền dù chương trình được chỉnh sửa.</p>
    {showModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="voucher-form-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6">
      <h3 id="voucher-form-title" className="mb-4 text-xl font-bold">{editingVoucher ? 'Chỉnh sửa ưu đãi' : 'Tạo chương trình ưu đãi'}</h3>
      <form onSubmit={submit} className="space-y-5">
        {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{formError}</p>}
        <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Mã ưu đãi<input id="voucher-code" name="code" value={formData.code} onChange={change} required maxLength={50} readOnly={Boolean(editingVoucher)} className={fieldClass} /></label><label className="text-sm font-medium">Kênh phát hành<select name="visibility" value={formData.visibility} onChange={change} className={fieldClass}><option value="public">Kho ưu đãi công khai</option><option value="private">Mã riêng trong tài khoản</option></select></label></div>
          <label className="block text-sm font-medium">Mô tả<textarea name="description" value={formData.description} onChange={change} rows={3} maxLength={500} required className={fieldClass} /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Đối tượng / điều kiện<select name="eligibility" value={formData.eligibility} onChange={change} className={fieldClass}>{formData.visibility === 'public' && <option value="all">Tất cả khách hàng</option>}<option value="first_order">Lần mua đầu</option>{formData.visibility === 'private' && <option value="after_purchase">Sau đơn giao thành công và đã thanh toán</option>}</select></label><label className="text-sm font-medium">Loại ưu đãi<select name="type" value={formData.type} onChange={change} className={fieldClass}><option value="fixed">Giảm số tiền cố định</option><option value="percent">Giảm phần trăm</option><option value="shipping">Miễn phí vận chuyển</option></select></label></div>
          {formData.eligibility === 'first_order' && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Khách chưa có đơn giao thành công và không có đơn khác đang xử lý. Mỗi khách dùng một lần.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {formData.type !== 'shipping' && <label className="text-sm font-medium">Mức giảm ({formData.type === 'percent' ? '%' : '₫'})<input name="discount" type="number" min={0} max={formData.type === 'percent' ? 100 : undefined} step={1} required value={formData.discount} onChange={change} className={fieldClass} /></label>}
            {formData.type === 'percent' && <label className="text-sm font-medium">Giảm tối đa (₫)<input name="maxDiscount" type="number" min={1} step={1} placeholder="Để trống nếu không giới hạn" value={formData.maxDiscount} onChange={change} className={fieldClass} /></label>}
            {['minOrder', 'maxUses', 'perCustomerLimit'].map(name => <label key={name} className="text-sm font-medium">{{ minOrder: 'Tiền hàng tối thiểu (₫)', maxUses: 'Tổng lượt toàn chương trình', perCustomerLimit: 'Lượt mỗi khách' }[name]}<input name={name} type="number" min={name === 'minOrder' ? 0 : 1} step={1} required={name !== 'perCustomerLimit'} readOnly={name === 'perCustomerLimit' && formData.eligibility === 'first_order'} placeholder={name === 'perCustomerLimit' ? 'Để trống nếu không giới hạn' : ''} value={formData[name]} onChange={change} className={fieldClass} /></label>)}
            {formData.visibility === 'private' && <label className="text-sm font-medium">Hạn mã riêng từ lúc nhận (ngày)<input name="validityDays" type="number" min={1} max={365} step={1} required value={formData.validityDays} onChange={change} className={fieldClass} /></label>}
          </div>
          {formData.visibility === 'private' && <p className="text-sm text-gray-600">Mỗi khách được cấp một quyền nhận mã trong chương trình; nhận lại không gia hạn. Hạn thực tế không vượt ngày kết thúc chương trình. Mã không xuất hiện trong kho công khai.</p>}
          <div className="grid gap-4 sm:grid-cols-2">{[['startDate', 'Bắt đầu'], ['endDate', 'Kết thúc']].map(([name, label]) => <label key={name} className="text-sm font-medium">{label}<input name={name} type="datetime-local" required value={formData[name]} onChange={change} className={fieldClass} /></label>)}</div>
          <p className="text-xs text-gray-500">Giờ Việt Nam (UTC+7). Sửa nội dung không đổi các mốc thời gian đã lưu.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" checked={formData.isActive} onChange={change} />Cho phép áp dụng chương trình</label>
        </fieldset>
        <div className="flex gap-3"><button type="submit" disabled={saving} className="flex-1 rounded-lg bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Đang lưu...' : editingVoucher ? 'Lưu thay đổi' : 'Tạo ưu đãi'}</button><button type="button" disabled={saving} onClick={() => setShowModal(false)} className="rounded-lg border px-6 py-3">Hủy</button></div>
      </form>
    </section></div>}
  </div>;
}

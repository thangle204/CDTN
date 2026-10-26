import { useEffect, useRef, useState } from 'react';
import { FaStar } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../utils/api';
import { canReviewOrder, reviewProducts } from '../utils/orderReviews';
import { productImageUrl } from '../utils/productVariants';

const blankDraft = () => ({ rating: 5, comment: '' });

export default function OrderReviews({ order }) {
  const { user, loading: authLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(blankDraft);
  const [requiresReload, setRequiresReload] = useState(false);
  const mounted = useRef(false);
  const operationRef = useRef(null);
  const eligible = !authLoading && Boolean(user) && canReviewOrder(order);
  const scopeKey = JSON.stringify([user?._id, order?._id, eligible]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const products = reviewProducts(order);

  useEffect(() => {
    mounted.current = true;
    setOpen(false); setRecords(null); setError(''); setNotice('');
    setEditing(null); setDraft(blankDraft()); setRequiresReload(false); setLoading(false); setSaving(false);
    return () => {
      mounted.current = false;
      operationRef.current?.controller.abort();
      operationRef.current = null;
    };
  }, [scopeKey]);

  const startOperation = kind => {
    if (!mounted.current || !eligible || scopeRef.current !== scopeKey || operationRef.current) return null;
    const operation = { kind, scope: scopeKey, controller: new AbortController() };
    operationRef.current = operation;
    return operation;
  };
  const active = operation => mounted.current && operationRef.current === operation && scopeRef.current === operation.scope;

  const load = async () => {
    const operation = startOperation('load');
    if (!operation) return;
    setOpen(true); setLoading(true); setError(''); setNotice('');
    try {
      const { data } = await ordersAPI.getOrderReviews(order._id, { signal: operation.controller.signal });
      if (!active(operation)) return;
      if (data.orderId !== order._id || !Array.isArray(data.products)) throw new Error('Dữ liệu đánh giá không hợp lệ. Vui lòng thử lại.');
      setRecords(data.products); setEditing(null); setRequiresReload(false);
    } catch (failure) {
      if (active(operation)) setError(failure.response?.data?.message || failure.message || 'Không thể tải đánh giá.');
    } finally {
      if (active(operation)) setLoading(false);
      if (operationRef.current === operation) operationRef.current = null;
    }
  };

  const beginEdit = productId => {
    if (!eligible || scopeRef.current !== scopeKey || operationRef.current || requiresReload) return;
    const entry = records?.find(record => record.productId === productId);
    if (!entry?.available) return;
    setEditing({ productId, version: entry.review ? entry.review.version : null });
    setDraft(entry.review ? { rating: entry.review.rating, comment: entry.review.comment } : blankDraft());
    setError(''); setNotice('');
  };

  const submit = async event => {
    event.preventDefault();
    if (!mounted.current || !eligible || scopeRef.current !== scopeKey) return;
    if (!editing || requiresReload || !records?.some(record => record.productId === editing.productId && record.available)) return;
    if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5 || !draft.comment.trim() || draft.comment.trim().length > 2000) {
      setError('Vui lòng chọn từ 1 đến 5 sao và nhập nội dung không quá 2.000 ký tự.'); return;
    }
    const operation = startOperation('save');
    if (!operation) return;
    setSaving(true); setError(''); setNotice('');
    const updating = editing.version !== null;
    try {
      const body = { rating: draft.rating, comment: draft.comment.trim(), ...(updating ? { expectedVersion: editing.version } : {}) };
      const { data } = updating
        ? await ordersAPI.updateOrderReview(order._id, editing.productId, body, { signal: operation.controller.signal })
        : await ordersAPI.createOrderReview(order._id, editing.productId, body, { signal: operation.controller.signal });
      if (!active(operation)) return;
      if (data.productId !== editing.productId || !data.review) throw new Error('Chưa nhận được kết quả đánh giá. Vui lòng tải lại để kiểm tra.');
      setRecords(previous => previous.map(record => record.productId === data.productId ? { ...record, review: data.review } : record));
      setEditing(null); setDraft(blankDraft());
      setNotice(updating ? 'Đã cập nhật đánh giá của bạn.' : 'Cảm ơn bạn! Đánh giá đã được đăng trên trang sản phẩm.');
    } catch (failure) {
      if (active(operation)) {
        setError(failure.response?.data?.message || failure.message || 'Không thể lưu đánh giá.');
        // A lost response can follow a successful write. Reload explicitly rather
        // than guessing whether to create again or overwrite a newer review.
        if (!failure.response || [404, 409].includes(failure.response.status)) setRequiresReload(true);
      }
    } finally {
      if (active(operation)) setSaving(false);
      if (operationRef.current === operation) operationRef.current = null;
    }
  };

  if (!eligible) return null;
  const panelId = `order-reviews-${order._id}`;
  return (
    <section className="mt-5 rounded-xl border border-gray-200 p-4 sm:p-5" aria-label="Đánh giá sản phẩm trong đơn hàng">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h4 className="font-semibold">Chia sẻ trải nghiệm của bạn</h4><p className="text-sm text-gray-600">Đơn đã giao và đã thanh toán. Mỗi mẫu giày có một đánh giá của bạn.</p></div>
        <button type="button" disabled={saving} aria-expanded={open} aria-controls={panelId} onClick={() => {
          if (scopeRef.current !== scopeKey) return;
          if (!open) { load(); return; }
          operationRef.current?.controller.abort(); operationRef.current = null;
          setLoading(false); setOpen(false); setEditing(null);
        }} className="rounded-lg border border-red-600 px-4 py-2 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{open ? 'Ẩn đánh giá' : 'Đánh giá sản phẩm'}</button>
      </div>
      {open && <div id={panelId} className="mt-4 space-y-4">
        {loading && <p role="status" className="text-sm text-gray-600">Đang tải đánh giá...</p>}
        {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {!loading && (requiresReload || !records) && <button type="button" disabled={saving} onClick={load} className="font-semibold text-red-600 underline">Tải lại đánh giá</button>}
        {!loading && records && products.map(product => {
          const entry = records.find(record => record.productId === product.productId);
          const isEditing = editing?.productId === product.productId;
          return <article key={product.productId} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex gap-3"><img src={productImageUrl(product.image)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-contain" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} /><div className="min-w-0 flex-1"><h5 className="font-semibold">{product.name}</h5>
              {entry?.review && <div className="mt-2"><p className="text-sm font-semibold text-amber-800">Đã đánh giá · {entry.review.rating}/5 sao</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{entry.review.comment}</p></div>}
              {!entry?.available ? <p className="mt-2 text-sm text-gray-500">Sản phẩm không còn tồn tại để đánh giá.</p> : !isEditing && <button type="button" disabled={saving || requiresReload} onClick={() => beginEdit(product.productId)} className="mt-2 font-semibold text-red-600 hover:underline disabled:opacity-50">{entry.review ? 'Sửa đánh giá' : 'Viết đánh giá'}</button>}
            </div></div>
            {isEditing && <form onSubmit={submit} className="mt-4 space-y-4">
              <fieldset disabled={saving || requiresReload}><legend className="text-sm font-medium">Mức độ hài lòng</legend><div className="mt-2 flex flex-wrap gap-1">{[1, 2, 3, 4, 5].map(rating => <label key={rating} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white"><input type="radio" name={`rating-${panelId}`} value={rating} checked={draft.rating === rating} onChange={() => setDraft(previous => ({ ...previous, rating }))} className="peer sr-only" /><span className="sr-only">{rating} sao</span><FaStar aria-hidden="true" className={`${rating <= draft.rating ? 'text-amber-500' : 'text-gray-300'} text-xl peer-focus-visible:outline peer-focus-visible:outline-red-600`} /></label>)}</div></fieldset>
              <label className="block text-sm font-medium">Nội dung đánh giá<textarea required maxLength={2000} rows={4} disabled={saving || requiresReload} value={draft.comment} onChange={event => setDraft(previous => ({ ...previous, comment: event.target.value }))} placeholder="Chia sẻ cảm nhận về chất lượng, độ vừa chân và trải nghiệm sử dụng..." className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" /></label>
              <div className="flex flex-wrap gap-3"><button type="submit" disabled={saving || requiresReload} className="rounded-lg bg-red-600 px-5 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">{saving ? 'Đang lưu...' : editing.version === null ? 'Gửi đánh giá' : 'Lưu thay đổi'}</button><button type="button" disabled={saving} onClick={() => { setEditing(null); setError(''); }} className="rounded-lg border border-gray-300 px-4 py-2 disabled:opacity-50">Hủy</button></div>
            </form>}
          </article>;
        })}
      </div>}
    </section>
  );
}

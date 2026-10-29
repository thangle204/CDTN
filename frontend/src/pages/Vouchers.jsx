import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { vouchersAPI } from '../utils/api';
import VoucherCard from '../components/VoucherCard';

export default function Vouchers({ mine = false }) {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation(), navigate = useNavigate();
  const [cards, setCards] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const generation = useRef(0), action = useRef(false);
  const account = useRef(user?._id);account.current = user?._id;
  useEffect(() => {
    if (authLoading) return;
    if (mine && !user) { navigate('/login', { replace: true, state: { from: '/my-vouchers' } }); return; }
    const controller = new AbortController();let active = true;
    generation.current += 1;action.current = false;
    setLoading(true);setCards([]);setError('');setMessage('');setBusy(false);
    const request = mine ? vouchersAPI.refreshMyVouchers({ signal: controller.signal }) : Promise.all([
      vouchersAPI.getActiveVouchers(),
      user ? vouchersAPI.getMyVouchers({ signal: controller.signal }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]).then(([catalog, wallet]) => ({ data: (Array.isArray(catalog.data) ? catalog.data : []).map(card => ({ ...card,
      walletId: wallet.data?.find?.(saved => String(saved._id) === String(card._id))?.walletId,
    })) }));
    request.then(({ data }) => { if (active) setCards(Array.isArray(data) ? data : []); })
      .catch(failure => { if (active) setError(failure.response?.data?.message || 'Chưa tải được ưu đãi. Vui lòng thử lại.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false;generation.current += 1;controller.abort(); };
  }, [mine, user?._id, authLoading, revision, location.key]);
  const save = async voucher => {
    if (!user) { navigate('/login', { state: { from: location.pathname } }); return; }
    if (action.current) return;
    action.current = true;const current = generation.current, owner = account.current;
    setBusy(true);setError('');
    try {
      const { data } = await (voucher.walletId ? vouchersAPI.unsaveVoucher(voucher._id) : vouchersAPI.saveVoucher(voucher._id));
      if (current !== generation.current || owner !== account.current) return;
      setMessage(data.message);
      if (mine) setCards(previous => previous.filter(card => card._id !== voucher._id));
      else setCards(previous => previous.map(card => card._id === voucher._id ? { ...card, walletId: voucher.walletId ? null : 'saved' } : card));
    } catch (failure) { if (current === generation.current && owner === account.current) setError(failure.response?.data?.message || 'Không lưu được mã. Vui lòng thử lại.'); }
    finally { if (current === generation.current && owner === account.current) { action.current = false;setBusy(false); } }
  };
  const available = cards.filter(card => !['expired', 'used', 'held', 'unavailable'].includes(card.state));
  const other = cards.filter(card => !available.includes(card));
  return <div className="container mx-auto px-4 py-8 shop-page voucher-page">
    <div className="voucher-page__heading"><p className="shop-eyebrow">ƯU ĐÃI CHO ĐÔI GIÀY TIẾP THEO</p><h1>{mine ? 'Mã ưu đãi của tôi' : 'Kho ưu đãi'}</h1><p>{mine ? 'Mã đã lưu và quà riêng được cấp khi bạn đủ điều kiện. Nhận lại không gia hạn mã.' : 'Chọn ưu đãi phù hợp, xem điều kiện rõ ràng và dùng khi thanh toán.'}</p></div>
    <nav className="voucher-page__tabs" aria-label="Kho mã ưu đãi"><Link to="/offers" aria-current={!mine ? 'page' : undefined}>Ưu đãi công khai</Link><Link to="/my-vouchers" aria-current={mine ? 'page' : undefined}>Mã của tôi</Link></nav>
    <p className="mb-6 rounded-xl border bg-white p-4 text-sm text-gray-600">Lưu mã không giữ trước lượt. Mỗi đơn dùng một mã; điều kiện và lượt còn lại được kiểm tra lại lúc đặt hàng.</p>
    {message && <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-green-800">{message}</p>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error} <button onClick={() => setRevision(value => value + 1)} className="underline">Tải lại</button></p>}
    {loading ? <p role="status" className="py-12 text-center text-gray-500">Đang cập nhật ưu đãi...</p> : <>
      {mine && <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Có thể dùng ({available.length})</h2><button disabled={busy} onClick={() => setRevision(value => value + 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Kiểm tra và nhận mã mới</button></div>}
      <div className="voucher-grid">{available.map(card => <VoucherCard key={card._id} voucher={card} onSave={save} busy={busy} />)}</div>
      {!available.length && <div className="rounded-xl border bg-white p-8 text-center"><h2 className="text-lg font-semibold">{mine ? 'Chưa có mã dùng được' : 'Chưa có chương trình đang áp dụng'}</h2><p className="mt-2 text-gray-500">{mine ? 'Khám phá mã công khai hoặc quay lại khi đủ điều kiện nhận quà sau mua.' : 'Bạn có thể tiếp tục chọn mẫu giày yêu thích và quay lại xem ưu đãi sau.'}</p><Link to={mine ? '/offers' : '/products'} className="mt-4 inline-block font-semibold text-red-600">{mine ? 'Xem kho ưu đãi →' : 'Khám phá giày →'}</Link></div>}
      {other.length > 0 && <><h2 className="mb-4 mt-10 text-xl font-bold">Đang giữ, đã dùng hoặc hết hiệu lực</h2><div className="voucher-grid">{other.map(card => <VoucherCard key={card._id} voucher={card} onSave={card.visibility === 'private' ? undefined : save} busy={busy} />)}</div></>}
    </>}
  </div>;
}

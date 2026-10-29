import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { vouchersAPI } from '../utils/api';
import VoucherCard from './VoucherCard';

export default function VoucherSelector({ userId, subtotal, onChoose, selectedCode, busy }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const keyRef = useRef('');keyRef.current = `${userId}:${subtotal}`;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const key = keyRef.current;
    setLoading(true);setCards([]);setError('');
    vouchersAPI.getAvailableVouchers(subtotal, { signal: controller.signal }).then(({ data }) => {
      if (active && key === keyRef.current) setCards(Array.isArray(data) ? data.filter(card => card.walletId) : []);
    }).catch(failure => { if (active && key === keyRef.current) setError(failure.response?.data?.message || 'Chưa tải được Mã của tôi. Vui lòng thử lại.'); })
      .finally(() => { if (active && key === keyRef.current) setLoading(false); });
    return () => { active = false;controller.abort(); };
  }, [userId, subtotal, revision]);
  const available = cards.filter(card => card.eligible), unavailable = cards.filter(card => !card.eligible);
  return <div className="mt-4"><div className="flex flex-wrap gap-3 text-sm"><Link to="/offers" className="font-semibold text-red-600">Kho ưu đãi →</Link><Link to="/my-vouchers" className="font-semibold text-red-600">Mã của tôi →</Link></div>
    <p className="mt-3 text-sm text-gray-500">Chỉ áp dụng mã đã lưu hoặc được cấp trong Mã của tôi.</p>
    {loading ? <p role="status" className="mt-3 text-sm text-gray-500">Đang tải mã của bạn...</p> : error ? <p role="alert" className="mt-3 text-sm text-red-600">{error} <button type="button" onClick={() => setRevision(value => value + 1)} className="underline">Thử lại</button></p>
      : !cards.length ? <p className="mt-3 text-sm text-gray-500">Bạn chưa có mã trong Mã của tôi. Vào Kho ưu đãi để lưu mã trước khi thanh toán.</p>
        : <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Chọn từ Mã của tôi · {available.length} mã dùng được</summary><div className="mt-3 space-y-3">{available.map((card, index) => <VoucherCard key={card._id} voucher={card} onChoose={onChoose} selected={selectedCode === card.code} recommended={index === 0 && card.savings > 0} busy={busy} />)}{unavailable.length > 0 && <p className="pt-3 text-sm font-semibold text-gray-500">Chưa đủ điều kiện ({unavailable.length})</p>}{unavailable.map(card => <VoucherCard key={card._id} voucher={card} onChoose={onChoose} busy={busy} />)}</div></details>}
  </div>;
}

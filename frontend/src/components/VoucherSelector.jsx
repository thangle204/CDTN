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
      if (active && key === keyRef.current) setCards(Array.isArray(data) ? data : []);
    }).catch(failure => { if (active && key === keyRef.current) setError(failure.response?.data?.message || 'Chưa tải được danh sách. Bạn vẫn có thể nhập mã.'); })
      .finally(() => { if (active && key === keyRef.current) setLoading(false); });
    return () => { active = false;controller.abort(); };
  }, [userId, subtotal, revision]);
  const available = cards.filter(card => card.eligible), unavailable = cards.filter(card => !card.eligible);
  return <div className="mt-4"><div className="flex flex-wrap gap-3 text-sm"><Link to="/offers" className="font-semibold text-red-600">Kho ưu đãi →</Link><Link to="/my-vouchers" className="font-semibold text-red-600">Mã của tôi →</Link></div>
    {loading ? <p role="status" className="mt-3 text-sm text-gray-500">Đang tìm ưu đãi cho giỏ hàng...</p> : error ? <p role="alert" className="mt-3 text-sm text-red-600">{error} <button type="button" onClick={() => setRevision(value => value + 1)} className="underline">Thử lại</button></p>
      : <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Chọn ưu đãi · {available.length} mã dùng được</summary><div className="mt-3 space-y-3">{available.map((card, index) => <VoucherCard key={card._id} voucher={card} onChoose={onChoose} selected={selectedCode === card.code} recommended={index === 0 && card.savings > 0} busy={busy} />)}{unavailable.length > 0 && <p className="pt-3 text-sm font-semibold text-gray-500">Chưa đủ điều kiện ({unavailable.length})</p>}{unavailable.map(card => <VoucherCard key={card._id} voucher={card} onChoose={onChoose} busy={busy} />)}{!cards.length && <p className="text-sm text-gray-500">Chưa có mã ưu đãi cho giỏ này.</p>}</div></details>}
  </div>;
}

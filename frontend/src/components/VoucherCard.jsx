import { Link } from 'react-router-dom';
import { voucherBenefit, voucherDateLabel, voucherMoney, voucherRule } from '../utils/vouchers';

export default function VoucherCard({ voucher, onChoose, onSave, busy = false, selected = false, recommended = false, catalog = false }) {
  const expired = voucher.state === 'expired';
  const savedInCatalog = catalog && Boolean(voucher.walletId);
  return <article aria-disabled={savedInCatalog || undefined} className={`voucher-card${selected ? ' voucher-card--selected' : ''}${expired ? ' voucher-card--expired' : ''}${savedInCatalog ? ' voucher-card--saved' : ''}`}>
    <div className="voucher-card__top"><span>{voucher.visibility === 'private' ? 'DÀNH RIÊNG CHO BẠN' : 'ƯU ĐÃI CỬA HÀNG'}</span>{recommended && <strong>Tiết kiệm nhất</strong>}</div>
    <h3>{voucherBenefit(voucher)}</h3><p className="voucher-card__code">{voucher.code}</p><p className="voucher-card__description">{voucher.description}</p>
    <dl><div><dt>Đơn từ</dt><dd>{voucherMoney(voucher.minOrder)}</dd></div><div><dt>Dành cho</dt><dd>{voucherRule(voucher)}</dd></div>{voucher.perCustomerLimit && <div><dt>Giới hạn</dt><dd>{voucher.perCustomerLimit} lần/khách</dd></div>}<div><dt>Hết hạn</dt><dd>{voucherDateLabel(voucher.expiresAt || voucher.endDate)}</dd></div></dl>
    {voucher.eligible && voucher.savings > 0 && <p className="voucher-card__saving">Đơn này tiết kiệm {voucherMoney(voucher.savings)}</p>}
    {voucher.reason && <p className="voucher-card__reason">{voucher.reason}</p>}
    {voucher.state === 'held' && <p className="voucher-card__reason">Đang được giữ bởi một đơn hàng. {!savedInCatalog && <Link to="/my-orders">Xem đơn hàng →</Link>}</p>}
    {voucher.state === 'used' && <p className="voucher-card__reason">Đã dùng hết lượt của bạn.</p>}
    {expired && <p className="voucher-card__reason">Mã đã hết hạn.</p>}
    {savedInCatalog ? <p className="voucher-card__saved-note">Mã đã được lưu</p> : <div className="voucher-card__actions">{!catalog && (onChoose ? <button type="button" disabled={busy || !voucher.eligible} onClick={() => { if (!busy && voucher.eligible) onChoose(voucher.code); }}>{selected ? 'Đang áp dụng' : voucher.eligible ? 'Dùng mã này' : 'Chưa dùng được'}</button>
      : !expired && !['held', 'used', 'unavailable'].includes(voucher.state) && <Link to={`/cart?voucher=${encodeURIComponent(voucher.code)}`}>Dùng ngay →</Link>)}
      {onSave && voucher.visibility !== 'private' && <button type="button" className="voucher-card__save" disabled={busy} onClick={() => onSave(voucher)}>{voucher.walletId ? 'Bỏ lưu' : 'Lưu mã'}</button>}
    </div>}
  </article>;
}

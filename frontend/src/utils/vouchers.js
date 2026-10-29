export const voucherDateInput = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 16);
};
export const voucherDateISO = value => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new Error('Nhập ngày và giờ hợp lệ');
  const date = new Date(value + ':00+07:00');
  if (Number.isNaN(date.getTime()) || voucherDateInput(date) !== value) throw new Error('Ngày hoặc giờ không hợp lệ');
  return date.toISOString();
};
export const voucherDateLabel = value => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }) : '—';
export const voucherMoney = value => Number(value || 0).toLocaleString('vi-VN') + '₫';
export const voucherBenefit = voucher => voucher.type === 'shipping' ? 'Miễn phí vận chuyển'
  : voucher.type === 'percent' ? `Giảm ${voucher.discount}%${voucher.maxDiscount ? ' · tối đa ' + voucherMoney(voucher.maxDiscount) : ''}`
    : `Giảm ${voucherMoney(voucher.discount)}`;
export const voucherRule = voucher => voucher.eligibility === 'first_order' ? 'Lần mua đầu'
  : voucher.eligibility === 'after_purchase' ? 'Quà sau đơn giao thành công' : 'Tất cả khách hàng';

export const voucherForm = voucher => ({
  code: voucher?.code || '', description: voucher?.description || '', type: voucher?.type || 'fixed',
  discount: voucher?.discount ?? '', minOrder: voucher?.minOrder ?? 0, maxUses: voucher?.maxUses ?? 100,
  startDate: voucherDateInput(voucher?.startDate || new Date()), endDate: voucher ? voucherDateInput(voucher.endDate) : '',
  isActive: voucher?.isActive ?? true, visibility: voucher?.visibility || 'public', eligibility: voucher?.eligibility || 'all',
  perCustomerLimit: voucher ? voucher.perCustomerLimit ?? '' : 1,
  maxDiscount: voucher?.maxDiscount ?? '', validityDays: voucher?.validityDays ?? 14,
});
export const voucherPayload = (form, editing) => {
  const value = { ...form, code: form.code.trim().toUpperCase(), description: form.description.trim() };
  for (const key of ['discount', 'minOrder', 'maxUses', 'validityDays']) {
    if (value[key] === '' || !Number.isSafeInteger(Number(value[key])) || Number(value[key]) < 0) throw new Error('Giá trị và số lượt phải là số nguyên hợp lệ');
    value[key] = Number(value[key]);
  }
  for (const key of ['perCustomerLimit', 'maxDiscount']) {
    value[key] = value[key] === '' ? null : Number(value[key]);
    if (value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < 1)) throw new Error('Lượt mỗi khách và mức trần phải lớn hơn 0');
  }
  if (!/^[A-Z0-9_-]{1,50}$/.test(value.code) || !value.description || value.description.length > 500) throw new Error('Nhập mã gồm chữ/số/dấu gạch và mô tả tối đa 500 ký tự');
  if (value.type === 'shipping') value.discount = 30000;
  if (value.type !== 'percent') value.maxDiscount = null;
  if (value.type === 'percent' && value.discount > 100 || value.maxUses < 1 || value.maxUses < (editing?.usedCount || 0)) throw new Error('Kiểm tra phần trăm giảm và số lượt tối đa');
  if (value.validityDays < 1 || value.validityDays > 365) throw new Error('Hạn mã riêng từ 1 đến 365 ngày');
  if (value.eligibility === 'first_order') value.perCustomerLimit = 1;
  for (const key of ['startDate', 'endDate']) value[key] = editing && form[key] === voucherDateInput(editing[key]) ? editing[key] : voucherDateISO(form[key]);
  if (new Date(value.endDate) <= new Date(value.startDate)) throw new Error('Giờ kết thúc phải sau giờ bắt đầu');
  if (!editing) return value;
  const before = voucherForm(editing);
  const payload = { version: editing.__v ?? 0 };
  for (const key of Object.keys(value)) {
    const unchanged = ['startDate', 'endDate'].includes(key) ? form[key] === before[key]
      : String(value[key] ?? '') === String(before[key] ?? '');
    if (!unchanged) payload[key] = value[key];
  }
  return payload;
};

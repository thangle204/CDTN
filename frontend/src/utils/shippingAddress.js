export const SHIPPING_ADDRESS_FIELDS = [
  ['name', 'Họ tên người nhận', true, 120],
  ['phone', 'Số điện thoại nhận hàng', true, 10],
  ['address', 'Số nhà, tên đường', true, 500],
  ['city', 'Tỉnh / Thành phố', true, 120],
  ['district', 'Quận / Huyện', false, 120],
  ['ward', 'Phường / Xã', false, 120],
];
export const shippingAddressOf = user => Object.fromEntries(SHIPPING_ADDRESS_FIELDS.map(([field]) => [field,
  user?.shippingAddress?.[field] || (field === 'name' || field === 'phone' ? user?.[field] || '' : ''),
]));
export const hasShippingAddress = address => Boolean(address?.name?.trim() && /^0\d{9}$/.test(address?.phone || '') && address?.address?.trim() && address?.city?.trim());
export const cleanShippingAddress = draft => {
  const result = {};
  for (const [field, label, required, max] of SHIPPING_ADDRESS_FIELDS) {
    const value = draft?.[field];
    if (value != null && typeof value !== 'string') throw Error(`${label} không hợp lệ.`);
    result[field] = (value || '').trim();
    if (required && !result[field] || result[field].length > max) throw Error(`Vui lòng nhập ${label.toLocaleLowerCase('vi-VN')} hợp lệ.`);
  }
  if (!/^0\d{9}$/.test(result.phone)) throw Error('Số điện thoại nhận hàng phải có 10 số và bắt đầu bằng 0.');
  return result;
};
export const sameShippingAddress = (first, second) => SHIPPING_ADDRESS_FIELDS.every(([field]) => (first?.[field] || '').trim() === (second?.[field] || '').trim());
export const shippingAddressLine = address => ['address', 'ward', 'district', 'city'].map(field => address?.[field]).filter(Boolean).join(', ');

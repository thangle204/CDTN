import { cleanText, httpError, normalizePhone } from './validation.js';

// A customer's default address excludes order-specific delivery notes.
export const normalizeSavedShippingAddress = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Địa chỉ giao hàng không hợp lệ');
  const result = {};
  for (const [field, label, max] of [['name', 'Họ tên người nhận', 120], ['address', 'Số nhà, tên đường', 500], ['city', 'Tỉnh / Thành phố', 120], ['district', 'Quận / Huyện', 120], ['ward', 'Phường / Xã', 120]]) {
    result[field] = cleanText(input[field], label, { max, required: !['district', 'ward'].includes(field) });
  }
  result.phone = normalizePhone(input.phone);
  return result;
};

import mongoose from 'mongoose';
import { cleanText, httpError, normalizeSize, positiveQuantity } from './validation.js';

// Compare the selections the buyer actually confirmed, independent of cart row order.
// Prices still come from Product and are checked separately using expectedTotalPrice.
export const checkoutCartKey = (items) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    throw httpError(400, 'Vui lòng tải lại giỏ hàng và xác nhận danh sách sản phẩm trước khi đặt hàng');
  }
  const rows = items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw httpError(400, 'Danh sách sản phẩm xác nhận không hợp lệ');
    const product = String(item.product?._id ?? item.product ?? '').toLowerCase();
    if (!mongoose.isObjectIdOrHexString(product)) throw httpError(400, 'Mã sản phẩm xác nhận không hợp lệ');
    const color = cleanText(item.color ?? '', 'Màu sắc xác nhận', { required: false, max: 100 }).normalize('NFC').toLocaleLowerCase('vi-VN');
    const size = normalizeSize(item.size) ?? null;
    const quantity = positiveQuantity(item.quantity);
    return JSON.stringify([product, color, size, quantity]);
  });
  return JSON.stringify(rows.sort());
};

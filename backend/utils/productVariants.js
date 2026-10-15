import { cleanText, httpError, nonNegativeInteger, normalizeSize } from './validation.js';

export const hasProductVariants = (product) => Array.isArray(product?.variants) && product.variants.length > 0;
export const variantKey = (color, size) => JSON.stringify([String(color ?? '').trim().normalize('NFC').toLocaleLowerCase('vi-VN'), Number(size)]);

export const parseProductVariants = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw httpError(400, 'Vui lòng nhập từ 1 đến 100 dòng màu sắc, size và số lượng');
  }
  const keys = new Set();
  const colors = new Map();
  let total = 0;
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw httpError(400, 'Thông tin tồn kho theo màu và size không hợp lệ');
    const enteredColor = cleanText(row.color, 'Màu sắc', { max: 100 }).normalize('NFC');
    const colorKey = enteredColor.toLocaleLowerCase('vi-VN');
    const color = colors.get(colorKey) || enteredColor;
    colors.set(colorKey, color);
    const size = normalizeSize(row.size);
    if (size == null) throw httpError(400, 'Vui lòng nhập size cho từng dòng tồn kho');
    const quantity = nonNegativeInteger(row.quantity, 'Số lượng nhập');
    const key = variantKey(color, size);
    if (keys.has(key)) throw httpError(400, `Màu ${color}, size ${size} đã được nhập. Vui lòng gộp số lượng vào một dòng`);
    keys.add(key);
    total += quantity;
    if (!Number.isSafeInteger(total)) throw httpError(400, 'Tổng số lượng tồn kho vượt giới hạn cho phép');
    return { color, size, quantity };
  });
};

export const applyVariantSummary = (product, variants) => {
  product.variants = variants;
  product.countInStock = variants.reduce((sum, row) => sum + row.quantity, 0);
  product.sizes = [...new Set(variants.map((row) => row.size))].sort((a, b) => a - b);
  product.color = [...new Set(variants.map((row) => row.color))].join(', ');
  return product;
};

// Legacy products keep their shared inventory until an administrator allocates it.
export const getProductVariant = (product, sizeValue, colorValue) => {
  if (!hasProductVariants(product)) return null;
  const size = normalizeSize(sizeValue, product.sizes || []);
  if (size == null) throw httpError(400, 'Vui lòng chọn size giày');
  const color = cleanText(colorValue, 'Màu sắc', { max: 100 });
  const selected = product.variants.find((row) => variantKey(row.color, row.size) === variantKey(color, size));
  if (!selected) throw httpError(409, 'Màu sắc và size đã chọn hiện không còn được bán. Vui lòng chọn lại');
  return selected;
};

import { createHash } from 'node:crypto';
import { cleanText, httpError } from './validation.js';
import { variantKey } from './productVariants.js';

const quantity = (value, label) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw httpError(400, `${label} phải là số nguyên không âm`);
  }
  return value;
};

export const calculateDeliveryReturnAmounts = (order) => {
  const total = quantity(order.totalPrice, 'Tổng tiền đơn hàng');
  const shipping = quantity(order.shippingPrice ?? 0, 'Phí giao hàng');
  if (shipping > total) throw httpError(409, 'Phí giao hàng vượt tổng tiền đơn. Cần đối soát trước khi xử lý hoàn hàng');
  return {
    refundAmount: order.isPaid ? Math.max(0, total - shipping) : 0,
    retainedShippingFee: order.isPaid ? shipping : 0,
  };
};

// The positions refer to the immutable order snapshot, not current catalog rows.
export const normalizeDeliveryReturnRequest = (body, order) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || !Array.isArray(body.inspection) || !Array.isArray(order.orderItems)
      || !order.orderItems.length || body.inspection.length !== order.orderItems.length) {
    throw httpError(400, 'Cần kiểm tra đầy đủ từng dòng sản phẩm của đơn hàng');
  }
  const seen = new Set();
  const inspection = body.inspection.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw httpError(400, 'Kết quả kiểm tra hàng không hợp lệ');
    const itemIndex = quantity(row.itemIndex, 'Dòng sản phẩm');
    if (itemIndex >= order.orderItems.length || seen.has(itemIndex)) throw httpError(400, 'Dòng sản phẩm bị thiếu, trùng hoặc không tồn tại');
    seen.add(itemIndex);
    const restockQuantity = quantity(row.restockQuantity, 'Số lượng đạt chất lượng');
    const damagedQuantity = quantity(row.damagedQuantity, 'Số lượng hỏng');
    const missingQuantity = quantity(row.missingQuantity, 'Số lượng thiếu');
    const total = restockQuantity + damagedQuantity + missingQuantity;
    if (!Number.isSafeInteger(total) || total !== order.orderItems[itemIndex].quantity) {
      throw httpError(400, 'Tổng số lượng đạt chất lượng, hỏng và thiếu phải bằng số lượng đã gửi');
    }
    return { itemIndex, restockQuantity, damagedQuantity, missingQuantity };
  }).sort((left, right) => left.itemIndex - right.itemIndex);
  const result = {
    inspection,
    returnShippingCost: quantity(body.returnShippingCost, 'Chi phí vận chuyển hoàn về'),
    notes: cleanText(body.notes, 'Ghi chú kiểm tra hàng', { required: false, max: 1000 }),
  };
  return { ...result, requestHash: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
};

export const aggregateRestockItems = (order) => {
  const groups = new Map();
  for (const row of order.deliveryReturn.inspection) {
    if (!row.restockQuantity) continue;
    const item = order.orderItems[row.itemIndex];
    const product = item.product?._id ?? item.product;
    const key = JSON.stringify([String(product), item.inventoryVariant ? variantKey(item.color, item.size) : null]);
    const previous = groups.get(key);
    const total = (previous?.quantity || 0) + row.restockQuantity;
    if (!Number.isSafeInteger(total)) throw httpError(503, 'Số lượng hoàn kho cần đối soát');
    groups.set(key, {
      product, quantity: total, inventoryVariant: Boolean(item.inventoryVariant),
      color: item.color, size: item.size,
      receipt: `${order.deliveryReturn.token}:${createHash('sha256').update(key).digest('hex')}`,
    });
  }
  return [...groups.values()];
};

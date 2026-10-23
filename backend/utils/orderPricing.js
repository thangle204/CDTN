export const SHIPPING_FEE = 30000;

export const ORDER_STATUSES = ['Đang xử lý', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Đã hủy', 'Giao thất bại', 'Đã xử lý hoàn hàng'];
export const FAILED_DELIVERY_STATUSES = ['Giao thất bại', 'Đã xử lý hoàn hàng'];
export const NON_SALES_STATUSES = ['Đã hủy', ...FAILED_DELIVERY_STATUSES];
export const ORDER_TRANSITIONS = {
  'Đang xử lý': ['Đã xác nhận', 'Đã hủy'],
  'Đã xác nhận': ['Đang giao', 'Đã hủy'],
  'Đang giao': ['Đã giao'],
  'Đã giao': [],
  'Đã hủy': [],
  // These states require dedicated endpoints with failure and inspection data.
  'Giao thất bại': [],
  'Đã xử lý hoàn hàng': [],
};

export const orderError = (status, message) => Object.assign(new Error(message), { status });
export const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
export const isMoney = (value) => Number.isSafeInteger(value) && value >= 0;
export const isShoeSize = (value) => Number.isFinite(value) && value >= 1 && value <= 60 && Number.isInteger(value * 2);

// All money values are integer VND. The browser only previews this calculation.
export const calculateOrderPricing = (itemsPrice, voucher = null) => {
  if (!isMoney(itemsPrice)) throw orderError(400, 'Tổng tiền sản phẩm không hợp lệ');

  let shippingPrice = SHIPPING_FEE;
  let discountAmount = 0;
  if (voucher) {
    if (!isMoney(voucher.discount) || !['fixed', 'percent', 'shipping'].includes(voucher.type)) {
      throw orderError(400, 'Giá trị voucher không hợp lệ');
    }
    if (voucher.type === 'shipping') {
      shippingPrice = 0;
    } else if (voucher.type === 'percent') {
      if (voucher.discount > 100) throw orderError(400, 'Mức giảm phần trăm phải từ 0 đến 100');
      discountAmount = Math.min(itemsPrice, Math.round(itemsPrice * (voucher.discount / 100)));
    } else {
      discountAmount = Math.min(itemsPrice, voucher.discount);
    }
  }
  const totalPrice = itemsPrice - discountAmount + shippingPrice;
  if (!isMoney(totalPrice)) throw orderError(400, 'Tổng tiền đơn hàng vượt giới hạn cho phép');
  return { itemsPrice, shippingPrice, discountAmount, totalPrice };
};

export const validateVoucherEligibility = (voucher, itemsPrice, now = new Date()) => {
  if (!voucher) throw orderError(404, 'Mã voucher không tồn tại');
  if (!voucher.isActive) throw orderError(400, 'Mã voucher đã bị vô hiệu hóa');
  if (now < new Date(voucher.startDate)) throw orderError(400, 'Mã voucher chưa có hiệu lực');
  if (!voucher.endDate || now > new Date(voucher.endDate)) throw orderError(400, 'Mã voucher đã hết hạn');
  if (voucher.usedCount >= voucher.maxUses) throw orderError(400, 'Mã voucher đã hết lượt sử dụng');
  if (itemsPrice < voucher.minOrder) {
    throw orderError(400, `Đơn hàng tối thiểu ${voucher.minOrder.toLocaleString('vi-VN')}₫ để áp dụng mã này`);
  }
  return calculateOrderPricing(itemsPrice, voucher);
};

export const validateOrderTransition = (order, nextStatus) => {
  if (!ORDER_STATUSES.includes(nextStatus)) throw orderError(400, 'Trạng thái đơn hàng không hợp lệ');
  if (order.orderStatus === nextStatus) return;
  if (!ORDER_TRANSITIONS[order.orderStatus]?.includes(nextStatus)) {
    throw orderError(400, `Không thể chuyển đơn từ "${order.orderStatus}" sang "${nextStatus}"`);
  }
  if (['BANK', 'VNPAY'].includes(order.paymentMethod) && !order.isPaid && ['Đang giao', 'Đã giao'].includes(nextStatus)) {
    throw orderError(400, 'Cần xác nhận đã nhận thanh toán trước khi giao hàng');
  }
};

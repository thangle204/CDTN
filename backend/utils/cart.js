import { httpError } from './validation.js';
import { getProductVariant, variantKey } from './productVariants.js';

export const productIdOf = (item) => String(item.product?._id ?? item.product);

export const findCartItem = (cart, { cartItemId, productId, size, color } = {}) => {
  if (cartItemId) return cart.find((item) => String(item._id) === String(cartItemId));
  const matches = cart.filter((item) => productIdOf(item) === String(productId)
    && (size == null || Number(item.size) === Number(size))
    && (color == null || variantKey(item.color, item.size) === variantKey(color, item.size)));
  if (matches.length > 1) throw httpError(400, 'Vui lòng chọn đúng dòng sản phẩm và size trong giỏ hàng');
  return matches[0];
};

export const assertCartUnlocked = (customer) => {
  if (!customer) throw httpError(404, 'Không tìm thấy khách hàng');
  if (customer.checkoutLock?.recoveryRequired) {
    throw httpError(409, 'Giỏ hàng cần được cửa hàng đối soát sau sự cố. Vui lòng liên hệ quản trị viên');
  }
  if (customer.checkoutLock?.token && new Date(customer.checkoutLock.expiresAt).getTime() > Date.now()) {
    throw httpError(409, 'Đơn hàng đang được xử lý. Vui lòng đợi rồi thử lại');
  }
};

export const assertCartStock = (cart, product, requestedQuantity, excludedItemId, selection = {}) => {
  const variant = getProductVariant(product, selection.size, selection.color);
  const otherQuantity = cart
    .filter((item) => productIdOf(item) === String(product._id) && String(item._id) !== String(excludedItemId)
      && (!variant || variantKey(item.color, item.size) === variantKey(variant.color, variant.size)))
    .reduce((sum, item) => sum + item.quantity, 0);
  const available = variant ? variant.quantity : product.countInStock;
  if (!Number.isSafeInteger(otherQuantity + requestedQuantity) || otherQuantity + requestedQuantity > available) {
    const detail = variant ? `, màu ${variant.color}, size ${variant.size}` : '';
    throw httpError(400, `Sản phẩm ${product.name}${detail} chỉ còn ${available} đôi trong kho`);
  }
};

// Shared by the API and storefront. Product.price is always the original price;
// cart/order line prices are the amount actually charged per pair, in integer VND.
export const productPricing = (product) => {
  const originalPrice = product.price;
  const discountPercent = product.discountPercent === undefined ? 0 : product.discountPercent;
  if (!Number.isSafeInteger(originalPrice) || originalPrice < 0) {
    throw Object.assign(new Error('Giá sản phẩm không hợp lệ'), { status: 400 });
  }
  if (!Number.isSafeInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw Object.assign(new Error('Giảm giá sản phẩm phải là số nguyên từ 0 đến 100%'), { status: 400 });
  }
  // Round the discount once per pair, including half a dong upwards. BigInt
  // avoids precision loss when multiplying otherwise valid large VND amounts.
  const discountAmount = Number((BigInt(originalPrice) * BigInt(discountPercent) + 50n) / 100n);
  return { originalPrice, discountPercent, discountAmount, salePrice: originalPrice - discountAmount };
};

export const productSalePrice = product => productPricing(product).salePrice;

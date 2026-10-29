export { productPricing, productSalePrice } from '../../../shared/productPricing.js';
import { productSalePrice } from '../../../shared/productPricing.js';

// A populated Product carries its original price and current percentage. A
// historical/unavailable cart line already carries its final unit price.
export const cartItemPrice = item => item.product && typeof item.product === 'object'
  ? productSalePrice(item.product) : Number(item.price);

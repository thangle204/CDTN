import Product from '../models/productModel.js';
import { httpError } from './validation.js';

// Call only after the order is durably committed, or after every inventory
// compensation has succeeded. Never expire a hold while work may still run.
export const releaseCheckoutReservations = async (items, token) => {
  if (typeof token !== 'string' || !token.trim()) {
    throw httpError(503, 'Không thể xác định lượt giữ kho cần hoàn tất');
  }
  const products = new Map(items.map((item) => {
    const id = item.product?._id ?? item.product;
    return [String(id), id];
  }));
  const results = await Promise.allSettled([...products.values()].map(async (id) => {
    const result = await Product.updateOne({ _id: id }, {
      $pull: { checkoutReservations: token }, $inc: { __v: 1 },
    });
    if (result.matchedCount !== 1) throw new Error('Reserved product was not found');
  }));
  if (results.some((result) => result.status === 'rejected')) {
    throw httpError(503, 'Chưa thể hoàn tất lượt giữ kho. Vui lòng liên hệ cửa hàng để đối soát');
  }
};

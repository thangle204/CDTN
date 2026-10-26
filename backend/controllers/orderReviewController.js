import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import { cleanText, httpError } from '../utils/validation.js';

const requireId = value => {
  if (!mongoose.isObjectIdOrHexString(value)) throw httpError(400, 'Mã đơn hàng hoặc sản phẩm không hợp lệ');
};
const eligibleOrder = async req => {
  requireId(req.params.id);
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id, checkoutState: { $ne: 'pending' } });
  if (!order) throw httpError(404, 'Không tìm thấy đơn hàng của bạn');
  if (order.orderStatus !== 'Đã giao' || !order.isDelivered || !order.isPaid || order.cancellationLock || order.deliveryReturn) {
    throw httpError(403, 'Chỉ được đánh giá sản phẩm trong đơn đã thanh toán và giao thành công');
  }
  return order;
};
const ownReview = (product, userId) => product.reviews.find(review => String(review.user) === String(userId));
const presentReview = review => review ? {
  _id: String(review._id), rating: review.rating, comment: review.comment,
  version: review.version ?? 0, createdAt: review.createdAt, updatedAt: review.updatedAt,
} : null;
const reviewInput = (body, editing) => {
  const allowed = editing ? ['rating', 'comment', 'expectedVersion'] : ['rating', 'comment'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw httpError(400, 'Nội dung yêu cầu đánh giá không hợp lệ');
  if (!['number', 'string'].includes(typeof body.rating)) throw httpError(400, 'Điểm đánh giá phải từ 1 đến 5 sao');
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'Điểm đánh giá phải từ 1 đến 5 sao');
  const comment = cleanText(body.comment, 'Nội dung đánh giá', { max: 2000 });
  if (editing && (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0)) throw httpError(400, 'Vui lòng tải lại đánh giá trước khi chỉnh sửa');
  return { rating, comment };
};

export const getOrderReviews = async (req, res) => {
  const order = await eligibleOrder(req);
  const ids = [...new Set(order.orderItems.map(item => String(item.product)))];
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map(product => [String(product._id), product]));
  res.json({ orderId: String(order._id), products: ids.map(productId => ({
    productId, available: byId.has(productId), review: byId.has(productId) ? presentReview(ownReview(byId.get(productId), req.user._id)) : null,
  })) });
};

const writeOrderReview = async (req, res, editing) => {
  requireId(req.params.productId);
  const productId = String(new mongoose.Types.ObjectId(req.params.productId));
  const input = reviewInput(req.body, editing);
  const order = await eligibleOrder(req);
  if (!order.orderItems.some(item => String(item.product) === productId)) throw httpError(403, 'Sản phẩm không thuộc đơn hàng này');
  const product = await Product.findById(productId);
  if (!product) throw httpError(404, 'Sản phẩm không còn tồn tại để đánh giá');
  let review = ownReview(product, req.user._id);
  if (editing) {
    if (!review) throw httpError(404, 'Chưa có đánh giá của bạn. Vui lòng tải lại');
    if ((review.version ?? 0) !== req.body.expectedVersion) throw httpError(409, 'Đánh giá đã thay đổi. Vui lòng tải lại trước khi sửa');
    review.set({ ...input, name: req.user.name || 'Khách hàng', version: (review.version ?? 0) + 1 });
    if (!review.order) review.order = order._id;
  } else {
    if (review) throw httpError(409, 'Bạn đã đánh giá mẫu giày này. Vui lòng tải lại để xem hoặc sửa đánh giá');
    product.reviews.push({ ...input, name: req.user.name || 'Khách hàng', user: req.user._id, order: order._id, version: 0 });
    review = product.reviews[product.reviews.length - 1];
  }
  product.numReviews = product.reviews.length;
  product.rating = product.reviews.reduce((sum, entry) => sum + entry.rating, 0) / product.numReviews;
  // Product uses optimisticConcurrency: a stale save cannot overwrite another
  // review, moderation action, price change, or inventory update.
  await product.save();
  res.status(editing ? 200 : 201).json({ productId: String(product._id), review: presentReview(review), numReviews: product.numReviews, rating: product.rating });
};

export const createOrderReview = (req, res) => writeOrderReview(req, res, false);
export const updateOrderReview = (req, res) => writeOrderReview(req, res, true);

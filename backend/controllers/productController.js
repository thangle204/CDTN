import mongoose from 'mongoose';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import Customer from '../models/customerModel.js';
import mockProducts from '../data/mockProducts.js';
import { cleanText, httpError, nonNegativeInteger, normalizeSize } from '../utils/validation.js';
import { applyVariantSummary, hasProductVariants, parseProductVariants, variantKey } from '../utils/productVariants.js';
import { NON_SALES_STATUSES } from '../utils/orderPricing.js';

const categories = ['Sneaker', 'Giày chạy bộ', 'Giày da', 'Sandal', 'Giày thể thao'];
const databaseAvailable = () => mongoose.connection.readyState === 1;
const queryText = (value) => value == null ? '' : cleanText(value, 'Từ khóa tìm kiếm', { required: false, max: 100 });
const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
const parseSizes = (value) => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const sizes = [...new Set(list.filter((size) => String(size).trim() !== '').map((size) => normalizeSize(size)))].sort((a, b) => a - b);
  if (!sizes.length) throw httpError(400, 'Vui lòng nhập ít nhất một size giày');
  return sizes;
};
const assignProductFields = (product, body, creating = false) => {
  for (const [field, label, max] of [['name', 'Tên giày', 200], ['brand', 'Thương hiệu', 100], ['description', 'Mô tả', 5000]]) {
    if (creating || body[field] !== undefined) product[field] = cleanText(body[field], label, { max });
  }
  if (creating || body.image !== undefined) {
    const image = cleanText(body.image, 'Đường dẫn ảnh', { max: 2000 });
    if (!/^https?:\/\//i.test(image) && !/^\/[^/]/.test(image)) throw httpError(400, 'Ảnh phải là URL http/https hoặc đường dẫn trong website');
    product.image = image;
  }
  if (creating || body.category !== undefined) {
    if (!categories.includes(body.category)) throw httpError(400, 'Danh mục giày không hợp lệ');
    product.category = body.category;
  }
  if (creating || body.price !== undefined) product.price = nonNegativeInteger(body.price, 'Giá bán');
  if (creating || body.variants !== undefined) {
    const variants = parseProductVariants(body.variants);
    const existing = new Map((product.variants || []).map((variant) => [variantKey(variant.color, variant.size), variant]));
    const existingColors = new Map((product.variants || []).map((variant) => [variant.color.normalize('NFC').toLocaleLowerCase('vi-VN'), variant.color]));
    // Keep the spelling stored in carts and orders stable when only casing changes.
    for (const variant of variants) {
      const previous = existing.get(variantKey(variant.color, variant.size));
      variant.color = previous?.color || existingColors.get(variant.color.normalize('NFC').toLocaleLowerCase('vi-VN')) || variant.color;
    }
    applyVariantSummary(product, variants);
  } else if (hasProductVariants(product)) {
    if (body.countInStock !== undefined || body.sizes !== undefined || body.color !== undefined) {
      throw httpError(400, 'Vui lòng cập nhật tồn kho theo từng dòng màu sắc và size');
    }
  } else {
    if (body.countInStock !== undefined) product.countInStock = nonNegativeInteger(body.countInStock, 'Tồn kho');
    if (body.sizes !== undefined) product.sizes = parseSizes(body.sizes);
    if (body.color !== undefined) product.color = cleanText(body.color ?? '', 'Màu giày', { required: false, max: 100 });
  }
  if (body.isHidden !== undefined) {
    if (typeof body.isHidden !== 'boolean') throw httpError(400, 'Trạng thái hiển thị không hợp lệ');
    product.isHidden = body.isHidden;
  }
  for (const field of ['metaTitle', 'metaDescription', 'metaKeywords']) {
    if (body[field] !== undefined) product[field] = cleanText(body[field], 'Thông tin SEO', { required: false, max: 500 });
  }
  return product;
};

const guardVariantChanges = async (product, body) => {
  if (body.version !== undefined && nonNegativeInteger(body.version, 'Phiên bản sản phẩm') !== product.__v) {
    throw httpError(409, 'Tồn kho hoặc sản phẩm vừa thay đổi. Vui lòng đóng form, tải lại danh sách và mở lại sản phẩm');
  }
  if (body.variants === undefined) return;
  if (body.version === undefined) throw httpError(400, 'Vui lòng tải lại sản phẩm trước khi cập nhật tồn kho');
  const variants = parseProductVariants(body.variants);
  const nextKeys = new Set(variants.map((variant) => variantKey(variant.color, variant.size)));
  const changesInventoryShape = !hasProductVariants(product)
    || product.variants.some((variant) => !nextKeys.has(variantKey(variant.color, variant.size)));
  if (changesInventoryShape && product.checkoutReservations?.length) {
    throw httpError(409, 'Sản phẩm đang được giữ kho để xử lý đơn hàng. Vui lòng chờ hoàn tất trước khi chuyển đổi kho hoặc xóa màu và size');
  }
  if (!hasProductVariants(product)) {
    const activeOrder = await Order.exists({
      'orderItems.product': product._id,
      $or: [
        { orderStatus: { $nin: ['Đã giao', 'Đã hủy', 'Đã xử lý hoàn hàng'] } },
        { orderStatus: 'Đã hủy', stockRestored: { $ne: true } },
      ],
    });
    const inCart = await Customer.exists({ 'cart.product': product._id });
    if (activeOrder || inCart) throw httpError(409, 'Sản phẩm cũ đang có trong giỏ hàng hoặc đơn chưa hoàn tất. Hãy xử lý các giỏ và đơn đó trước khi chia tồn kho theo màu và size');
    return;
  }
  for (const previous of product.variants) {
    if (nextKeys.has(variantKey(previous.color, previous.size))) continue;
    const selection = { product: product._id, color: previous.color, size: previous.size };
    const ordered = await Order.exists({ orderItems: { $elemMatch: selection } });
    const inCart = await Customer.exists({ cart: { $elemMatch: selection } });
    if (ordered || inCart) throw httpError(409, `Màu ${previous.color}, size ${previous.size} đã có trong giỏ hoặc đơn hàng. Giữ dòng này và đặt số lượng bằng 0 để ngừng bán`);
  }
};

const editableProduct = async (id, body) => {
  const product = await Product.findById(id);
  if (!product) throw httpError(404, 'Không tìm thấy sản phẩm');
  if (product.isArchived) throw httpError(409, 'Sản phẩm đã lưu trữ, không thể chỉnh sửa');
  await guardVariantChanges(product, body);
  return product;
};

const publicProduct = async (id, res) => {
  if (!databaseAvailable()) {
    const product = mockProducts.find((item) => item._id === id && !item.isHidden && !item.isArchived);
    if (!product) throw httpError(503, 'Chưa kết nối cơ sở dữ liệu. Chỉ có thể xem sản phẩm mẫu');
    res.set('X-Demo-Mode', 'true');
    return product;
  }
  const product = await Product.findOne({ _id: id, isHidden: { $ne: true }, isArchived: { $ne: true } });
  if (!product) throw httpError(404, 'Sản phẩm không tồn tại hoặc đã ngừng bán');
  return product;
};

export const getProducts = async (req, res) => {
  const keyword = queryText(req.query.keyword);
  const category = queryText(req.query.category);
  if (!databaseAvailable()) {
    res.set('X-Demo-Mode', 'true');
    return res.json(mockProducts.filter((product) => !product.isHidden && !product.isArchived
      && (!keyword || (product.name + ' ' + product.brand).toLowerCase().includes(keyword.toLowerCase()))
      && (!category || product.category === category)));
  }
  const filter = { isHidden: { $ne: true }, isArchived: { $ne: true } };
  if (keyword) filter.$or = ['name', 'brand'].map((field) => ({ [field]: { $regex: escapeRegex(keyword), $options: 'i' } }));
  if (category) filter.category = category;
  res.json(await Product.find(filter).sort({ createdAt: -1 }));
};

export const getProductById = async (req, res) => res.json(await publicProduct(req.params.id, res));

export const getAllProductsAdmin = async (req, res) => {
  const products = await Product.find({ isArchived: { $ne: true } }).sort({ createdAt: -1 });
  res.json({ success: true, count: products.length, products });
};

export const createProduct = async (req, res) => {
  const product = assignProductFields(new Product(), req.body, true);
  await product.save();
  res.status(201).json(product);
};

export const validateProductUpdate = async (req, res) => {
  const product = await editableProduct(req.params.id, req.body);
  // Validate a detached candidate before a new image is uploaded. This check
  // reserves nothing: the final update must load and check current data again.
  const candidate = assignProductFields(new Product(product.toObject()), req.body);
  await candidate.validate();
  res.json({ success: true });
};

export const updateProduct = async (req, res) => {
  const product = await editableProduct(req.params.id, req.body);
  assignProductFields(product, req.body);
  await product.save();
  res.json(product);
};

export const updateProductStock = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Không tìm thấy sản phẩm');
  if (product.isArchived) throw httpError(409, 'Sản phẩm đã lưu trữ, không thể chỉnh sửa');
  if (req.body.variants !== undefined) {
    await guardVariantChanges(product, req.body);
    assignProductFields(product, { variants: req.body.variants });
  } else {
    if (hasProductVariants(product)) throw httpError(400, 'Vui lòng cập nhật số lượng của từng màu và size');
    product.countInStock = nonNegativeInteger(req.body.countInStock, 'Tồn kho');
  }
  await product.save();
  res.json(product);
};

export const toggleProductVisibility = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Không tìm thấy sản phẩm');
  if (product.isArchived) throw httpError(409, 'Sản phẩm đã lưu trữ, không thể hiển thị lại');
  product.isHidden = !product.isHidden;
  await product.save();
  res.json({ success: true, product, message: product.isHidden ? 'Đã ẩn sản phẩm' : 'Đã hiển thị sản phẩm' });
};

export const deleteProduct = async (req, res) => {
  // A checkout may have reserved the final pair without saving its order yet.
  // Retain the SKU and its variant rows, so that checkout rollback/cancellation
  // can still restore the exact stock. Bumping __v invalidates stale admin saves.
  const product = await Product.findOneAndUpdate({ _id: req.params.id, isArchived: { $ne: true } }, {
    $set: { isArchived: true, isHidden: true }, $inc: { __v: 1 },
  }, { new: true });
  if (!product) {
    const existing = await Product.findById(req.params.id);
    if (!existing) throw httpError(404, 'Không tìm thấy sản phẩm');
    if (!existing.isArchived) throw httpError(409, 'Sản phẩm vừa được thay đổi. Vui lòng tải lại');
  }
  res.json({ message: 'Đã lưu trữ sản phẩm' });
};

export const getProductReviews = async (req, res) => {
  const product = await publicProduct(req.params.id, res);
  res.json({ reviews: product.reviews || [], numReviews: product.numReviews || 0, rating: product.rating || 0 });
};

export const createProductReview = async (req, res) => {
  throw httpError(410, 'Vui lòng viết hoặc sửa đánh giá trong Đơn hàng của tôi sau khi đơn đã giao');
};

export const deleteProductReview = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Không tìm thấy sản phẩm');
  const review = product.reviews.id(req.params.reviewId);
  if (!review) throw httpError(404, 'Không tìm thấy đánh giá');
  if (!req.user.isAdmin && String(review.user) !== String(req.user._id)) throw httpError(403, 'Bạn không có quyền xóa đánh giá này');
  product.reviews = product.reviews.filter((entry) => String(entry._id) !== String(review._id));
  product.numReviews = product.reviews.length;
  product.rating = product.numReviews ? product.reviews.reduce((total, entry) => total + entry.rating, 0) / product.numReviews : 0;
  await product.save();
  res.json({ message: 'Đã xóa đánh giá', reviews: product.reviews, numReviews: product.numReviews, rating: product.rating });
};

export const getBestSellingProducts = async (req, res) => res.json(await Order.aggregate([
  { $match: { checkoutState: { $ne: 'pending' }, isPaid: true, orderStatus: { $nin: NON_SALES_STATUSES } } },
  { $unwind: '$orderItems' },
  { $group: { _id: '$orderItems.product', totalSold: { $sum: '$orderItems.quantity' }, totalRevenue: { $sum: { $multiply: ['$orderItems.quantity', '$orderItems.price'] } } } },
  { $sort: { totalSold: -1 } },
  { $limit: 10 },
  { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'productInfo' } },
  { $unwind: '$productInfo' },
  { $project: { _id: 1, name: '$productInfo.name', image: '$productInfo.image', category: '$productInfo.category', price: '$productInfo.price', totalSold: 1, totalRevenue: 1 } },
]));

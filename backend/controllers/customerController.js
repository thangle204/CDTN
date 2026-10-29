import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import generateToken from '../utils/generateToken.js';
import { hashPassword } from '../utils/hashPassword.js';
import { cleanText, httpError, normalizeEmail, normalizePhone, normalizeSize, positiveQuantity, validatePassword } from '../utils/validation.js';
import { assertCartStock, assertCartUnlocked, findCartItem, productIdOf } from '../utils/cart.js';
import { getProductVariant, variantKey } from '../utils/productVariants.js';
import { withAdminRoleGuard } from '../utils/adminGuard.js';
import { NON_SALES_STATUSES } from '../utils/orderPricing.js';
import { productSalePrice } from '../../shared/productPricing.js';

const profileOf = (customer) => ({
  _id: customer._id,
  name: customer.name,
  email: customer.email,
  phone: customer.phone,
  isAdmin: customer.isAdmin,
  isActive: customer.isActive,
});
const tokenFor = (customer) => generateToken(customer._id, { authVersion: customer.authVersion });
const cartResponse = (customer) => customer.cart.filter((item) => item.product).map((item) => ({
  ...item.toObject(),
  name: item.product.name,
  image: item.product.image,
  price: productSalePrice(item.product),
}));
const saveCart = async (customer, res, status = 200) => {
  await customer.save();
  await customer.populate('cart.product');
  res.status(status).json(cartResponse(customer));
};

export const registerCustomer = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const name = cleanText(req.body.name, 'Họ tên', { max: 100 });
  const phone = normalizePhone(req.body.phone);
  const password = validatePassword(req.body.password);
  if (await Customer.exists({ email })) throw httpError(409, 'Email đã tồn tại');
  const customer = await Customer.create({ email, name, phone, password });
  res.status(201).json({ ...profileOf(customer), token: tokenFor(customer) });
};

export const loginCustomer = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (typeof req.body.password !== 'string') throw httpError(400, 'Vui lòng nhập mật khẩu');
  const customer = await Customer.findOne({ email });
  if (!customer || !(await customer.matchPassword(req.body.password))) {
    throw httpError(401, 'Email hoặc mật khẩu không chính xác');
  }
  if (customer.isActive === false) throw httpError(403, 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ cửa hàng');
  res.json({ ...profileOf(customer), token: tokenFor(customer) });
};

export const getCustomerProfile = async (req, res) => {
  const customer = await Customer.findById(req.user._id);
  if (!customer) throw httpError(404, 'Không tìm thấy khách hàng');
  res.json(profileOf(customer));
};

export const updateUserProfile = async (req, res) => {
  const customer = await Customer.findById(req.user._id);
  if (!customer) throw httpError(404, 'Không tìm thấy khách hàng');
  if (req.body.name !== undefined) customer.name = cleanText(req.body.name, 'Họ tên', { max: 100 });
  if (req.body.phone !== undefined) customer.phone = normalizePhone(req.body.phone);
  if (req.body.newPassword !== undefined && req.body.newPassword !== '') {
    validatePassword(req.body.newPassword);
    if (typeof req.body.currentPassword !== 'string' || !(await customer.matchPassword(req.body.currentPassword))) {
      throw httpError(400, 'Mật khẩu hiện tại không đúng');
    }
    customer.password = req.body.newPassword;
    customer.authVersion = (customer.authVersion ?? 0) + 1;
    customer.resetPasswordToken = undefined;
    customer.resetPasswordExpires = undefined;
  }
  await customer.save();
  res.json({ ...profileOf(customer), token: tokenFor(customer) });
};

export const getCustomerCart = async (req, res) => {
  const customer = await Customer.findById(req.user._id).populate('cart.product');
  if (!customer) throw httpError(404, 'Không tìm thấy khách hàng');
  res.json(cartResponse(customer));
};

export const addItemToCart = async (req, res) => {
  const quantity = positiveQuantity(req.body.quantity ?? 1);
  const customer = await Customer.findById(req.user._id);
  assertCartUnlocked(customer);
  const product = await Product.findById(req.body.productId);
  if (!product || product.isHidden || product.isArchived) throw httpError(404, 'Sản phẩm không còn được bán');
  const size = normalizeSize(req.body.size, product.sizes);
  const variant = getProductVariant(product, size, req.body.color);
  const color = variant?.color || '';
  const existing = customer.cart.find((item) => productIdOf(item) === String(product._id)
    && item.size === size && variantKey(item.color, size) === variantKey(color, size));
  const newQuantity = (existing?.quantity ?? 0) + quantity;
  assertCartStock(customer.cart, product, newQuantity, existing?._id, { size, color });
  if (existing) {
    existing.quantity = newQuantity;
    existing.price = productSalePrice(product);
    existing.name = product.name;
    existing.image = product.image;
  } else {
    customer.cart.push({ product: product._id, name: product.name, image: product.image, price: productSalePrice(product), quantity, size, color });
  }
  await saveCart(customer, res, 201);
};

export const updateCartItemQuantity = async (req, res) => {
  const quantity = positiveQuantity(req.body.quantity);
  const customer = await Customer.findById(req.user._id);
  assertCartUnlocked(customer);
  const item = findCartItem(customer.cart, req.body);
  if (!item) throw httpError(404, 'Không tìm thấy dòng sản phẩm trong giỏ hàng');
  const product = await Product.findById(item.product);
  if (!product || product.isHidden || product.isArchived) throw httpError(404, 'Sản phẩm không còn được bán. Vui lòng xóa khỏi giỏ hàng');
  normalizeSize(item.size, product.sizes);
  if (quantity < item.quantity) {
    // Cart edits do not reserve inventory. Allow partial reductions even if
    // other shared-stock lines still exceed today's stock; checkout stays strict.
    getProductVariant(product, item.size, item.color);
  } else {
    assertCartStock(customer.cart, product, quantity, item._id, item);
  }
  item.quantity = quantity;
  item.price = productSalePrice(product);
  item.name = product.name;
  item.image = product.image;
  await saveCart(customer, res);
};

export const removeItemFromCart = async (req, res) => {
  const customer = await Customer.findById(req.user._id);
  assertCartUnlocked(customer);
  const id = req.params.cartItemId ?? req.params.productId;
  const item = findCartItem(customer.cart, { cartItemId: id })
    ?? findCartItem(customer.cart, { productId: id });
  if (!item) throw httpError(404, 'Không tìm thấy dòng sản phẩm trong giỏ hàng');
  customer.cart = customer.cart.filter((row) => String(row._id) !== String(item._id));
  await saveCart(customer, res);
};

export const clearCart = async (req, res) => {
  const customer = await Customer.findById(req.user._id);
  assertCartUnlocked(customer);
  customer.cart = [];
  await saveCart(customer, res);
};

export const updateCustomerByAdmin = async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw httpError(404, 'Không tìm thấy khách hàng');
  if (req.body.name !== undefined) customer.name = cleanText(req.body.name, 'Họ tên', { max: 100 });
  if (req.body.phone !== undefined) customer.phone = normalizePhone(req.body.phone);
  if (req.body.password) {
    customer.password = validatePassword(req.body.password);
    customer.authVersion = (customer.authVersion ?? 0) + 1;
    customer.resetPasswordToken = undefined;
    customer.resetPasswordExpires = undefined;
  }
  await customer.save();
  res.json(profileOf(customer));
};

export const getAllCustomers = async (req, res) => {
  const [customers, stats] = await Promise.all([
    Customer.find({}).select('name email phone isAdmin isActive createdAt').sort({ createdAt: -1 }).lean(),
    Order.aggregate([
      { $match: { checkoutState: { $ne: 'pending' } } },
      { $group: {
        _id: '$user',
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: { $cond: [{ $and: [{ $eq: ['$isPaid', true] }, { $not: [{ $in: ['$orderStatus', NON_SALES_STATUSES] }] }] }, '$totalPrice', 0] } },
      } },
    ]),
  ]);
  const statsByCustomer = new Map(stats.map((stat) => [String(stat._id), stat]));
  res.json(customers.map((customer) => ({
    ...customer,
    totalOrders: statsByCustomer.get(String(customer._id))?.totalOrders ?? 0,
    totalSpent: statsByCustomer.get(String(customer._id))?.totalSpent ?? 0,
  })));
};

export const toggleCustomerAdmin = async (req, res) => {
  const customer = await withAdminRoleGuard(req, async () => {
    const target = await Customer.findById(req.params.id);
    if (!target) throw httpError(404, 'Không tìm thấy khách hàng');
    if (req.accountType === 'customer' && String(target._id) === String(req.user._id)) {
      throw httpError(400, 'Bạn không thể tự thay đổi quyền quản trị của mình');
    }
    if (target.isActive === false && !target.isAdmin) throw httpError(400, 'Hãy kích hoạt tài khoản trước khi cấp quyền quản trị');
    if (target.isAdmin) {
      const [customerAdmins, staffAdmins] = await Promise.all([
        Customer.countDocuments({ isAdmin: true, isActive: { $ne: false } }),
        Staff.countDocuments({ isAdmin: true, isActive: { $ne: false } }),
      ]);
      if (customerAdmins + staffAdmins <= 1) throw httpError(400, 'Cần giữ ít nhất một tài khoản quản trị đang hoạt động');
    }
    target.isAdmin = !target.isAdmin;
    target.authVersion = (target.authVersion ?? 0) + 1;
    await target.save();
    return target;
  });
  res.json({ ...profileOf(customer), message: customer.isAdmin ? 'Đã cấp quyền quản trị' : 'Đã gỡ quyền quản trị' });
};

export const toggleCustomerActive = async (req, res) => {
  const customer = await withAdminRoleGuard(req, async () => {
    const target = await Customer.findById(req.params.id);
    if (!target) throw httpError(404, 'Không tìm thấy khách hàng');
    if (target.isAdmin) throw httpError(400, 'Không thể vô hiệu hóa tài khoản quản trị');
    target.isActive = !target.isActive;
    target.authVersion = (target.authVersion ?? 0) + 1;
    await target.save();
    return target;
  });
  res.json({ ...profileOf(customer), message: customer.isActive ? 'Đã kích hoạt tài khoản' : 'Đã vô hiệu hóa tài khoản' });
};

const smtpTransport = () => {
  if (!process.env.SMTP_HOST || !(process.env.SMTP_FROM || process.env.SMTP_USER)) {
    throw httpError(503, 'Cửa hàng chưa cấu hình email khôi phục mật khẩu. Vui lòng liên hệ quản trị viên');
  }
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
};

export const forgotPassword = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const transport = smtpTransport();
  const message = 'Nếu email thuộc một tài khoản đang hoạt động, hướng dẫn đặt lại mật khẩu sẽ được gửi đến email đó';
  const customer = await Customer.findOne({ email, isActive: { $ne: false } });
  if (!customer) return res.json({ message });
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  customer.resetPasswordToken = tokenHash;
  customer.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  await customer.save();
  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customer.email,
      subject: 'SHOE STORE - Đặt lại mật khẩu',
      text: 'Bạn đã yêu cầu đặt lại mật khẩu tại SHOE STORE.\nMở liên kết sau trong vòng 15 phút:\n'
        + baseUrl + '/reset-password/' + token
        + '\nNếu bạn không yêu cầu thay đổi, hãy bỏ qua email này.',
    });
  } catch {
    await Customer.updateOne({ _id: customer._id, resetPasswordToken: tokenHash }, {
      $unset: { resetPasswordToken: '', resetPasswordExpires: '' },
    });
    throw httpError(503, 'Chưa thể gửi email khôi phục mật khẩu. Vui lòng thử lại sau');
  }
  res.json({ message });
};

export const resetPassword = async (req, res) => {
  validatePassword(req.body.password);
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) throw httpError(400, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const customer = await Customer.findOneAndUpdate({
    resetPasswordToken: tokenHash,
    resetPasswordExpires: { $gt: new Date() },
    isActive: { $ne: false },
  }, {
    $set: { password: await hashPassword(req.body.password) },
    $unset: { resetPasswordToken: '', resetPasswordExpires: '' },
    $inc: { authVersion: 1, __v: 1 },
  }, { new: true });
  if (!customer) throw httpError(400, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
  res.json({ message: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới' });
};

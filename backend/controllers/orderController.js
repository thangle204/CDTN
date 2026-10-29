import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Order from '../models/orderModel.js';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import {
  calculateOrderPricing, isMoney, isPositiveInteger, isShoeSize,
  orderError, validateOrderTransition, validateVoucherEligibility,
  FAILED_DELIVERY_STATUSES, NON_SALES_STATUSES,
} from '../utils/orderPricing.js';
import { getProductVariant, variantKey } from '../utils/productVariants.js';
import { checkoutCartKey } from '../utils/checkoutCart.js';
import { releaseCheckoutReservations } from '../utils/checkoutReservations.js';
import { publicOrder, publicCustomerOrder } from '../utils/orderPresentation.js';
import { getVnpayConfig } from '../utils/vnpay.js';
import { checkVoucherCustomer, reserveVoucher, releaseVoucherUsage, finishVoucherRelease } from '../utils/voucherUsage.js';
import { grantCustomerVouchers } from './voucherController.js';

const CHECKOUT_LOCK_MS = 10 * 60 * 1000;
const COMMITTED_ORDERS = { checkoutState: { $ne: 'pending' } };
const PAID_ORDERS = { ...COMMITTED_ORDERS, isPaid: true, orderStatus: { $nin: NON_SALES_STATUSES } };
const requireCommittedOrder = (order) => {
  if (order.checkoutState === 'pending') throw orderError(409, 'Đơn hàng đang được tạo. Vui lòng chờ thanh toán hoàn tất');
};
const fail = (res, error) => {
  const status = error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('Order operation failed:', error.message);
  return res.status(status).json({ message: status === 500 ? 'Không thể xử lý đơn hàng lúc này. Vui lòng thử lại.' : error.message });
};
const requireAdmin = (req) => {
  if (!req.user?.isAdmin) throw orderError(403, 'Yêu cầu quyền quản trị viên');
};
const requireOrderId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw orderError(400, 'Mã đơn hàng không hợp lệ');
};
const ownsOrder = (order, user) => String(order.user?._id || order.user) === String(user._id);
const sessionFilter = (user) => ({
  isActive: { $ne: false },
  ...((user.authVersion || 0) === 0
    ? { $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] }
    : { authVersion: user.authVersion }),
});

const normalizeShippingAddress = (input, customer) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw orderError(400, 'Vui lòng nhập thông tin giao hàng');
  }
  const shipping = {};
  for (const field of ['name', 'address', 'city', 'district', 'ward', 'phone', 'notes']) {
    const value = field === 'name' ? input.name || input.recipientName || customer.name || customer.email : input[field];
    if (value != null && typeof value !== 'string') throw orderError(400, 'Thông tin giao hàng không hợp lệ');
    shipping[field] = value?.trim() || '';
  }
  if (!shipping.name || !shipping.address || !shipping.city || !/^0\d{9}$/.test(shipping.phone)) {
    throw orderError(400, 'Vui lòng nhập tên, địa chỉ, tỉnh/thành phố và số điện thoại 10 số bắt đầu bằng 0');
  }
  return shipping;
};

const aggregateStock = (items) => {
  const quantities = new Map();
  for (const item of items) {
    if (!isPositiveInteger(item.quantity)) throw orderError(400, 'Số lượng sản phẩm phải là số nguyên dương');
    const key = JSON.stringify([String(item.product), item.inventoryVariant ? variantKey(item.color, item.size) : null]);
    const current = quantities.get(key);
    const quantity = (current?.quantity || 0) + item.quantity;
    if (!isPositiveInteger(quantity)) throw orderError(400, 'Số lượng sản phẩm vượt giới hạn cho phép');
    quantities.set(key, {
      product: item.product, quantity, name: item.name,
      ...(item.inventoryVariant ? { inventoryVariant: true, color: item.color, size: item.size } : {}),
    });
  }
  return [...quantities.values()];
};

const inventoryChange = (item, delta) => {
  const filter = {
    _id: item.product,
    countInStock: delta < 0 ? { $gte: -delta } : { $lte: Number.MAX_SAFE_INTEGER - delta },
  };
  const increments = { countInStock: delta, __v: 1 };
  if (item.inventoryVariant) {
    filter.variants = { $elemMatch: {
      color: item.color, size: item.size,
      quantity: delta < 0 ? { $gte: -delta } : { $lte: Number.MAX_SAFE_INTEGER - delta },
    } };
    increments['variants.$.quantity'] = delta;
  } else {
    // Never apply old shared-stock order quantities to newly allocated variants.
    filter.$or = [{ variants: { $exists: false } }, { variants: { $size: 0 } }];
  }
  return { filter, update: { $inc: increments } };
};

const changeInventory = (item, delta) => {
  const { filter, update } = inventoryChange(item, delta);
  return Product.updateOne(filter, update);
};

const addOrderItems = async (req, res) => {
  let customer;
  let order;
  let committed = false;
  let saveAttempted = false;
  let cartClearAttempted = false;
  let originalCart;
  let reservedVoucher;
  const reservedStock = [];
  const token = randomUUID();
  const markRecoveryRequired = async () => {
    if (!customer) return;
    try {
      await Customer.updateOne({ _id: customer._id, 'checkoutLock.token': token }, {
        $set: { 'checkoutLock.recoveryRequired': true }, $inc: { __v: 1 },
      });
    } catch (claimError) { console.error('Cannot persist checkout recovery claim:', claimError.message); }
  };
  const finishCommittedCheckout = async () => {
    try {
      await releaseCheckoutReservations(reservedStock, token);
      const released = await Customer.updateOne({ _id: customer._id, 'checkoutLock.token': token }, {
        $set: { checkoutLock: null }, $inc: { __v: 1 },
      });
      if (!released.matchedCount) throw new Error('The committed checkout no longer owns its customer claim');
    } catch (cleanupError) {
      // The order is durable. Keep protection for an operator to reconcile;
      // cleanup errors must never delete the order or return its inventory.
      console.error('Committed checkout cleanup requires recovery:', String(order._id), cleanupError.message);
      await markRecoveryRequired();
    }
  };
  try {
    if (req.accountType === 'staff' || req.user.accountType === 'staff') throw orderError(403, 'Tài khoản nhân viên không có giỏ hàng khách hàng');
    const paymentMethod = req.body.paymentMethod || 'COD';
    // BANK remains supported for historical orders, but cannot be selected for a new order.
    if (!['COD', 'VNPAY'].includes(paymentMethod)) throw orderError(400, 'Vui lòng chọn thanh toán khi nhận hàng (COD) hoặc VNPAY');
    // Fail before claiming a cart/reserving stock when Sandbox is not set up.
    if (paymentMethod === 'VNPAY') getVnpayConfig();
    const expectedCart = checkoutCartKey(req.body.expectedCart);
    const now = new Date();
    // Bump __v so a cart mutation loaded before this claim cannot overwrite it.
    customer = await Customer.findOneAndUpdate({
      _id: req.user._id,
      $and: [sessionFilter(req.user), { $or: [
        { checkoutLock: null }, { 'checkoutLock.expiresAt': { $lte: now }, 'checkoutLock.recoveryRequired': { $ne: true } },
      ] }],
    }, {
      $set: { checkoutLock: { token, expiresAt: new Date(now.getTime() + CHECKOUT_LOCK_MS) } },
      $inc: { __v: 1 },
    }, { new: true });
    if (!customer) throw orderError(409, 'Giỏ hàng đang được thanh toán hoặc phiên đăng nhập đã thay đổi. Vui lòng tải lại.');
    if (!customer.cart?.length) throw orderError(400, 'Không có sản phẩm nào trong giỏ hàng');
    if (customer.cart.length > 100) throw orderError(400, 'Mỗi đơn hàng tối đa 100 dòng sản phẩm');
    originalCart = customer.cart.map(item => typeof item.toObject === 'function' ? item.toObject() : { ...item });
    if (expectedCart !== checkoutCartKey(customer.cart)) {
      throw orderError(409, 'Sản phẩm, màu, size hoặc số lượng trong giỏ đã thay đổi. Vui lòng kiểm tra và xác nhận lại đơn hàng.');
    }

    const ids = customer.cart.map((item) => item.product);
    const products = await Product.find({ _id: { $in: ids } });
    const byId = new Map(products.map((product) => [String(product._id), product]));
    const orderItems = customer.cart.map((item) => {
      const product = byId.get(String(item.product));
      if (!product || product.isHidden || product.isArchived) throw orderError(400, `Sản phẩm ${item.name} hiện không còn bán`);
      if (!isPositiveInteger(item.quantity)) throw orderError(400, 'Số lượng sản phẩm phải là số nguyên dương');
      if (!isMoney(product.price)) throw orderError(400, `Giá sản phẩm ${product.name} không hợp lệ`);
      const variant = getProductVariant(product, item.size, item.color);
      let size;
      if (item.size != null) {
        size = Number(item.size);
        if (!isShoeSize(size) || !product.sizes?.includes(size)) {
          throw orderError(400, `Size ${item.size} của ${product.name} hiện không còn bán`);
        }
      } else if (product.sizes?.length) {
        throw orderError(400, `Vui lòng chọn size cho ${product.name} trong giỏ hàng`);
      }
      return {
        name: product.name, quantity: item.quantity, image: product.image, price: product.price,
        product: product._id, ...(size == null ? {} : { size }),
        ...(variant ? { color: variant.color, inventoryVariant: true } : {}),
      };
    });
    const itemsPrice = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let voucher;
    let voucherCustomer;
    if (req.body.voucherCode) {
      if (typeof req.body.voucherCode !== 'string') throw orderError(400, 'Mã voucher không hợp lệ');
      voucher = await Voucher.findOne({ code: req.body.voucherCode.trim().toUpperCase() });
      validateVoucherEligibility(voucher, itemsPrice, now);
      voucherCustomer = await checkVoucherCustomer(voucher, req.user._id, itemsPrice, now);
    }
    const pricing = calculateOrderPricing(itemsPrice, voucher);
    if (paymentMethod === 'VNPAY' && (pricing.totalPrice < 5000 || pricing.totalPrice > 9999999999)) {
      throw orderError(400, 'Thanh toán VNPAY yêu cầu số tiền từ 5.000đ và nằm trong giới hạn cho phép');
    }
    if (req.body.expectedTotalPrice !== undefined) {
      if (!isMoney(req.body.expectedTotalPrice)) throw orderError(400, 'Tổng tiền xác nhận không hợp lệ');
      if (req.body.expectedTotalPrice !== pricing.totalPrice) {
        throw orderError(409, 'Giá sản phẩm hoặc ưu đãi đã thay đổi. Vui lòng kiểm tra lại tổng tiền trước khi đặt hàng.');
      }
    }
    order = new Order({
      checkoutState: 'pending', checkoutToken: token,
      user: req.user._id, orderItems,
      shippingAddress: normalizeShippingAddress(req.body.shippingAddress, customer),
      paymentMethod,
      ...(paymentMethod === 'VNPAY' ? { paymentDeadline: new Date(now.getTime() + 30 * 60000) } : {}),
      ...pricing,
      ...(voucher ? { voucherCode: voucher.code, voucher: { _id: voucher._id, code: voucher.code, type: voucher.type, discount: voucher.discount,
        maxDiscount: voucher.maxDiscount, reservationToken: token, wallet: voucherCustomer.wallet?._id } } : {}),
      isPaid: false,
    });
    await order.validate();

    const productVersions = new Map(products.map((product) => [String(product._id), product.__v]));
    for (const item of aggregateStock(orderItems)) {
      const product = byId.get(String(item.product));
      const sizes = orderItems.filter((line) => String(line.product) === String(item.product) && line.size != null).map((line) => line.size);
      const { filter, update } = inventoryChange(item, -item.quantity);
      const version = productVersions.get(String(item.product));
      const updated = await Product.findOneAndUpdate({
        ...filter, isHidden: { $ne: true }, isArchived: { $ne: true }, price: product.price,
        ...(Number.isSafeInteger(version) ? { __v: version } : {}),
        ...(!item.inventoryVariant && sizes.length ? { sizes: { $all: sizes } } : {}),
      }, { ...update, $addToSet: { checkoutReservations: token } }, { new: true });
      if (!updated) throw orderError(409, `Tồn kho hoặc thông tin ${product.name} đã thay đổi. Vui lòng kiểm tra lại giỏ hàng.`);
      productVersions.set(String(item.product), updated.__v);
      reservedStock.push(item);
    }
    if (voucher) {
      reservedVoucher = await reserveVoucher({ voucher, user: req.user._id, order: order._id, token, itemsPrice, customer: voucherCustomer });
      if (!reservedVoucher) throw orderError(409, 'Voucher đã thay đổi hoặc hết lượt. Vui lòng áp dụng lại.');
    }
    const renewed = await Customer.updateOne({
      _id: req.user._id, 'checkoutLock.token': token, 'checkoutLock.expiresAt': { $gt: new Date() },
      ...sessionFilter(req.user),
    }, { $set: { 'checkoutLock.expiresAt': new Date(Date.now() + CHECKOUT_LOCK_MS) } });
    if (!renewed.matchedCount) throw orderError(409, 'Phiên thanh toán đã hết hạn. Vui lòng thử lại.');
    saveAttempted = true;
    await order.save();
    cartClearAttempted = true;
    const cleared = await Customer.updateOne({ _id: customer._id, 'checkoutLock.token': token }, {
      $set: { cart: [] }, $inc: { __v: 1 },
    });
    if (!cleared.matchedCount) throw orderError(409, 'Giỏ hàng đã thay đổi trong lúc thanh toán');
    const finalized = await Order.findOneAndUpdate({
      _id: order._id, checkoutState: 'pending', checkoutToken: token,
      isPaid: false, orderStatus: 'Đang xử lý', stockRestored: { $ne: true }, cancellationLock: null,
    }, { $set: { checkoutState: 'committed' }, $inc: { __v: 1 } }, { new: true, runValidators: true });
    if (!finalized) throw orderError(409, 'Không thể hoàn tất tạo đơn hàng. Vui lòng thử lại');
    order = finalized;
    committed = true;
    await finishCommittedCheckout();
    return res.status(201).json(publicCustomerOrder(order));
  } catch (error) {
    // Compensating writes also work with standalone MongoDB, without transactions.
    if (!committed) {
      let canRelease = !error.voucherReservationUncertain;
      if (order && saveAttempted) {
        try {
          const removed = await Order.deleteOne({
            _id: order._id, checkoutState: 'pending', checkoutToken: token,
            isPaid: false, orderStatus: 'Đang xử lý', stockRestored: { $ne: true }, cancellationLock: null,
          });
          if (removed.deletedCount !== 1) {
            const persisted = await Order.findById(order._id);
            if (persisted?.checkoutState === 'committed' && persisted.checkoutToken === token) {
              order = persisted;
              committed = true;
              await finishCommittedCheckout();
              return res.status(201).json(publicCustomerOrder(order));
            }
            canRelease = false;
          }
        }
        catch (rollbackError) { canRelease = false; console.error('Cannot roll back saved order:', rollbackError.message); }
      }
      if (canRelease && cartClearAttempted) {
        try {
          // The token protects the snapshot from overwriting a newer checkout.
          const restored = await Customer.updateOne({ _id: customer._id, 'checkoutLock.token': token }, {
            $set: { cart: originalCart }, $inc: { __v: 1 },
          });
          if (!restored.matchedCount) canRelease = false;
        } catch (restoreError) { canRelease = false; console.error('Cannot restore checkout cart:', restoreError.message); }
      }
      if (canRelease) {
        const rollbacks = reservedStock.map((item) => changeInventory(item, item.quantity));
        if (reservedVoucher) rollbacks.push(releaseVoucherUsage(order, `checkout:${token}`));
        const results = await Promise.allSettled(rollbacks);
        canRelease = results.every((result) => result.status === 'fulfilled' && result.value.matchedCount);
        if (!canRelease) console.error('Order rollback requires recovery:', order?._id?.toString());
      }
      if (canRelease) {
        try { await releaseCheckoutReservations(reservedStock, token); }
        catch (releaseError) { canRelease = false; console.error('Cannot release inventory reservations:', releaseError.message); }
      }
      if (customer && canRelease) {
        try {
          const released = await Customer.updateOne({ _id: customer._id, 'checkoutLock.token': token }, { $set: { checkoutLock: null }, $inc: { __v: 1 } });
          if (!released.matchedCount) canRelease = false;
        } catch (releaseError) { canRelease = false; console.error('Cannot release checkout claim:', releaseError.message); }
      }
      if (customer && !canRelease) {
        await markRecoveryRequired();
        error.status = 503;
        error.message = 'Đơn hàng cần đối soát tồn kho. Vui lòng liên hệ cửa hàng trước khi thanh toán lại.';
      }
    }
    return fail(res, error);
  }
};

// Claim the cancellation before touching inventory, so concurrent requests cannot restore twice.
const cancelOrderRecord = async (id, user) => {
  requireOrderId(id);
  const existing = await Order.findById(id);
  if (!existing) throw orderError(404, 'Không tìm thấy đơn hàng');
  if (!user.isAdmin && !ownsOrder(existing, user)) throw orderError(403, 'Bạn không có quyền hủy đơn hàng này');
  requireCommittedOrder(existing);
  if (existing.deliveryReturn) throw orderError(400, 'Đơn đang hoặc đã xử lý hoàn hàng, không thể hủy theo luồng thông thường');
  if (existing.orderStatus === 'Đã hủy' && existing.stockRestored) {
    if (existing.cancellationReceipt) { try { await finishVoucherRelease(existing, existing.cancellationReceipt); } catch { /* Retry cleanup later. */ } }
    return existing;
  }
  const allowed = user.isAdmin ? ['Đang xử lý', 'Đã xác nhận'] : ['Đang xử lý'];
  if (existing.cancellationLock && existing.cancellationReceipt !== existing.cancellationLock) {
    throw orderError(503, 'Đơn có khóa hủy từ phiên bản cũ, cần cửa hàng đối soát kho và lượt mã trước khi xử lý tiếp');
  }
  const resuming = existing.orderStatus === 'Đã hủy' && existing.cancellationLock;
  if (!resuming && existing.cancellationLock) throw orderError(409, 'Đơn hàng đang được hủy. Vui lòng thử lại sau.');
  if (!resuming && !allowed.includes(existing.orderStatus)) throw orderError(400, 'Không thể hủy đơn hàng ở trạng thái hiện tại');
  const token = resuming ? existing.cancellationLock : randomUUID();
  const claimed = resuming ? existing : await Order.findOneAndUpdate({
    // Refund eligibility must come from the same payment snapshot this claim protects.
    // A concurrent payment confirmation/reversal requires a fresh read before cancellation.
    ...COMMITTED_ORDERS, _id: id, orderStatus: existing.orderStatus, isPaid: existing.isPaid,
    ...(user.paymentExpiryVersion !== undefined ? { __v: user.paymentExpiryVersion, paymentMethod: 'VNPAY', isPaid: false, paymentDeadline: { $lte: new Date() } } : {}),
    cancellationLock: null, stockRestored: { $ne: true }, 'deliveryReturn.state': { $exists: false },
  }, { $set: { orderStatus: 'Đã hủy', cancellationLock: token, refundStatus: existing.isPaid ? 'pending' : 'not_required',
    cancellationReceipt: token,
    ...(user.paymentExpiryVersion !== undefined ? { autoCancelledAt: new Date(), paymentExpiryReviewRequired: false } : {}),
  }, $inc: { __v: 1 } }, { new: true });
  if (!claimed) throw orderError(409, 'Trạng thái đơn hàng đã thay đổi. Vui lòng tải lại.');
  try {
    for (const item of aggregateStock(claimed.orderItems)) {
      const receipt = `${token}:${JSON.stringify([String(item.product), item.inventoryVariant ? variantKey(item.color, item.size) : null])}`;
      const { filter, update } = inventoryChange(item, item.quantity);
      let restored = false;
      try {
        const result = await Product.updateOne({ ...filter, cancellationReceipts: { $ne: receipt } }, {
          ...update, $addToSet: { cancellationReceipts: receipt },
        });
        restored = result.matchedCount === 1;
      } catch { /* The receipt proves a write that lost its acknowledgement. */ }
      if (!restored) {
        const persisted = await Product.findById(item.product);
        if (persisted && !persisted.cancellationReceipts?.includes(receipt)) {
          throw orderError(503, 'Chưa hoàn được đúng màu/size. Đơn giữ trạng thái hủy để tiếp tục đối soát');
        }
      }
    }
    await releaseVoucherUsage(claimed, token, { hold: true });
    const completed = await Order.findOneAndUpdate({ ...COMMITTED_ORDERS, _id: id, cancellationLock: token }, {
      $set: { stockRestored: true, voucherReleased: true, cancellationLock: null, cancellationRecoveryRequired: false }, $inc: { __v: 1 },
    }, { new: true });
    if (!completed) {
      const persisted = await Order.findById(id);
      if (persisted?.orderStatus === 'Đã hủy' && persisted.stockRestored && persisted.voucherReleased) return persisted;
      throw orderError(503, 'Chưa chốt được hủy đơn. Vui lòng thử lại để tiếp tục');
    }
    try { await finishVoucherRelease(completed, token); } catch { /* A leftover hold only prevents deletion. */ }
    return completed;
  } catch (error) {
    // Never reopen cancellation or reclaim a use released to another checkout.
    try {
      const persisted = await Order.findById(id);
      if (persisted?.stockRestored && persisted.orderStatus === 'Đã hủy' && persisted.voucherReleased) return persisted;
      await Order.updateOne({ _id: id, cancellationLock: token }, { $set: { cancellationRecoveryRequired: true }, $inc: { __v: 1 } });
    } catch { /* Retain the cancellation claim if the database is unavailable. */ }
    throw orderError(503, 'Đơn đang hoàn tất hủy; các phần đã xử lý được giữ nguyên. Vui lòng thử lại để tiếp tục');
  }
};

const cancelOrder = async (req, res) => {
  try {
    const order = await cancelOrderRecord(req.params.id, req.user);
    return res.json({ message: 'Đã hủy đơn hàng và hoàn trả tồn kho', order: req.user.isAdmin ? publicOrder(order) : publicCustomerOrder(order) });
  } catch (error) { return fail(res, error); }
};

const updateOrderStatus = async (req, res) => {
  try {
    requireAdmin(req);
    requireOrderId(req.params.id);
    const { orderStatus } = req.body;
    if (orderStatus === 'Đã hủy') return res.json(publicOrder(await cancelOrderRecord(req.params.id, req.user)));
    const order = await Order.findById(req.params.id);
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    requireCommittedOrder(order);
    if (order.cancellationLock) throw orderError(409, 'Đơn hàng đang được hủy');
    if (FAILED_DELIVERY_STATUSES.includes(order.orderStatus) || order.deliveryReturn) {
      throw orderError(400, 'Đơn giao thất bại phải được xử lý qua chức năng xác nhận hàng quay về');
    }
    validateOrderTransition(order, orderStatus);
    if (order.orderStatus === orderStatus) return res.json(publicOrder(order));
    const delivered = orderStatus === 'Đã giao';
    const updated = await Order.findOneAndUpdate({
      ...COMMITTED_ORDERS, _id: order._id, orderStatus: order.orderStatus, isPaid: order.isPaid, cancellationLock: null,
      'deliveryReturn.state': { $exists: false },
    }, { $set: {
      orderStatus, isDelivered: delivered,
      ...(delivered ? { deliveredAt: new Date(), isPaid: true, paidAt: order.paidAt || new Date() } : {}),
    }, $inc: { __v: 1 } }, { new: true, runValidators: true });
    if (!updated) throw orderError(409, 'Trạng thái đơn hàng đã thay đổi. Vui lòng tải lại.');
    if (delivered && mongoose.connection.readyState === 1) {
      try { await grantCustomerVouchers(updated.user?._id || updated.user); }
      catch { console.error('Chưa cấp được quà sau mua; khách có thể nhận lại tại Mã của tôi'); }
    }
    return res.json(publicOrder(updated));
  } catch (error) { return fail(res, error); }
};

const updateOrderToDelivered = (req, res) => updateOrderStatus({ ...req, body: { ...req.body, orderStatus: 'Đã giao' } }, res);

const updatePaymentStatus = async (req, res) => {
  try {
    requireAdmin(req);
    requireOrderId(req.params.id);
    const { isPaid } = req.body;
    if (typeof isPaid !== 'boolean') throw orderError(400, 'Trạng thái thanh toán phải là true hoặc false');
    const order = await Order.findById(req.params.id);
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    requireCommittedOrder(order);
    if (order.paymentMethod === 'VNPAY') {
      throw orderError(400, 'Thanh toán VNPAY chỉ được cập nhật từ thông báo đã xác thực của cổng thanh toán');
    }
    if (NON_SALES_STATUSES.includes(order.orderStatus) || order.cancellationLock || order.deliveryReturn) {
      throw orderError(400, 'Không thể đổi thanh toán của đơn đã hủy hoặc giao thất bại');
    }
    if (!isPaid && ['Đang giao', 'Đã giao'].includes(order.orderStatus)) {
      throw orderError(400, 'Không thể bỏ xác nhận thanh toán khi đơn đang giao hoặc đã giao');
    }
    const updated = await Order.findOneAndUpdate({ ...COMMITTED_ORDERS, _id: order._id, orderStatus: order.orderStatus, isPaid: order.isPaid, cancellationLock: null, 'deliveryReturn.state': { $exists: false } }, {
      $set: { isPaid, paidAt: isPaid ? order.paidAt || new Date() : null }, $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) throw orderError(409, 'Trạng thái đơn hàng đã thay đổi. Vui lòng tải lại.');
    return res.json(publicOrder(updated));
  } catch (error) { return fail(res, error); }
};

// This records a refund completed outside this app; it never initiates a transfer.
const confirmOrderRefund = async (req, res) => {
  try {
    requireAdmin(req);
    requireOrderId(req.params.id);
    const order = await Order.findById(req.params.id);
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    requireCommittedOrder(order);
    if (order.paymentReviewRequired) {
      throw orderError(409, 'Cần đối soát các giao dịch thanh toán dư trước khi xác nhận hoàn tiền');
    }
    const cancelled = order.orderStatus === 'Đã hủy' && order.stockRestored && !order.deliveryReturn;
    const returned = order.orderStatus === 'Đã xử lý hoàn hàng' && order.deliveryReturn?.state === 'completed'
      && isMoney(order.deliveryReturn.refundAmount) && order.deliveryReturn.refundAmount > 0;
    if ((!cancelled && !returned) || order.cancellationLock || !order.isPaid) {
      throw orderError(400, 'Chỉ xác nhận hoàn tiền sau khi đơn đã hủy và hoàn kho, hoặc đã xử lý hàng quay về với số tiền hoàn lớn hơn 0');
    }
    if (order.refundStatus === 'refunded') return res.json(publicOrder(order));
    const updated = await Order.findOneAndUpdate({
      ...COMMITTED_ORDERS, _id: order._id, orderStatus: order.orderStatus, isPaid: true,
      ...(cancelled ? { stockRestored: true, 'deliveryReturn.state': { $exists: false } } : {
        'deliveryReturn.state': 'completed', 'deliveryReturn.refundAmount': order.deliveryReturn.refundAmount,
      }),
      cancellationLock: null, refundStatus: { $ne: 'refunded' },
      paymentReviewRequired: { $ne: true },
    }, { $set: { refundStatus: 'refunded', refundedAt: new Date() }, $inc: { __v: 1 } }, { new: true, runValidators: true });
    if (!updated) throw orderError(409, 'Trạng thái hoàn tiền đã thay đổi. Vui lòng tải lại.');
    return res.json(publicOrder(updated));
  } catch (error) { return fail(res, error); }
};

const getMyOrders = async (req, res) => {
  try { return res.json((await Order.find({ ...COMMITTED_ORDERS, user: req.user._id }).sort({ createdAt: -1 })).map(publicCustomerOrder)); }
  catch (error) { return fail(res, error); }
};

const getOrders = async (req, res) => {
  try {
    requireAdmin(req);
    const query = { ...COMMITTED_ORDERS };
    if (req.query.search) {
      if (typeof req.query.search !== 'string' || req.query.search.length > 100) throw orderError(400, 'Từ khóa tìm kiếm không hợp lệ');
      const search = req.query.search.trim().replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
      query.$or = [
        { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: search, options: 'i' } } },
        { 'shippingAddress.name': { $regex: search, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } },
      ];
    }
    const orders = await Order.find(query).populate('user', 'name email').sort({ createdAt: -1 });
    return res.json(orders.map(publicOrder));
  } catch (error) { return fail(res, error); }
};

const getOrderById = async (req, res) => {
  try {
    requireOrderId(req.params.id);
    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    if (!req.user.isAdmin && !ownsOrder(order, req.user)) throw orderError(403, 'Không có quyền truy cập đơn hàng này');
    requireCommittedOrder(order);
    return res.json(req.user.isAdmin ? publicOrder(order) : publicCustomerOrder(order));
  } catch (error) { return fail(res, error); }
};

const deleteOrder = async (req, res) => {
  try {
    requireAdmin(req);
    requireOrderId(req.params.id);
    const order = await Order.findById(req.params.id);
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    requireCommittedOrder(order);
    if (order.paymentMethod === 'VNPAY') {
      throw orderError(400, 'Cần giữ đơn VNPAY để đối chiếu thông báo thanh toán và hoàn tiền đến muộn');
    }
    if (order.orderStatus !== 'Đã hủy' || !order.stockRestored || order.cancellationLock || order.deliveryReturn) {
      throw orderError(400, 'Chỉ được xóa đơn đã hủy và hoàn tất hoàn kho');
    }
    if (order.isPaid && order.refundStatus !== 'refunded') throw orderError(400, 'Cần hoàn tiền và xác nhận đã hoàn tiền trước khi xóa đơn');
    const result = await Order.deleteOne({
      ...COMMITTED_ORDERS, _id: order._id, orderStatus: 'Đã hủy', stockRestored: true, cancellationLock: null,
      paymentMethod: { $ne: 'VNPAY' },
      'deliveryReturn.state': { $exists: false },
      $or: [{ isPaid: false }, { refundStatus: 'refunded' }],
    });
    if (!result.deletedCount) throw orderError(409, 'Đơn hàng đã thay đổi. Vui lòng tải lại.');
    return res.json({ message: 'Đã xóa đơn hàng đã hủy' });
  } catch (error) { return fail(res, error); }
};

const getRevenueStats = async (req, res) => {
  try {
    requireAdmin(req);
    const { period = 'month' } = req.query;
    const date = { $ifNull: ['$paidAt', '$createdAt'] };
    const part = (operator) => ({ [operator]: { date, timezone: 'Asia/Ho_Chi_Minh' } });
    let groupBy = { year: part('$year'), month: part('$month') };
    if (period === 'day') groupBy.day = part('$dayOfMonth');
    else if (period === 'week') groupBy = { year: part('$isoWeekYear'), week: part('$isoWeek') };
    else if (period === 'year') groupBy = { year: part('$year') };
    else if (period !== 'month') throw orderError(400, 'Khoảng thống kê không hợp lệ');
    const revenue = await Order.aggregate([
      { $match: PAID_ORDERS },
      { $group: { _id: groupBy, totalRevenue: { $sum: '$totalPrice' }, orderCount: { $sum: 1 }, averageOrder: { $avg: '$totalPrice' } } },
      { $sort: { '_id.year': -1, '_id.month': -1, '_id.week': -1, '_id.day': -1 } },
      { $limit: 12 },
    ]);
    return res.json(revenue);
  } catch (error) { return fail(res, error); }
};

const getTopCustomers = async (req, res) => {
  try {
    requireAdmin(req);
    const customers = await Order.aggregate([
      { $match: PAID_ORDERS },
      { $group: { _id: '$user', totalOrders: { $sum: 1 }, totalSpent: { $sum: '$totalPrice' }, averageOrder: { $avg: '$totalPrice' } } },
      { $sort: { totalSpent: -1, totalOrders: -1 } }, { $limit: 10 },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customerInfo' } },
      { $unwind: '$customerInfo' },
      { $project: { _id: 1, name: '$customerInfo.name', email: '$customerInfo.email', phone: '$customerInfo.phone', totalOrders: 1, totalSpent: 1, averageOrder: 1 } },
    ]);
    return res.json(customers);
  } catch (error) { return fail(res, error); }
};

const getOrdersOverview = async (req, res) => {
  try {
    requireAdmin(req);
    const [totalOrders, totalCustomers, revenue, ordersByStatus, recentOrders] = await Promise.all([
      Order.countDocuments(COMMITTED_ORDERS), Customer.countDocuments(),
      Order.aggregate([{ $match: PAID_ORDERS }, { $group: { _id: null, total: { $sum: '$totalPrice' } } }]),
      Order.aggregate([{ $match: COMMITTED_ORDERS }, { $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      Order.find(COMMITTED_ORDERS).sort({ createdAt: -1 }).limit(5).populate('user', 'name email'),
    ]);
    return res.json({ totalOrders, totalCustomers, totalRevenue: revenue[0]?.total || 0, ordersByStatus, recentOrders: recentOrders.map(publicOrder) });
  } catch (error) { return fail(res, error); }
};

export {
  cancelOrderRecord,
  addOrderItems, getMyOrders, getOrders, updateOrderStatus, updateOrderToDelivered,
  getOrderById, deleteOrder, getRevenueStats, getTopCustomers, getOrdersOverview,
  updatePaymentStatus, cancelOrder, confirmOrderRefund,
};

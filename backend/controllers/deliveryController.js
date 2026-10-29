import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { cleanText, httpError } from '../utils/validation.js';
import { publicOrder } from '../utils/orderPresentation.js';
import { aggregateRestockItems, calculateDeliveryReturnAmounts, normalizeDeliveryReturnRequest } from '../utils/deliveryReturn.js';

const FAILED = 'Giao thất bại';
const RETURNED = 'Đã xử lý hoàn hàng';
const COMMITTED = { checkoutState: { $ne: 'pending' } };
const recoveryError = () => httpError(503, 'Chưa thể hoàn tất xử lý hàng hoàn. Kết quả đã ghi nhận được giữ lại; vui lòng thử lại cùng kết quả kiểm tra hoặc liên hệ cửa hàng để đối soát.');
const fail = (res, error) => res.status(error.status || 500).json({
  message: error.status ? error.message : 'Không thể xử lý giao hàng lúc này. Vui lòng thử lại.',
});
const requireRequest = (req) => {
  if (!req.user?.isAdmin) throw httpError(403, 'Yêu cầu quyền quản trị viên');
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Mã đơn hàng không hợp lệ');
};
const requireCommitted = (order) => {
  if (!order) throw httpError(404, 'Không tìm thấy đơn hàng');
  if (order.checkoutState === 'pending') throw httpError(409, 'Đơn hàng đang được tạo. Vui lòng chờ hoàn tất');
  if (order.cancellationLock) throw httpError(409, 'Đơn hàng đang được xử lý hủy');
};
const sameFailure = (order, reason, notes) => order.deliveryFailure?.reason === reason
  && (order.deliveryFailure?.notes || '') === notes;
const sameReturn = (order, requestHash) => order.deliveryReturn?.requestHash === requestHash
  && Boolean(order.deliveryReturn?.token)
  && ((order.orderStatus === FAILED && order.deliveryReturn.state === 'processing')
    || (order.orderStatus === RETURNED && order.deliveryReturn.state === 'completed'));

export const recordDeliveryFailure = async (req, res) => {
  try {
    requireRequest(req);
    const reason = cleanText(req.body?.reason, 'Lý do giao thất bại', { max: 300 });
    const notes = cleanText(req.body?.notes, 'Ghi chú giao thất bại', { required: false, max: 1000 });
    const order = await Order.findById(req.params.id);
    requireCommitted(order);
    if ([FAILED, RETURNED].includes(order.orderStatus) && sameFailure(order, reason, notes)) {
      return res.json(publicOrder(order));
    }
    if ([FAILED, RETURNED].includes(order.orderStatus)) throw httpError(409, 'Lý do giao thất bại đã được ghi nhận khác. Vui lòng tải lại');
    if (order.orderStatus !== 'Đang giao' || order.isDelivered || order.deliveryReturn) {
      throw httpError(400, 'Chỉ ghi nhận giao thất bại cho đơn đang giao chưa được giao thành công');
    }
    const amounts = calculateDeliveryReturnAmounts(order);
    const update = { $set: {
      orderStatus: FAILED,
      deliveryFailure: { reason, notes, failedAt: new Date(), failedBy: req.user._id },
      refundStatus: amounts.refundAmount > 0 ? 'pending' : 'not_required',
    }, $inc: { __v: 1 } };
    let updated;
    try {
      updated = await Order.findOneAndUpdate({
        ...COMMITTED, _id: order._id, orderStatus: 'Đang giao', isPaid: order.isPaid,
        isDelivered: false, cancellationLock: null,
        ...(Number.isSafeInteger(order.__v) ? { __v: order.__v } : {}),
      }, update, { new: true, runValidators: true });
    } catch {
      // An acknowledged read after a lost write response can prove the outcome.
      let persisted;
      try { persisted = await Order.findById(order._id); } catch { throw recoveryError(); }
      if (persisted && [FAILED, RETURNED].includes(persisted.orderStatus) && sameFailure(persisted, reason, notes)) updated = persisted;
      else throw recoveryError();
    }
    if (!updated) throw httpError(409, 'Trạng thái hoặc thanh toán đơn hàng đã thay đổi. Vui lòng tải lại');
    return res.json(publicOrder(updated));
  } catch (error) { return fail(res, error); }
};

const restoreStockOnce = async (item) => {
  const filter = {
    _id: item.product, deliveryReturnReceipts: { $ne: item.receipt },
    countInStock: { $lte: Number.MAX_SAFE_INTEGER - item.quantity },
  };
  const increments = { countInStock: item.quantity, __v: 1 };
  if (item.inventoryVariant) {
    filter.variants = { $elemMatch: {
      color: item.color, size: item.size, quantity: { $lte: Number.MAX_SAFE_INTEGER - item.quantity },
    } };
    increments['variants.$.quantity'] = item.quantity;
  } else {
    filter.$or = [{ variants: { $exists: false } }, { variants: { $size: 0 } }];
  }
  try {
    const result = await Product.updateOne(filter, {
      $inc: increments, $addToSet: { deliveryReturnReceipts: item.receipt },
    });
    if (result.matchedCount === 1) return;
  } catch { /* Read the receipt before deciding whether a write failed. */ }
  const persisted = await Product.findById(item.product);
  if (!persisted?.deliveryReturnReceipts?.includes(item.receipt)) throw recoveryError();
};

const releaseVoucherOnce = async (order) => {
  if (!order.voucher?._id || order.voucherReleased) return;
  const token = order.deliveryReturn.token;
  try {
    const result = await Voucher.updateOne({
      _id: order.voucher._id, usedCount: { $gt: 0 }, deliveryReturnReceipts: { $ne: token },
    }, {
      $inc: { usedCount: -1, __v: 1 },
      $addToSet: { deliveryReturnReceipts: token, deliveryReturnHolds: token },
      ...(order.voucher.reservationToken ? { $pull: { reservations: { token: order.voucher.reservationToken } } } : {}),
    });
    if (result.matchedCount === 1) return;
  } catch { /* A driver error may follow a successful atomic write. */ }
  const persisted = await Voucher.findById(order.voucher._id);
  if (!persisted?.deliveryReturnReceipts?.includes(token)) throw recoveryError();
};

const finishVoucherHold = async (order) => {
  if (!order.voucher?._id) return order;
  let recoveryRequired = false;
  try {
    // Completion is durable. A missing voucher/hold here is already cleaned up.
    await Voucher.updateOne({ _id: order.voucher._id, deliveryReturnHolds: order.deliveryReturn.token }, {
      $pull: { deliveryReturnHolds: order.deliveryReturn.token }, $inc: { __v: 1 },
    });
  } catch {
    try {
      const persisted = await Voucher.findById(order.voucher._id);
      recoveryRequired = Boolean(persisted?.deliveryReturnHolds?.includes(order.deliveryReturn.token));
    } catch { recoveryRequired = true; }
  }
  if (recoveryRequired || order.deliveryReturn.recoveryRequired) {
    try {
      await Order.updateOne({
        _id: order._id, orderStatus: RETURNED, 'deliveryReturn.token': order.deliveryReturn.token,
        'deliveryReturn.state': 'completed',
      }, { $set: { 'deliveryReturn.recoveryRequired': recoveryRequired }, $inc: { __v: 1 } });
    } catch { recoveryRequired = true; }
    order.deliveryReturn.recoveryRequired = recoveryRequired;
  }
  return order;
};

export const completeDeliveryReturn = async (req, res) => {
  let order;
  let operation;
  try {
    requireRequest(req);
    order = await Order.findById(req.params.id);
    requireCommitted(order);
    const request = normalizeDeliveryReturnRequest(req.body, order);
    if (order.deliveryReturn) {
      if (!sameReturn(order, request.requestHash)) throw httpError(409, 'Kết quả kiểm tra hàng đã được ghi nhận khác. Vui lòng tải lại; chỉ được tiếp tục cùng kết quả đã lưu');
      operation = order.deliveryReturn;
      if (operation.state === 'completed') return res.json(publicOrder(await finishVoucherHold(order)));
    } else {
      if (order.orderStatus !== FAILED || order.isDelivered) throw httpError(400, 'Chỉ nhận hàng hoàn sau khi đã ghi nhận giao thất bại');
      const claimedOperation = {
        ...request, ...calculateDeliveryReturnAmounts(order), state: 'processing', token: randomUUID(),
        receivedAt: new Date(), receivedBy: req.user._id, recoveryRequired: false,
      };
      let claimed;
      let claimError = false;
      try {
        claimed = await Order.findOneAndUpdate({
          ...COMMITTED, _id: order._id, orderStatus: FAILED, isPaid: order.isPaid,
          isDelivered: false, cancellationLock: null,
          $or: [{ deliveryReturn: { $exists: false } }, { deliveryReturn: null }],
          ...(Number.isSafeInteger(order.__v) ? { __v: order.__v } : {}),
        }, { $set: { deliveryReturn: claimedOperation }, $inc: { __v: 1 } }, { new: true, runValidators: true });
      } catch { claimError = true; }
      if (!claimed) {
        let persisted;
        try { persisted = await Order.findById(order._id); } catch { throw recoveryError(); }
        if (sameReturn(persisted || {}, request.requestHash)) claimed = persisted;
        else if (claimError) throw recoveryError();
        else throw httpError(409, 'Trạng thái đơn hoặc kết quả kiểm tra đã thay đổi. Vui lòng tải lại');
      }
      order = claimed;
      operation = order.deliveryReturn;
      if (operation.state === 'completed') return res.json(publicOrder(await finishVoucherHold(order)));
    }

    for (const item of aggregateRestockItems(order)) await restoreStockOnce(item);
    await releaseVoucherOnce(order);
    let completed;
    try {
      completed = await Order.findOneAndUpdate({
        ...COMMITTED, _id: order._id, orderStatus: FAILED, cancellationLock: null,
        isPaid: order.isPaid, isDelivered: false,
        'deliveryReturn.state': 'processing', 'deliveryReturn.token': operation.token,
        'deliveryReturn.requestHash': operation.requestHash,
      }, { $set: {
        orderStatus: RETURNED, 'deliveryReturn.state': 'completed',
        'deliveryReturn.completedAt': new Date(), 'deliveryReturn.recoveryRequired': false,
        refundStatus: operation.refundAmount > 0 ? 'pending' : 'not_required', voucherReleased: true,
      }, $inc: { __v: 1 } }, { new: true, runValidators: true });
    } catch { /* A read below proves whether the durable completion succeeded. */ }
    if (!completed) {
      const persisted = await Order.findById(order._id);
      if (persisted?.orderStatus === RETURNED && persisted.deliveryReturn?.state === 'completed'
          && persisted.deliveryReturn.token === operation.token && persisted.deliveryReturn.requestHash === operation.requestHash) completed = persisted;
      else throw recoveryError();
    }
    return res.json(publicOrder(await finishVoucherHold(completed)));
  } catch (error) {
    if (operation?.token && operation.state === 'processing') {
      try {
        const persisted = await Order.findById(order._id);
        if (persisted?.orderStatus === RETURNED && persisted.deliveryReturn?.state === 'completed'
            && persisted.deliveryReturn.token === operation.token
            && persisted.deliveryReturn.requestHash === operation.requestHash) {
          return res.json(publicOrder(await finishVoucherHold(persisted)));
        }
      } catch { /* An unknown outcome remains protected for a later retry. */ }
      try {
        await Order.updateOne({
          _id: order._id, orderStatus: FAILED, 'deliveryReturn.token': operation.token,
          'deliveryReturn.state': 'processing',
        }, { $set: { 'deliveryReturn.recoveryRequired': true }, $inc: { __v: 1 } });
      } catch { /* Retain the frozen claim even if recording recovery fails. */ }
      return fail(res, recoveryError());
    }
    return fail(res, error);
  }
};

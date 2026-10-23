import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import { orderError } from '../utils/orderPricing.js';
import { getVnpayConfig, createVnpayPaymentUrl, verifyVnpayParameters } from '../utils/vnpay.js';
import { createQueryDrRequest, queryVnpayTransaction } from '../utils/vnpayQuery.js';
import { publicCustomerOrder } from '../utils/orderPresentation.js';

const committed = { checkoutState: { $ne: 'pending' } };
const payableStatuses = ['Đang xử lý', 'Đã xác nhận'];
const versionOf = order => Number.isSafeInteger(order.__v) ? order.__v : { $exists: false };
const databaseReady = () => mongoose.connection.readyState === 1;
const attemptOf = (order, reference) => order?.vnpayPayments?.find(attempt => attempt.txnRef === reference);
const orderIdOf = reference => /^[a-f0-9]{40}$/.test(reference || '') ? reference.slice(0, 24) : null;
const validAmount = (order, attempt, parameters) => Number.isSafeInteger(order.totalPrice)
  && attempt.amount === order.totalPrice && attempt.amount * 100 === Number(parameters.vnp_Amount);
const succeeded = parameters => parameters.vnp_ResponseCode === '00' && parameters.vnp_TransactionStatus === '00';
const ipnResult = (res, RspCode, Message) => res.json({ RspCode, Message });

export const createVnpayPayment = async (req, res) => {
  try {
    const config = getVnpayConfig();
    if (!databaseReady()) throw orderError(503, 'Chưa kết nối được cơ sở dữ liệu');
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw orderError(400, 'Mã đơn hàng không hợp lệ');
    const order = await Order.findById(req.params.id);
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    if (req.accountType === 'staff' || String(order.user?._id || order.user) !== String(req.user?._id)) {
      throw orderError(403, 'Không có quyền thanh toán đơn hàng này');
    }
    if (order.checkoutState === 'pending' || order.paymentMethod !== 'VNPAY' || order.isPaid
      || !payableStatuses.includes(order.orderStatus) || order.cancellationLock || order.deliveryReturn) {
      throw orderError(409, 'Đơn hàng hiện không thể thanh toán qua VNPAY');
    }
    if (!Number.isSafeInteger(order.totalPrice) || order.totalPrice < 5000 || order.totalPrice > 9999999999) {
      throw orderError(400, 'Thanh toán VNPAY yêu cầu số tiền từ 5.000đ và nằm trong giới hạn cho phép');
    }
    const now = new Date();
    let attempt = order.vnpayPayments?.find(payment => payment.state === 'pending' && new Date(payment.expiresAt) > now);
    if (attempt && (attempt.amount !== order.totalPrice || attempt.tmnCode !== config.tmnCode)) {
      throw orderError(409, 'Thông tin thanh toán đã thay đổi. Vui lòng liên hệ cửa hàng để đối soát');
    }
    if (!attempt) {
      if ((order.vnpayPayments?.length || 0) >= 20) throw orderError(409, 'Đơn hàng đã đạt giới hạn số lần thanh toán. Vui lòng liên hệ cửa hàng');
      attempt = {
        txnRef: String(order._id) + randomBytes(8).toString('hex'), tmnCode: config.tmnCode,
        amount: order.totalPrice, createdAt: now,
        expiresAt: new Date(now.getTime() + config.timeoutMinutes * 60000), state: 'pending',
      };
      // Validate URL inputs before publishing an attempt. The amount always
      // comes from the saved order, never from the browser request body.
      createVnpayPaymentUrl({ config, amount: attempt.amount, txnRef: attempt.txnRef,
        ipAddress: req.ip, now: attempt.createdAt, expiresAt: attempt.expiresAt });
      const updated = await Order.findOneAndUpdate({
        ...committed, _id: order._id, __v: versionOf(order), paymentMethod: 'VNPAY',
        isPaid: false, totalPrice: order.totalPrice, orderStatus: order.orderStatus,
        cancellationLock: null, 'deliveryReturn.state': { $exists: false },
      }, { $push: { vnpayPayments: attempt }, $inc: { __v: 1 } }, { new: true, runValidators: true });
      if (!updated) throw orderError(409, 'Đơn hàng vừa thay đổi. Vui lòng tải lại trước khi thanh toán');
    }
    const paymentUrl = createVnpayPaymentUrl({ config, amount: attempt.amount, txnRef: attempt.txnRef,
      ipAddress: req.ip, now: new Date(attempt.createdAt), expiresAt: new Date(attempt.expiresAt) });
    res.set?.('Cache-Control', 'no-store');
    return res.json({ paymentUrl, expiresAt: attempt.expiresAt });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Không thể tạo liên kết thanh toán VNPAY. Vui lòng thử lại' });
  }
};

// Both callers must verify their own gateway signature before reaching this
// private function. Read again after network I/O and retain the same atomic
// receipt/cancellation/refund rules for IPN and QueryDR.
const recordVerifiedReceipt = async (parameters, source) => {
    const outcome = (code, message) => ({ code, message });
    if (!databaseReady()) return outcome('99', 'Database unavailable');
    const orderId = orderIdOf(parameters.vnp_TxnRef);
    if (!orderId) return outcome('01', 'Order not found');
    const order = await Order.findById(orderId);
    const attempt = attemptOf(order, parameters.vnp_TxnRef);
    if (!order || !attempt || order.paymentMethod !== 'VNPAY' || attempt.tmnCode !== parameters.vnp_TmnCode) {
      return outcome('01', 'Order not found');
    }
    if (!validAmount(order, attempt, parameters)) return outcome('04', 'Invalid amount');
    if (order.checkoutState === 'pending' || order.cancellationLock || order.deliveryReturn?.state === 'processing') {
      return outcome('99', 'Order operation in progress');
    }
    if (attempt.state === 'succeeded') {
      if (succeeded(parameters) && attempt.transactionNo !== parameters.vnp_TransactionNo) {
        return outcome('99', 'Transaction requires reconciliation');
      }
      return outcome('02', 'Order already updated');
    }
    if (!succeeded(parameters) && attempt.state === 'failed'
      && attempt.responseCode === parameters.vnp_ResponseCode && attempt.transactionStatus === parameters.vnp_TransactionStatus) {
      return outcome('02', 'Order already updated');
    }
    const successful = succeeded(parameters);
    const overpayment = successful && order.isPaid;
    const fields = {
      'vnpayPayments.$.state': successful ? 'succeeded' : 'failed',
      'vnpayPayments.$.transactionNo': parameters.vnp_TransactionNo,
      'vnpayPayments.$.responseCode': parameters.vnp_ResponseCode,
      'vnpayPayments.$.transactionStatus': parameters.vnp_TransactionStatus,
      'vnpayPayments.$.verificationSource': source,
      ...(parameters.vnp_BankCode ? { 'vnpayPayments.$.bankCode': parameters.vnp_BankCode } : {}),
      ...(parameters.vnp_PayDate ? { 'vnpayPayments.$.payDate': parameters.vnp_PayDate } : {}),
    };
    if (successful) {
      fields.isPaid = true;
      fields.paidAt = order.paidAt || new Date();
      if (overpayment) {
        fields['vnpayPayments.$.overpayment'] = true;
        fields.paymentReviewRequired = true;
        if (['Đã hủy', 'Đã xử lý hoàn hàng'].includes(order.orderStatus)) {
          fields.refundStatus = 'pending';
          fields.refundedAt = null;
        }
      } else if (order.orderStatus === 'Đã hủy') {
        // The inventory cancellation stays final; money arriving late is owed
        // back to the customer, and must not reopen or reserve the order.
        fields.refundStatus = 'pending';
      } else if (order.orderStatus === 'Đã xử lý hoàn hàng' && order.deliveryReturn?.state === 'completed') {
        const shipping = Math.max(0, Number(order.shippingPrice || 0));
        const refund = Math.max(0, order.totalPrice - shipping);
        fields['deliveryReturn.refundAmount'] = refund;
        fields['deliveryReturn.retainedShippingFee'] = shipping;
        fields.refundStatus = refund > 0 ? 'pending' : 'not_required';
      }
    }
    const updated = await Order.findOneAndUpdate({
      ...committed, _id: order._id, __v: versionOf(order), paymentMethod: 'VNPAY',
      orderStatus: order.orderStatus, isPaid: order.isPaid, totalPrice: attempt.amount,
      cancellationLock: null, 'vnpayPayments.txnRef': attempt.txnRef,
      'deliveryReturn.state': { $ne: 'processing' },
    }, { $set: fields, $inc: { __v: 1 } }, { new: true, runValidators: true });
    if (!updated) return outcome('99', 'Order changed, retry notification');
    return outcome('00', 'Confirm Success');
};

export const vnpayIpn = async (req, res) => {
  try {
    const config = getVnpayConfig(process.env, { requireEnabled: false });
    const parameters = verifyVnpayParameters(req.query, config);
    if (!parameters) return ipnResult(res, '97', 'Invalid Signature');
    const result = await recordVerifiedReceipt(parameters, 'ipn');
    return ipnResult(res, result.code, result.message);
  } catch {
    // Preserve VNPAY's retry contract even if MongoDB is temporarily offline.
    return ipnResult(res, '99', 'Unable to record transaction');
  }
};

export const createReconcileVnpayPayment = ({ query = queryVnpayTransaction } = {}) => async (req, res) => {
  res.set?.('Cache-Control', 'no-store');
  let nextQueryAt;
  try {
    if (!databaseReady()) throw orderError(503, 'Chưa kết nối được cơ sở dữ liệu');
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw orderError(400, 'Mã đơn hàng không hợp lệ');
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'txnRef')
      || body.txnRef !== undefined && (typeof body.txnRef !== 'string' || !/^[a-f0-9]{40}$/.test(body.txnRef))) {
      throw orderError(400, 'Thông tin đối chiếu giao dịch không hợp lệ');
    }
    let order = await Order.findById(req.params.id);
    if (!order) throw orderError(404, 'Không tìm thấy đơn hàng');
    const ownsOrder = req.accountType !== 'staff' && String(order.user?._id || order.user) === String(req.user?._id);
    if (!req.user?.isAdmin && !ownsOrder) throw orderError(403, 'Không có quyền đối chiếu đơn hàng này');
    if (order.paymentMethod !== 'VNPAY' || order.checkoutState === 'pending'
      || order.cancellationLock || order.deliveryReturn?.state === 'processing') {
      throw orderError(409, 'Đơn hàng hiện chưa thể đối chiếu với VNPAY');
    }
    const answer = (message, saved = order) => res.json({
      order: publicCustomerOrder(saved), message,
      ...(nextQueryAt ? { nextQueryAt } : {}),
    });
    if (order.isPaid && !body.txnRef) return answer('Đơn hàng đã được xác nhận thanh toán VNPAY.');
    const candidates = (order.vnpayPayments || []).filter(attempt => attempt.state !== 'succeeded');
    const attempt = body.txnRef ? attemptOf(order, body.txnRef) : candidates.length === 1 ? candidates[0] : null;
    if (!attempt) throw orderError(409, candidates.length > 1
      ? 'Có nhiều yêu cầu thanh toán. Vui lòng nhờ quản trị chọn đúng mã giao dịch để đối chiếu.'
      : 'Đơn chưa có yêu cầu thanh toán VNPAY để đối chiếu.');
    if (attempt.state === 'succeeded') return answer('Giao dịch đã được hệ thống ghi nhận.');
    const config = getVnpayConfig(process.env, { requireEnabled: false });
    if (attempt.tmnCode !== config.tmnCode || attempt.amount !== order.totalPrice) {
      throw orderError(409, 'Thông tin thanh toán đã thay đổi. Vui lòng liên hệ cửa hàng để đối soát.');
    }
    const request = createQueryDrRequest({ config, txnRef: attempt.txnRef,
      transactionDate: new Date(attempt.createdAt), ipAddress: req.ip });
    const now = new Date();
    if (order.vnpayQueryNextAt && new Date(order.vnpayQueryNextAt) > now) {
      nextQueryAt = order.vnpayQueryNextAt;
      throw orderError(429, 'Đơn vừa được đối chiếu. Vui lòng chờ đủ 5 phút trước khi thử lại.');
    }
    nextQueryAt = new Date(now.getTime() + 5 * 60000);
    // Reserve the cooldown in MongoDB before sending. A crash, timeout or a
    // second server process must not trigger another gateway query immediately.
    const claimed = await Order.findOneAndUpdate({
      ...committed, _id: order._id, __v: versionOf(order), paymentMethod: 'VNPAY',
      cancellationLock: null, 'deliveryReturn.state': { $ne: 'processing' },
      $or: [{ vnpayQueryNextAt: null }, { vnpayQueryNextAt: { $lte: now } }],
    }, { $set: { vnpayQueryNextAt: nextQueryAt }, $inc: { __v: 1 } }, { new: true, runValidators: true });
    if (!claimed) throw orderError(409, 'Đơn hàng vừa thay đổi hoặc đang được đối chiếu. Vui lòng tải lại.');
    const result = await query({ config, request, amount: attempt.amount });
    if (!result?.verified) throw orderError(502, 'Chưa nhận được kết quả xác thực từ VNPAY. Trạng thái thanh toán được giữ nguyên; vui lòng thử lại sau 5 phút.');
    // Only a successful payment query can publish a receipt. Pending, refund,
    // reversal and API-error responses must never overwrite an earlier receipt.
    if (result.paid) {
      if (result.responseCode !== '00' || result.transactionStatus !== '00' || result.transactionType !== '01'
        || typeof result.transactionNo !== 'string' || !/^[1-9]\d{0,14}$/.test(result.transactionNo)) {
        throw orderError(502, 'Kết quả VNPAY chưa đủ điều kiện xác nhận thanh toán. Vui lòng liên hệ cửa hàng để đối soát.');
      }
      const parameters = {
        vnp_TmnCode: config.tmnCode, vnp_TxnRef: attempt.txnRef, vnp_Amount: String(attempt.amount * 100),
        vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: result.transactionNo,
        ...(result.bankCode ? { vnp_BankCode: result.bankCode } : {}),
        ...(result.payDate ? { vnp_PayDate: result.payDate } : {}),
      };
      const recorded = await recordVerifiedReceipt(parameters, 'querydr');
      if (!['00', '02'].includes(recorded.code)) {
        throw orderError(409, 'Đã xác minh giao dịch nhưng đơn vừa thay đổi. Vui lòng tải lại hoặc liên hệ cửa hàng để đối soát.');
      }
    }
    order = await Order.findById(req.params.id);
    if (!order) throw orderError(409, 'Đơn hàng vừa thay đổi. Vui lòng tải lại.');
    const verifiedAttempt = attemptOf(order, attempt.txnRef);
    if (result.paid && (!order.isPaid || verifiedAttempt?.state !== 'succeeded'
      || verifiedAttempt.transactionNo !== result.transactionNo)) {
      throw orderError(409, 'Chưa ghi nhận được giao dịch vào đơn hàng. Vui lòng liên hệ cửa hàng để đối soát.');
    }
    return answer(order.isPaid
      ? order.orderStatus === 'Đã hủy' ? 'Đã ghi nhận thanh toán cho đơn đã hủy; cửa hàng sẽ xử lý hoàn tiền.'
        : 'Đã đối chiếu và xác nhận thanh toán VNPAY thành công.'
      : 'VNPAY chưa xác nhận giao dịch thanh toán thành công. Đơn hàng được giữ nguyên trạng thái.');
  } catch (error) {
    return res.status(error.status || 502).json({
      message: error.status ? error.message : 'Chưa kết nối được VNPAY để đối chiếu. Vui lòng thử lại sau 5 phút.',
      ...(nextQueryAt ? { nextQueryAt } : {}),
    });
  }
};

export const reconcileVnpayPayment = createReconcileVnpayPayment();

export const vnpayReturn = async (req, res) => {
  res.set?.('Cache-Control', 'no-store');
  try {
    const config = getVnpayConfig(process.env, { requireEnabled: false });
    const parameters = verifyVnpayParameters(req.query, config);
    const invalid = () => res.status(400).json({ status: 'invalid', message: 'Kết quả thanh toán không hợp lệ hoặc chưa được xác thực' });
    if (!parameters) return invalid();
    if (!databaseReady()) throw orderError(503, 'Chưa thể đối chiếu thanh toán do mất kết nối cơ sở dữ liệu. Vui lòng kiểm tra lại sau');
    const orderId = orderIdOf(parameters.vnp_TxnRef);
    if (!orderId) return invalid();
    const order = await Order.findById(orderId);
    const attempt = attemptOf(order, parameters.vnp_TxnRef);
    if (!order || !attempt || order.paymentMethod !== 'VNPAY' || order.checkoutState === 'pending'
      || attempt.tmnCode !== parameters.vnp_TmnCode || !validAmount(order, attempt, parameters)) return invalid();
    const result = { orderId: String(order._id), responseCode: parameters.vnp_ResponseCode };
    if (attempt.state === 'succeeded' && order.isPaid) {
      return res.json({ ...result, status: 'paid', message: order.orderStatus === 'Đã hủy'
        ? 'Đã ghi nhận thanh toán cho đơn đã hủy. Cửa hàng sẽ đối soát và xử lý hoàn tiền'
        : 'Hệ thống đã nhận thông báo và xác nhận thanh toán VNPAY Sandbox thành công' });
    }
    if (!succeeded(parameters)) {
      return res.json({ ...result, status: 'failed', message: 'Giao dịch VNPAY chưa thành công hoặc đã bị hủy. Bạn có thể thanh toán lại trong Đơn hàng' });
    }
    return res.json({ ...result, status: 'pending', message: 'VNPAY đã trả kết quả thành công; hệ thống đang chờ thông báo IPN để xác nhận. Vui lòng kiểm tra lại sau' });
  } catch (error) {
    return res.status(error.status || 503).json({ status: 'pending', message: error.status ? error.message : 'Chưa thể đối chiếu giao dịch VNPAY. Vui lòng kiểm tra lại sau' });
  }
};

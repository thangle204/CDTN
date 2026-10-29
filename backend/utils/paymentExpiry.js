import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import { getVnpayConfig } from './vnpay.js';
import { createQueryDrRequest, queryVnpayTransaction } from './vnpayQuery.js';
import { recordVerifiedReceipt } from '../controllers/vnpayController.js';
import { cancelOrderRecord } from '../controllers/orderController.js';

export const createPaymentExpirySweep = ({
  query = queryVnpayTransaction, configOf = () => getVnpayConfig(process.env, { requireEnabled: false }),
  record = recordVerifiedReceipt, cancel = cancelOrderRecord, clock = () => new Date(),
} = {}) => async () => {
  if (mongoose.connection.readyState !== 1) return;
  const recoveries = await Order.find({ autoCancelledAt: { $exists: true }, stockRestored: false,
    cancellationLock: { $type: 'string', $ne: '' },
  }).limit(5);
  for (const order of recoveries) {
    try { await cancel(order._id, { _id: order.user, isAdmin: true }); } catch { /* Durable receipts allow the next retry. */ }
  }
  const now = clock();
  const orders = await Order.find({ checkoutState: { $ne: 'pending' }, paymentMethod: 'VNPAY', isPaid: false,
    orderStatus: { $in: ['Đang xử lý', 'Đã xác nhận'] }, cancellationLock: null,
    paymentDeadline: { $lte: now },
    $and: [
      { $or: [{ paymentExpiryNextAt: null }, { paymentExpiryNextAt: { $lte: now } }] },
      { $or: [{ vnpayQueryNextAt: null }, { vnpayQueryNextAt: { $lte: now } }] },
    ],
  }).sort({ paymentDeadline: 1 }).limit(5);
  for (const snapshot of orders) {
    const claimNow = clock();
    const next = new Date(claimNow.getTime() + 5 * 60000);
    const order = await Order.findOneAndUpdate({ _id: snapshot._id, __v: snapshot.__v,
      isPaid: false, cancellationLock: null, orderStatus: snapshot.orderStatus,
      $and: [
        { $or: [{ paymentExpiryNextAt: null }, { paymentExpiryNextAt: { $lte: claimNow } }] },
        { $or: [{ vnpayQueryNextAt: null }, { vnpayQueryNextAt: { $lte: claimNow } }] },
      ],
    }, { $set: { paymentExpiryNextAt: next, vnpayQueryNextAt: next }, $inc: { __v: 1 } }, { new: true });
    if (!order) continue;
    let safeToCancel = true;
    try {
      const attempts = order.vnpayPayments || [];
      const config = attempts.length ? configOf() : null;
      for (const attempt of attempts) {
        if (attempt.tmnCode !== config.tmnCode || attempt.amount !== order.totalPrice
          || new Date(attempt.expiresAt) > now || attempt.state === 'succeeded') { safeToCancel = false; break; }
        const request = createQueryDrRequest({ config, txnRef: attempt.txnRef, transactionDate: new Date(attempt.createdAt), ipAddress: '127.0.0.1' });
        const result = await query({ config, request, amount: attempt.amount });
        if (result?.verified && result.paid && result.responseCode === '00' && result.transactionStatus === '00' && result.transactionType === '01'
          && /^[1-9]\d{0,14}$/.test(result.transactionNo || '')) {
          await record({ vnp_TmnCode: config.tmnCode, vnp_TxnRef: attempt.txnRef, vnp_Amount: String(attempt.amount * 100),
            vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: result.transactionNo,
            ...(result.bankCode ? { vnp_BankCode: result.bankCode } : {}), ...(result.payDate ? { vnp_PayDate: result.payDate } : {}),
          }, 'querydr');
          safeToCancel = false; break;
        }
        // Only a signed successful query reporting a failed payment is final.
        // Pending, not-found, reversal/refund, transport and signature errors
        // never prove that the customer has not been debited.
        if (!result?.verified || result.responseCode !== '00' || result.transactionType !== '01' || result.transactionStatus !== '02') {
          safeToCancel = false; break;
        }
      }
      const current = await Order.findById(order._id);
      if (!current || current.isPaid || current.cancellationLock || !['Đang xử lý', 'Đã xác nhận'].includes(current.orderStatus)) continue;
      if (current.__v !== order.__v) { safeToCancel = false; }
      if (safeToCancel) {
        await cancel(current._id, { _id: current.user, isAdmin: true, paymentExpiryVersion: current.__v });
      } else {
        await Order.updateOne({ _id: current._id, isPaid: false, cancellationLock: null }, {
          $set: { paymentExpiryReviewRequired: true }, $inc: { __v: 1 },
        });
      }
    } catch {
      await Order.updateOne({ _id: order._id, isPaid: false, cancellationLock: null }, {
        $set: { paymentExpiryReviewRequired: true }, $inc: { __v: 1 },
      }).catch(() => {});
    }
  }
};

export const startPaymentExpiryWorker = ({ sweep = createPaymentExpirySweep(), intervalMS = 60000 } = {}) => {
  let running = false, stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { await sweep(); } catch { console.error('Chưa hoàn tất đối soát đơn chờ VNPAY; sẽ kiểm tra lại sau'); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMS);timer.unref?.();
  void run();
  return { stop() { stopped = true; clearInterval(timer); } };
};

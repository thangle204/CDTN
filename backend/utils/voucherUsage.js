import Voucher from '../models/voucherModel.js';
import Order from '../models/orderModel.js';
import VoucherWallet from '../models/voucherWalletModel.js';
import { httpError } from './validation.js';
import { validateVoucherEligibility } from './orderPricing.js';

export const voucherVisibility = voucher => voucher.visibility || 'public';
export const voucherEligibility = voucher => voucher.eligibility || 'all';
export const firstOrderEligible = async (user, excludeOrder) => !await Order.exists({
  user, ...(excludeOrder ? { _id: { $ne: excludeOrder } } : {}),
  $or: [
    { orderStatus: { $nin: ['Đã hủy', 'Đã xử lý hoàn hàng'] } },
    { cancellationLock: { $type: 'string', $ne: '' } },
  ],
});

export const customerUsage = async (voucher, user) => {
  const entries = (voucher.reservations || []).filter(entry => String(entry.user) === String(user));
  const legacy = await Order.countDocuments({ user, 'voucher._id': voucher._id,
    'voucher.reservationToken': { $exists: false }, voucherReleased: { $ne: true } });
  return { entries, count: entries.length + legacy };
};

export const checkVoucherCustomer = async (voucher, user, itemsPrice, now = new Date()) => {
  validateVoucherEligibility(voucher, itemsPrice, now);
  const rule = voucherEligibility(voucher);
  if ((rule !== 'all' || voucherVisibility(voucher) === 'private' || voucher.perCustomerLimit) && !user) throw httpError(401, 'Đăng nhập để sử dụng ưu đãi này');
  if (rule === 'first_order' && !await firstOrderEligible(user)) throw httpError(400, 'Ưu đãi dành cho khách chưa có đơn giao thành công và không có đơn khác đang xử lý');
  let wallet;
  if (voucherVisibility(voucher) === 'private') {
    wallet = await VoucherWallet.findOne({ voucher: voucher._id, user, kind: 'granted' });
    if (!wallet) throw httpError(403, 'Mã riêng chưa được cấp cho tài khoản của bạn. Mở Mã của tôi để nhận ưu đãi đủ điều kiện');
    if (!wallet.expiresAt || new Date(wallet.expiresAt) < now) throw httpError(400, 'Mã riêng trong tài khoản đã hết hạn');
  }
  let legacyCount = 0;
  if (voucher.perCustomerLimit) {
    const usage = await customerUsage(voucher, user);
    if (usage.count >= voucher.perCustomerLimit) throw httpError(400, 'Bạn đã dùng hoặc đang giữ hết lượt của mã này');
    legacyCount = usage.count - usage.entries.length;
  }
  return { wallet, legacyCount };
};

export const reserveVoucher = async ({ voucher, user, order, token, itemsPrice, customer }) => {
  const { legacyCount } = customer;
  const filter = {
    _id: voucher._id, code: voucher.code, type: voucher.type, discount: voucher.discount,
    __v: Number.isSafeInteger(voucher.__v) ? voucher.__v : { $exists: false },
    isActive: true, startDate: { $lte: new Date() }, endDate: { $gte: new Date() }, minOrder: { $lte: itemsPrice },
    'reservations.token': { $ne: token },
    $expr: { $and: [
      { $lt: [{ $ifNull: ['$usedCount', 0] }, '$maxUses'] },
      ...(voucher.perCustomerLimit ? [{ $lt: [{ $add: [legacyCount, { $size: { $filter: {
        input: { $ifNull: ['$reservations', []] }, as: 'reservation', cond: { $eq: ['$$reservation.user', user] },
      } } }] }, voucher.perCustomerLimit] }] : []),
    ] },
  };
  try {
    return await Voucher.findOneAndUpdate(filter, {
      $inc: { usedCount: 1, __v: 1 },
      $push: { reservations: { token, user, order, ...(customer.wallet ? { wallet: customer.wallet._id } : {}), createdAt: new Date() } },
    }, { new: true });
  } catch {
    try {
      const persisted = await Voucher.findById(voucher._id);
      if (persisted?.reservations?.some(entry => entry.token === token && String(entry.order) === String(order))) return persisted;
    } catch { /* The uncertain outcome must keep checkout's recovery lock. */ }
    const error = httpError(503, 'Chưa xác định được lượt mã đã giữ. Vui lòng liên hệ cửa hàng để đối soát');
    error.voucherReservationUncertain = true;throw error;
  }
};

export const releaseVoucherUsage = async (order, receipt, { hold = false } = {}) => {
  if (!order.voucher?._id || order.voucherReleased) return { matchedCount: 1 };
  try {
    const result = await Voucher.updateOne({ _id: order.voucher._id, usedCount: { $gt: 0 }, releaseReceipts: { $ne: receipt } }, {
      $inc: { usedCount: -1, __v: 1 },
      $addToSet: { releaseReceipts: receipt, ...(hold ? { releaseHolds: receipt } : {}) },
      ...(order.voucher.reservationToken ? { $pull: { reservations: { token: order.voucher.reservationToken } } } : {}),
    });
    if (result.matchedCount === 1) return result;
  } catch { /* Prove an uncertain acknowledgement from the durable receipt. */ }
  const persisted = await Voucher.findById(order.voucher._id);
  if (!persisted?.releaseReceipts?.includes(receipt)) throw httpError(503, 'Lượt ưu đãi cần đối soát. Vui lòng thử lại để tiếp tục xử lý');
  return { matchedCount: 1 };
};

export const finishVoucherRelease = async (order, receipt) => {
  if (!order.voucher?._id) return;
  await Voucher.updateOne({ _id: order.voucher._id, releaseHolds: receipt }, {
    $pull: { releaseHolds: receipt }, $inc: { __v: 1 },
  });
};

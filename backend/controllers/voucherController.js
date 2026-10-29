import Voucher from '../models/voucherModel.js';
import VoucherWallet, { ensureVoucherWalletIndexes } from '../models/voucherWalletModel.js';
import Order from '../models/orderModel.js';
import { validateVoucherEligibility } from '../utils/orderPricing.js';
import { cleanText, httpError, nonNegativeInteger } from '../utils/validation.js';
import { checkVoucherCustomer, firstOrderEligible, customerUsage, voucherVisibility, voucherEligibility } from '../utils/voucherUsage.js';

const normalizeCode = (code) => cleanText(code, 'Mã voucher', { max: 50 }).toUpperCase();
const assignVoucherFields = (voucher, body, creating = false) => {
  if (body.visibility !== undefined) {
    if (!['public', 'private'].includes(body.visibility)) throw httpError(400, 'Kênh phát mã không hợp lệ');
    voucher.visibility = body.visibility;
  }
  if (body.eligibility !== undefined) {
    if (!['all', 'first_order', 'after_purchase'].includes(body.eligibility)) throw httpError(400, 'Điều kiện nhận mã không hợp lệ');
    voucher.eligibility = body.eligibility;
  }
  for (const [field, label] of [['perCustomerLimit', 'Lượt mỗi khách'], ['maxDiscount', 'Giảm tối đa']]) {
    if (body[field] !== undefined) {
      voucher[field] = body[field] === null || body[field] === '' ? null : nonNegativeInteger(body[field], label);
      if (voucher[field] !== null && voucher[field] < 1) throw httpError(400, `${label} phải lớn hơn 0`);
    }
  }
  if (body.validityDays !== undefined) {
    voucher.validityDays = nonNegativeInteger(body.validityDays, 'Hạn mã riêng');
    if (voucher.validityDays < 1 || voucher.validityDays > 365) throw httpError(400, 'Hạn mã riêng từ 1 đến 365 ngày');
  }
  if (creating || body.code !== undefined) voucher.code = normalizeCode(body.code);
  if (creating || body.description !== undefined) voucher.description = cleanText(body.description, 'Mô tả voucher', { max: 500 });
  if (creating || body.type !== undefined) {
    if (!['fixed', 'percent', 'shipping'].includes(body.type)) throw httpError(400, 'Loại voucher không hợp lệ');
    voucher.type = body.type;
  }
  if (creating || body.discount !== undefined) voucher.discount = nonNegativeInteger(body.discount ?? 0, 'Mức giảm');
  if (voucher.type === 'percent' && voucher.discount > 100) throw httpError(400, 'Mức giảm phần trăm không được vượt quá 100');
  if (creating || body.minOrder !== undefined) voucher.minOrder = nonNegativeInteger(body.minOrder ?? 0, 'Đơn hàng tối thiểu');
  if (creating || body.maxUses !== undefined) {
    const maxUses = nonNegativeInteger(body.maxUses ?? 100, 'Số lượt sử dụng');
    if (maxUses < 1 || maxUses < (voucher.usedCount ?? 0)) throw httpError(400, 'Số lượt tối đa phải lớn hơn 0 và không thấp hơn lượt đã sử dụng');
    voucher.maxUses = maxUses;
  }
  if (creating || body.startDate !== undefined) {
    const startDate = new Date(body.startDate ?? Date.now());
    if (Number.isNaN(startDate.getTime())) throw httpError(400, 'Ngày bắt đầu không hợp lệ');
    voucher.startDate = startDate;
  }
  if (creating || body.endDate !== undefined) {
    if (!body.endDate) throw httpError(400, 'Vui lòng nhập ngày hết hạn');
    const endDate = new Date(body.endDate);
    if (Number.isNaN(endDate.getTime())) throw httpError(400, 'Ngày hết hạn không hợp lệ');
    voucher.endDate = endDate;
  }
  if (voucher.endDate <= voucher.startDate) throw httpError(400, 'Ngày hết hạn phải sau ngày bắt đầu');
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw httpError(400, 'Trạng thái voucher không hợp lệ');
    voucher.isActive = body.isActive;
  }
  if (voucher.type !== 'percent') voucher.maxDiscount = null;
  if (voucherVisibility(voucher) === 'private' && voucherEligibility(voucher) === 'all') throw httpError(400, 'Mã riêng cần điều kiện lần mua đầu hoặc sau mua');
  if (voucherEligibility(voucher) === 'after_purchase' && voucherVisibility(voucher) !== 'private') throw httpError(400, 'Ưu đãi sau mua phải là mã riêng');
  if (voucherEligibility(voucher) === 'first_order') voucher.perCustomerLimit = 1;
  if (voucherVisibility(voucher) === 'private' && !voucher.perCustomerLimit) voucher.perCustomerLimit = 1;
  return voucher;
};

const checkVersion = (voucher, body) => {
  if (!Number.isSafeInteger(body.version) || body.version < 0) throw httpError(400, 'Vui lòng tải lại mã trước khi chỉnh sửa');
  if (body.version !== (voucher.__v ?? 0)) throw httpError(409, 'Chương trình vừa thay đổi. Vui lòng đóng form, tải lại và kiểm tra trước khi sửa');
};
export const publicVoucher = voucher => Object.fromEntries(['_id', 'code', 'description', 'type', 'discount', 'minOrder', 'maxUses', 'usedCount', 'startDate', 'endDate', 'isActive', 'visibility', 'eligibility', 'perCustomerLimit', 'maxDiscount', 'validityDays'].map(key => [key, voucher[key]]));

export const getActiveVouchers = async (req, res) => {
  const now = new Date();
  const vouchers = await Voucher.find({
    isActive: true,
    visibility: { $ne: 'private' },
    startDate: { $lte: now },
    endDate: { $gte: now },
    $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$maxUses'] },
  }).sort({ createdAt: -1 });
  res.json(vouchers.map(publicVoucher));
};

export const applyVoucher = async (req, res) => {
  const code = normalizeCode(req.body.code);
  const itemsPrice = nonNegativeInteger(req.body.orderTotal, 'Tổng tiền sản phẩm');
  if (itemsPrice <= 0) throw httpError(400, 'Giỏ hàng phải có sản phẩm để áp dụng voucher');
  const voucher = await Voucher.findOne({ code });
  await checkVoucherCustomer(voucher, req.user?._id, itemsPrice);
  const pricing = validateVoucherEligibility(voucher, itemsPrice);
  res.json({ voucher: publicVoucher(voucher), ...pricing, message: 'Đã áp dụng voucher cho phần xem trước. Cửa hàng sẽ kiểm tra lại khi tạo đơn' });
};

// Voucher usage is reserved by createOrder, never by a separate browser request.
export const useVoucher = async () => {
  throw httpError(409, 'Lượt voucher chỉ được cập nhật khi tạo hoặc hủy đơn hàng');
};

export const createVoucher = async (req, res) => {
  const voucher = assignVoucherFields(new Voucher(), req.body, true);
  if (await Voucher.exists({ code: voucher.code })) throw httpError(409, 'Mã voucher đã tồn tại');
  await voucher.save();
  res.status(201).json(voucher);
};

export const updateVoucher = async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw httpError(404, 'Không tìm thấy voucher');
  checkVersion(voucher, req.body);
  if (voucher.usedCount > 0 || voucher.walletCount > 0) {
    const locked = ['visibility', 'eligibility', 'type', 'discount', 'minOrder', 'perCustomerLimit', 'maxDiscount', 'validityDays'];
    if (locked.some(key => req.body[key] !== undefined && String(req.body[key] ?? '') !== String(voucher[key] ?? ''))) {
      throw httpError(409, 'Mã đã được lưu/cấp hoặc dùng. Hãy tạo chương trình mới để đổi quyền lợi và điều kiện');
    }
  }
  if (req.body.code !== undefined && normalizeCode(req.body.code) !== voucher.code) throw httpError(400, 'Không đổi mã đã phát hành. Hãy tạo chương trình mới');
  assignVoucherFields(voucher, req.body);
  if (await Voucher.exists({ code: voucher.code, _id: { $ne: voucher._id } })) throw httpError(409, 'Mã voucher đã tồn tại');
  await voucher.save();
  res.json(voucher);
};

export const toggleVoucherVisibility = async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw httpError(404, 'Không tìm thấy voucher');
  checkVersion(voucher, req.body);
  voucher.isActive = !voucher.isActive;
  await voucher.save();
  res.json({ success: true, voucher, message: voucher.isActive ? 'Đã kích hoạt voucher' : 'Đã ẩn voucher' });
};

export const deleteVoucher = async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw httpError(404, 'Không tìm thấy voucher');
  if (voucher.usedCount > 0) throw httpError(409, 'Voucher đã được dùng trong đơn hàng. Hãy ẩn thay vì xóa');
  if (voucher.deliveryReturnHolds?.length) throw httpError(409, 'Voucher đang được xử lý hoàn hàng. Vui lòng chờ hoàn tất thay vì xóa');
  if (voucher.releaseHolds?.length) throw httpError(409, 'Mã đang hoàn tất hủy đơn. Vui lòng chờ xử lý xong');
  if (voucher.walletCount > 0) throw httpError(409, 'Mã đã được lưu hoặc cấp cho khách. Hãy ngừng chương trình thay vì xóa');
  // A return can release the final usage after this read, before its Order is
  // committed. Keep the hold check in the atomic delete as well as the read.
  const result = await Voucher.deleteOne({
    _id: voucher._id,
    __v: voucher.__v,
    $or: [{ usedCount: { $lte: 0 } }, { usedCount: { $exists: false } }],
    'deliveryReturnHolds.0': { $exists: false },
    'releaseHolds.0': { $exists: false },
    $and: [{ $or: [{ walletCount: 0 }, { walletCount: { $exists: false } }] }],
  });
  if (!result.deletedCount) throw httpError(409, 'Voucher vừa được sử dụng hoặc thay đổi. Vui lòng tải lại');
  res.json({ message: 'Đã xóa voucher' });
};

export const getAllVouchersAdmin = async (req, res) => res.json(await Voucher.find({}).sort({ createdAt: -1 }));

const addWalletEntry = async (voucher, user, entry) => {
  await ensureVoucherWalletIndexes();
  if (await VoucherWallet.exists({ voucher: voucher._id, user })) return;
  // Serialize issuance with editing/deletion on the voucher itself. A failed
  // wallet insert conservatively keeps the deletion guard, without holding uses.
  const marked = await Voucher.updateOne({ _id: voucher._id, __v: Number.isSafeInteger(voucher.__v) ? voucher.__v : { $exists: false }, isActive: true }, {
    $inc: { walletCount: 1, __v: 1 },
  });
  if (!marked.matchedCount) throw httpError(409, 'Ưu đãi vừa thay đổi. Vui lòng kiểm tra lại');
  try {
    await VoucherWallet.updateOne({ voucher: voucher._id, user }, { $setOnInsert: entry }, { upsert: true, runValidators: true });
  } catch (error) { if (error.code !== 11000) throw error; }
};

export const grantCustomerVouchers = async (user, now = new Date()) => {
  const campaigns = await Voucher.find({ visibility: 'private', isActive: true, startDate: { $lte: now }, endDate: { $gte: now } });
  for (const voucher of campaigns) {
    let sourceOrder;
    if (voucher.eligibility === 'first_order') {
      if (!await firstOrderEligible(user)) continue;
    } else if (voucher.eligibility === 'after_purchase') {
      sourceOrder = await Order.findOne({ user, checkoutState: { $ne: 'pending' }, orderStatus: 'Đã giao', isDelivered: true, isPaid: true,
        deliveredAt: { $gte: voucher.startDate, $lte: now } }).sort({ deliveredAt: 1 });
      if (!sourceOrder) continue;
    } else continue;
    const expiresAt = new Date(Math.min(new Date(voucher.endDate).getTime(), now.getTime() + (voucher.validityDays || 14) * 86400000));
    await addWalletEntry(voucher, user, {
        kind: 'granted', issuedAt: now, expiresAt, ...(sourceOrder ? { sourceOrder: sourceOrder._id } : {}),
    });
  }
};

const customerCard = async (voucher, user, total, wallet) => {
  const card = { ...publicVoucher(voucher), ...(wallet ? { walletId: wallet._id, issuedAt: wallet.issuedAt, expiresAt: wallet.expiresAt } : {}), eligible: false, state: 'unavailable', reason: '' };
  try {
    await checkVoucherCustomer(voucher, user, total);
    const pricing = validateVoucherEligibility(voucher, total);
    card.eligible = true; card.state = 'available'; card.pricing = pricing;
    card.savings = total + 30000 - pricing.totalPrice;
  } catch (error) { card.reason = error.message; }
  if (voucher.perCustomerLimit || wallet) {
    const usage = await customerUsage(voucher, user);
    card.remainingForCustomer = voucher.perCustomerLimit ? Math.max(0, voucher.perCustomerLimit - usage.count) : null;
    if (card.remainingForCustomer === 0) {
      const active = usage.entries.length ? await Order.findOne({ _id: { $in: usage.entries.map(entry => entry.order) },
        user, orderStatus: { $nin: ['Đã giao', 'Đã hủy', 'Đã xử lý hoàn hàng'] } }) : null;
      card.state = active ? 'held' : 'used'; card.heldByOrder = active?._id;
    }
  }
  if (new Date(voucher.endDate) < new Date() || wallet?.expiresAt && new Date(wallet.expiresAt) < new Date()) card.state = 'expired';
  return card;
};

export const getCustomerVouchers = async (req, res) => {
  const total = req.query.orderTotal === undefined ? null : nonNegativeInteger(Number(req.query.orderTotal), 'Tiền hàng');
  const wallets = await VoucherWallet.find({ user: req.user._id });
  // Both the wallet and checkout show only this customer's saved/granted codes.
  const vouchers = await Voucher.find({ _id: { $in: wallets.map(wallet => wallet.voucher) } });
  const cards = await Promise.all(vouchers.map(voucher => customerCard(voucher, req.user._id, total ?? Math.max(1, voucher.minOrder || 0), wallets.find(wallet => String(wallet.voucher) === String(voucher._id)))));
  if (total === null) for (const card of cards) { delete card.pricing; delete card.savings; }
  cards.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.savings || 0) - (a.savings || 0) || new Date(a.endDate) - new Date(b.endDate));
  res.set('Cache-Control', 'no-store');res.json(cards);
};

export const refreshCustomerVouchers = async (req, res) => {
  await grantCustomerVouchers(req.user._id);
  return getCustomerVouchers(req, res);
};

export const saveVoucher = async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher || voucherVisibility(voucher) !== 'public') throw httpError(404, 'Không tìm thấy mã công khai');
  validateVoucherEligibility(voucher, Math.max(1, voucher.minOrder || 0));
  await addWalletEntry(voucher, req.user._id, { kind: 'saved', issuedAt: new Date() });
  res.json({ message: 'Đã lưu mã. Lưu mã không giữ lượt; điều kiện được kiểm tra khi đặt hàng' });
};

export const unsaveVoucher = async (req, res) => {
  await VoucherWallet.deleteOne({ voucher: req.params.id, user: req.user._id, kind: 'saved' });
  res.json({ message: 'Đã bỏ lưu mã công khai' });
};

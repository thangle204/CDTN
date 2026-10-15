import Voucher from '../models/voucherModel.js';
import { validateVoucherEligibility } from '../utils/orderPricing.js';
import { cleanText, httpError, nonNegativeInteger } from '../utils/validation.js';

const normalizeCode = (code) => cleanText(code, 'Mã voucher', { max: 50 }).toUpperCase();
const assignVoucherFields = (voucher, body, creating = false) => {
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
  return voucher;
};

export const getActiveVouchers = async (req, res) => {
  const now = new Date();
  const vouchers = await Voucher.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
    $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$maxUses'] },
  }).sort({ createdAt: -1 });
  res.json(vouchers);
};

export const applyVoucher = async (req, res) => {
  const code = normalizeCode(req.body.code);
  const itemsPrice = nonNegativeInteger(req.body.orderTotal, 'Tổng tiền sản phẩm');
  if (itemsPrice <= 0) throw httpError(400, 'Giỏ hàng phải có sản phẩm để áp dụng voucher');
  const voucher = await Voucher.findOne({ code });
  const pricing = validateVoucherEligibility(voucher, itemsPrice);
  res.json({ voucher, ...pricing, message: 'Đã áp dụng voucher cho phần xem trước. Cửa hàng sẽ kiểm tra lại khi tạo đơn' });
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
  assignVoucherFields(voucher, req.body);
  if (await Voucher.exists({ code: voucher.code, _id: { $ne: voucher._id } })) throw httpError(409, 'Mã voucher đã tồn tại');
  await voucher.save();
  res.json(voucher);
};

export const toggleVoucherVisibility = async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw httpError(404, 'Không tìm thấy voucher');
  voucher.isActive = !voucher.isActive;
  await voucher.save();
  res.json({ success: true, voucher, message: voucher.isActive ? 'Đã kích hoạt voucher' : 'Đã ẩn voucher' });
};

export const deleteVoucher = async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw httpError(404, 'Không tìm thấy voucher');
  if (voucher.usedCount > 0) throw httpError(409, 'Voucher đã được dùng trong đơn hàng. Hãy ẩn thay vì xóa');
  if (voucher.deliveryReturnHolds?.length) throw httpError(409, 'Voucher đang được xử lý hoàn hàng. Vui lòng chờ hoàn tất thay vì xóa');
  // A return can release the final usage after this read, before its Order is
  // committed. Keep the hold check in the atomic delete as well as the read.
  const result = await Voucher.deleteOne({
    _id: voucher._id,
    __v: voucher.__v,
    $or: [{ usedCount: { $lte: 0 } }, { usedCount: { $exists: false } }],
    'deliveryReturnHolds.0': { $exists: false },
  });
  if (!result.deletedCount) throw httpError(409, 'Voucher vừa được sử dụng hoặc thay đổi. Vui lòng tải lại');
  res.json({ message: 'Đã xóa voucher' });
};

export const getAllVouchersAdmin = async (req, res) => res.json(await Voucher.find({}).sort({ createdAt: -1 }));

import mongoose from 'mongoose';
import { ORDER_STATUSES } from '../utils/orderPricing.js';

const money = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const returnQuantity = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const deliveryFailureSchema = new mongoose.Schema({
  reason: { type: String, required: true, trim: true, maxlength: 300 },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  failedAt: { type: Date, required: true },
  failedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { _id: false });
const deliveryReturnSchema = new mongoose.Schema({
  state: { type: String, required: true, enum: ['processing', 'completed'] },
  token: { type: String, required: true, maxlength: 100 },
  requestHash: { type: String, required: true, maxlength: 100 },
  inspection: {
    type: [new mongoose.Schema({
      itemIndex: returnQuantity,
      restockQuantity: returnQuantity,
      damagedQuantity: returnQuantity,
      missingQuantity: returnQuantity,
    }, { _id: false })],
    required: true,
    validate: { validator: rows => rows.length > 0 && rows.length <= 100, message: 'Cần kiểm tra từng dòng hàng đã gửi' },
  },
  returnShippingCost: money,
  refundAmount: money,
  retainedShippingFee: money,
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  receivedAt: { type: Date, required: true },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  completedAt: Date,
  recoveryRequired: { type: Boolean, default: false },
}, { _id: false });
const bankTransferSchema = new mongoose.Schema({
  bankName: { type: String, trim: true, maxlength: 120 },
  accountNumber: { type: String, trim: true, maxlength: 50 },
  accountHolder: { type: String, trim: true, maxlength: 120 },
  accountName: { type: String, trim: true, maxlength: 120 },
  transferNote: { type: String, trim: true, maxlength: 500 },
  transferContent: { type: String, trim: true, maxlength: 500 },
}, { _id: false });

// Retain attempts for delayed callbacks after a retry. Signing keys never enter
// an order, and the browser return is not a payment receipt.
const vnpayPaymentSchema = new mongoose.Schema({
  txnRef: { type: String, required: true, match: /^[a-f0-9]{40}$/ },
  tmnCode: { type: String, required: true, maxlength: 8 },
  amount: { ...money, min: 5000, max: 9999999999 },
  createdAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  state: { type: String, required: true, enum: ['pending', 'failed', 'succeeded'], default: 'pending' },
  transactionNo: { type: String, maxlength: 30 },
  bankCode: { type: String, maxlength: 20 },
  payDate: { type: String, maxlength: 14 },
  responseCode: { type: String, maxlength: 2 },
  transactionStatus: { type: String, maxlength: 2 },
  verificationSource: { type: String, enum: ['ipn', 'querydr'] },
  overpayment: { type: Boolean, default: false },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  // Existing orders without this field remain committed. Only checkout creates
  // pending orders, which cannot be published or modified until its cart clears.
  checkoutState: { type: String, enum: ['pending', 'committed'], default: 'committed' },
  checkoutToken: {
    type: String, default: null, maxlength: 100,
    validate: { validator: function (value) { return this.checkoutState !== 'pending' || typeof value === 'string' && value.length > 0; }, message: 'Đơn đang tạo phải có mã sở hữu thanh toán' },
  },
  user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Customer', index: true },
  orderItems: {
    type: [{
      name: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
      image: { type: String, required: true },
      price: money,
      originalPrice: { ...money, required: false },
      discountPercent: { type: Number, min: 0, max: 100, validate: Number.isSafeInteger },
      color: { type: String, trim: true, maxlength: 100, default: '' },
      inventoryVariant: { type: Boolean, default: false },
      size: { type: Number, min: 1, max: 60, validate: { validator: (value) => value == null || Number.isInteger(value * 2), message: 'Size giày phải theo bước 0.5' } },
      product: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Product' },
    }],
    validate: { validator: (items) => items.length > 0, message: 'Đơn hàng phải có sản phẩm' },
  },
  shippingAddress: {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    district: { type: String, trim: true, maxlength: 120 },
    ward: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, required: true, match: /^0\d{9}$/ },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  paymentMethod: { type: String, required: true, enum: ['COD', 'BANK', 'VNPAY'], default: 'COD' },
  bankTransferInfo: { type: bankTransferSchema, default: undefined },
  vnpayPayments: {
    type: [vnpayPaymentSchema], default: undefined,
    validate: { validator: value => !value || value.length <= 20, message: 'Đơn hàng đã đạt giới hạn số lần thanh toán' },
  },
  paymentReviewRequired: { type: Boolean, default: false },
  // Reserved before an outbound QueryDR call, including calls that time out.
  vnpayQueryNextAt: Date,
  itemsPrice: { ...money, default: 0 },
  shippingPrice: { ...money, default: 0 },
  discountAmount: { ...money, default: 0 },
  totalPrice: { ...money, default: 0 },
  voucherCode: { type: String, uppercase: true, trim: true },
  voucher: {
    type: new mongoose.Schema({
      _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher' },
      code: String,
      type: { type: String, enum: ['fixed', 'percent', 'shipping'] },
      discount: { type: Number, min: 0, validate: Number.isSafeInteger },
      maxDiscount: Number,
      reservationToken: String,
      wallet: mongoose.Schema.Types.ObjectId,
    }, { _id: false }),
    default: undefined,
  },
  voucherReleased: { type: Boolean, default: false },
  refundStatus: { type: String, enum: ['not_required', 'pending', 'refunded'], default: 'not_required' },
  refundedAt: Date,
  deliveryFailure: { type: deliveryFailureSchema, default: undefined },
  deliveryReturn: { type: deliveryReturnSchema, default: undefined },
  orderStatus: { type: String, required: true, enum: ORDER_STATUSES, default: 'Đang xử lý', index: true },
  isPaid: { type: Boolean, required: true, default: false },
  paidAt: Date,
  isDelivered: { type: Boolean, required: true, default: false },
  deliveredAt: Date,
  stockRestored: { type: Boolean, default: false },
  cancellationLock: { type: String, default: null },
  cancellationReceipt: String,
  cancellationRecoveryRequired: { type: Boolean, default: false },
  paymentDeadline: Date,
  paymentExpiryNextAt: Date,
  paymentExpiryReviewRequired: { type: Boolean, default: false },
  autoCancelledAt: Date,
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);
export default Order;

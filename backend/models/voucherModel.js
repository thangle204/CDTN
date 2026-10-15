import mongoose from "mongoose";

const voucherSchema = mongoose.Schema(
  {
    code: { 
      type: String, 
      required: true, 
      unique: true, 
      uppercase: true,
      trim: true,
      maxlength: 50
    },
    description: { 
      type: String, 
      required: true,
      trim: true,
      maxlength: 500
    },
    discount: { 
      type: Number, 
      required: true,
      min: 0,
      validate: {
        validator: function (discount) { return Number.isSafeInteger(discount) && (this.type !== 'percent' || discount <= 100); },
        message: 'Mức giảm phải là số nguyên không âm, phần trăm tối đa 100',
      }
    },
    type: { 
      type: String, 
      required: true, 
      enum: ['fixed', 'percent', 'shipping'],
      default: 'fixed'
    },
    minOrder: { 
      type: Number, 
      default: 0,
      min: 0,
      validate: Number.isSafeInteger
    },
    maxUses: { 
      type: Number, 
      default: 100,
      min: 1,
      validate: Number.isSafeInteger
    },
    usedCount: { 
      type: Number, 
      default: 0,
      min: 0,
      validate: {
        validator: function (usedCount) { return Number.isSafeInteger(usedCount) && (this.maxUses == null || usedCount <= this.maxUses); },
        message: 'Lượt đã dùng phải là số nguyên không âm và không vượt quá số lượt tối đa',
      }
    },
    startDate: { 
      type: Date, 
      default: Date.now 
    },
    endDate: { 
      type: Date, 
      required: true,
      validate: { validator: function (endDate) { return !this.startDate || endDate > this.startDate; }, message: 'Ngày hết hạn phải sau ngày bắt đầu' }
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    // Receipt and hold accompany a returned order's usage release atomically.
    deliveryReturnReceipts: { type: [String], default: [] },
    deliveryReturnHolds: { type: [String], default: [] }
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: { transform(_document, result) { delete result.deliveryReturnReceipts; delete result.deliveryReturnHolds; return result; } },
    toObject: { transform(_document, result) { delete result.deliveryReturnReceipts; delete result.deliveryReturnHolds; return result; } }
  }
);

const Voucher = mongoose.model('Voucher', voucherSchema);
export default Voucher;

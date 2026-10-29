import mongoose from "mongoose";
import bcrypt from "bcryptjs";

//tao schema cho gio hang
const cartItemSchema = mongoose.Schema({
    name: {type: String, required: true},
    quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    image: { type: String, required: true },
    price: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    color: { type: String, trim: true, maxlength: 100, default: '' },
    size: { type: Number, min: 1, max: 60, validate: { validator: (value) => value == null || Number.isInteger(value * 2), message: 'Size giày phải theo bước 0.5' } },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Product',
    },
});

const customerSchema = mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    name: { type: String, required: false, trim: true, maxlength: 100 },
    phone: { type: String, required: false, trim: true, validate: { validator: (value) => !value || /^0\d{9}$/.test(value), message: 'Số điện thoại phải có 10 số và bắt đầu bằng 0' } },
    shippingAddress: {
      type: new mongoose.Schema({
        name: { type: String, required: true, trim: true, maxlength: 120 },
        phone: { type: String, required: true, match: /^0\d{9}$/ },
        address: { type: String, required: true, trim: true, maxlength: 500 },
        city: { type: String, required: true, trim: true, maxlength: 120 },
        district: { type: String, trim: true, maxlength: 120, default: '' },
        ward: { type: String, trim: true, maxlength: 120, default: '' },
      }, { _id: false }),
      default: undefined,
    },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    authVersion: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    checkoutLock: {
        type: new mongoose.Schema({ token: String, expiresAt: Date, recoveryRequired: { type: Boolean, default: false } }, { _id: false }),
        default: null,
    },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    cart: [cartItemSchema],
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);


customerSchema.pre("save", async function () {

    if (!this.isModified("password")) {
        return;
    }
    

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);

    } catch (error) {

        throw new Error(error);
    }
});


customerSchema.methods.matchPassword = async function (enteredPassword) {
    if (!this.password) return false; 
    return await bcrypt.compare(enteredPassword, this.password);
};

const Customer = mongoose.model('Customer', customerSchema);
export default Customer;

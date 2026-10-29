import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  kind: { type: String, enum: ['saved', 'granted'], required: true },
  sourceOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  issuedAt: { type: Date, required: true },
  expiresAt: Date,
}, { timestamps: true });
// A refresh, retry or repeated delivery callback cannot extend an existing grant.
schema.index({ voucher: 1, user: 1 }, { unique: true });
const VoucherWallet = mongoose.model('VoucherWallet', schema);
let indexedDatabase, indexPromise;
export const ensureVoucherWalletIndexes = () => {
  if (!indexPromise || indexedDatabase !== VoucherWallet.db.name) {
    indexedDatabase = VoucherWallet.db.name;
    // Run lazily, after the application (or the isolated test runner) owns its
    // selected database. Also support deployments with automatic indexes off.
    indexPromise = VoucherWallet.init().then(() => VoucherWallet.createIndexes()).catch(error => {
      indexPromise = undefined;throw error;
    });
  }
  return indexPromise;
};
export default VoucherWallet;

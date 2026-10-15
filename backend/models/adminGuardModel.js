import mongoose from 'mongoose';

// One document protects the shared administrator invariant across Customer and
// Staff collections, including requests handled by different Node processes.
// This durable claim deliberately has no TTL: expiry could admit another writer
// while a delayed request is still changing an administrator's role.
const adminGuardSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  token: { type: String, default: null },
  startedAt: { type: Date, default: null },
}, { versionKey: false });

export default mongoose.model('AdminGuard', adminGuardSchema, 'admin_guards');

import crypto from 'node:crypto';
import AdminGuard from '../models/adminGuardModel.js';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import { httpError } from './validation.js';

export const ADMIN_ROLE_GUARD_ID = 'admin-role-changes';

export const withAdminRoleGuard = async (req, operation) => {
  const token = crypto.randomUUID();
  let claimed;
  try {
    // An occupied singleton cannot match token:null. Its upsert then collides
    // with the unique _id, so both first-use races and busy claims fail closed.
    claimed = await AdminGuard.findOneAndUpdate({
      _id: ADMIN_ROLE_GUARD_ID, token: null,
    }, { $set: { token, startedAt: new Date() } }, { upsert: true, new: true });
  } catch (error) {
    if (error.code === 11000) throw httpError(409, 'Quyền quản trị đang được cập nhật. Vui lòng thử lại sau');
    throw error;
  }
  if (!claimed) throw httpError(409, 'Quyền quản trị đang được cập nhật. Vui lòng thử lại sau');

  try {
    // protect/admin ran before this claim. Another request may have revoked
    // that account in between, so authorization must be refreshed under guard.
    const Model = req.accountType === 'staff' ? Staff : Customer;
    const caller = await Model.findById(req.user?._id);
    if (!caller || caller.isActive === false || (caller.authVersion ?? 0) !== (req.user?.authVersion ?? 0)) {
      throw httpError(401, 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại');
    }
    if (!caller.isAdmin) throw httpError(403, 'Chức năng này yêu cầu quyền quản trị');
    return await operation();
  } finally {
    let released;
    try {
      released = await AdminGuard.updateOne({
        _id: ADMIN_ROLE_GUARD_ID, token,
      }, { $set: { token: null, startedAt: null } });
    } catch {
      throw httpError(503, 'Cần kiểm tra khóa cập nhật quyền quản trị. Vui lòng liên hệ quản trị hệ thống');
    }
    if (released?.matchedCount !== 1) throw httpError(503, 'Cần kiểm tra khóa cập nhật quyền quản trị. Vui lòng liên hệ quản trị hệ thống');
  }
};

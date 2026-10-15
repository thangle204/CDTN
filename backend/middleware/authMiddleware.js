import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import { httpError } from '../utils/validation.js';

export const requireDatabase = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return next(httpError(503, 'Chưa kết nối được cơ sở dữ liệu. Vui lòng thử lại sau'));
  next();
};

export const protect = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) throw httpError(503, 'Chưa kết nối được cơ sở dữ liệu');
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) throw httpError(401, 'Vui lòng đăng nhập để tiếp tục');
  let decoded;
  try {
    decoded = jwt.verify(match[1], process.env.JWT_SECRET);
  } catch {
    throw httpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
  }
  if (!mongoose.isObjectIdOrHexString(decoded.id)) throw httpError(401, 'Phiên đăng nhập không hợp lệ');
  const accountType = decoded.accountType || 'customer';
  if (!['customer', 'staff'].includes(accountType)) throw httpError(401, 'Phiên đăng nhập không hợp lệ');
  const Model = accountType === 'staff' ? Staff : Customer;
  const user = await Model.findById(decoded.id).select('-password -resetPasswordToken -resetPasswordExpires -cart -checkoutLock');
  if (!user || user.isActive === false || (decoded.authVersion ?? 0) !== (user.authVersion ?? 0)) {
    throw httpError(401, 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại');
  }
  req.user = user;
  req.accountType = accountType;
  next();
};

export const admin = (req, res, next) => {
  if (!req.user?.isAdmin) return next(httpError(403, 'Chức năng này yêu cầu quyền quản trị'));
  next();
};

export const customerOnly = (req, res, next) => {
  if (req.accountType !== 'customer') return next(httpError(403, 'Vui lòng dùng tài khoản khách hàng cho chức năng mua sắm'));
  next();
};

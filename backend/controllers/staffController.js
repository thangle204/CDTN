import Staff from '../models/staffModel.js';
import generateToken from '../utils/generateToken.js';
import { cleanText, httpError, normalizeEmail, normalizePhone, validatePassword } from '../utils/validation.js';

export const registerStaff = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = validatePassword(req.body.password);
  const name = cleanText(req.body.name, 'Họ tên nhân viên', { max: 100 });
  const phone = normalizePhone(req.body.phone);
  const role = cleanText(req.body.role || 'Nhân viên', 'Chức vụ', { max: 100 });
  if (req.body.isAdmin !== undefined && typeof req.body.isAdmin !== 'boolean') throw httpError(400, 'Quyền quản trị không hợp lệ');
  if (await Staff.exists({ email })) throw httpError(409, 'Email nhân viên đã tồn tại');
  const staff = await Staff.create({ email, password, name, phone, role, isAdmin: req.body.isAdmin ?? false });
  res.status(201).json({ _id: staff._id, name: staff.name, email: staff.email, phone: staff.phone, role: staff.role, isAdmin: staff.isAdmin });
};

export const loginStaff = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (typeof req.body.password !== 'string') throw httpError(400, 'Vui lòng nhập mật khẩu');
  const staff = await Staff.findOne({ email });
  if (!staff || !(await staff.matchPassword(req.body.password))) throw httpError(401, 'Email hoặc mật khẩu không chính xác');
  if (staff.isActive === false) throw httpError(403, 'Tài khoản nhân viên đã bị vô hiệu hóa');
  res.json({
    _id: staff._id, name: staff.name, email: staff.email, role: staff.role, isAdmin: staff.isAdmin,
    token: generateToken(staff._id, { authVersion: staff.authVersion, accountType: 'staff' }),
  });
};

// Kiểm tra MongoDB bằng cấu hình giống server; không in URI hoặc thông tin tài khoản.
// Chạy từ thư mục dự án: node backend/checkDb.js
import './config/env.js';
import mongoose from 'mongoose';
import { mongoConnectionOptions } from './config/mongoOptions.js';

const checkDatabase = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    console.error('MONGO_URI chưa được cấu hình hoặc không đúng định dạng MongoDB.');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(uri, mongoConnectionOptions(uri, { serverSelectionTimeoutMS: 10000 }));
    await mongoose.connection.db.command({ ping: 1 });
    console.log('Kết nối MongoDB thành công.');
  } catch (error) {
    process.exitCode = 1;
    if (error.code === 18 || /bad auth|authentication failed/i.test(error.message)) {
      console.error('Xác thực MongoDB thất bại. Kiểm tra thông tin tài khoản trong cấu hình.');
    } else if (/ENOTFOUND|querySrv/i.test(error.message)) {
      console.error('Không tìm thấy máy chủ MongoDB. Kiểm tra địa chỉ máy chủ và mạng.');
    } else {
      console.error('Không kết nối được MongoDB. Kiểm tra cấu hình, mạng và quyền truy cập.');
    }
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      process.exitCode = 1;
      console.error('Không đóng được kết nối MongoDB.');
    }
  }
};

await checkDatabase();

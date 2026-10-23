// Kiểm tra MongoDB bằng cấu hình giống server; không in URI hoặc thông tin tài khoản.
// Chạy từ thư mục dự án: node backend/checkDb.js
import './config/env.js';
import mongoose from 'mongoose';
import { mongoConnectionOptions } from './config/mongoOptions.js';
import { formatMongoConnectionError } from './utils/mongoDiagnostics.js';

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
    console.error(formatMongoConnectionError(error));
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

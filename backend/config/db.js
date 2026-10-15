import mongoose from 'mongoose';
import { mongoConnectionOptions } from './mongoOptions.js';

export const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.warn('Chưa cấu hình MONGO_URI. Chỉ có thể xem sản phẩm mẫu');
    return false;
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, mongoConnectionOptions(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    }));
    console.log('Đã kết nối MongoDB');
    return true;
  } catch {
    console.error('Không kết nối được MongoDB. Kiểm tra MONGO_URI, tài khoản và quyền truy cập mạng');
    return false;
  }
};

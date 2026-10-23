import mongoose from 'mongoose';
import { mongoConnectionOptions } from './mongoOptions.js';
import { formatMongoConnectionError } from '../utils/mongoDiagnostics.js';

export const hasMongoConfiguration = () => /^mongodb(?:\+srv)?:\/\/\S+/.test(process.env.MONGO_URI || '');

export const connectDB = async () => {
  if (!hasMongoConfiguration()) {
    console.warn('MONGO_URI chưa được cấu hình hoặc không đúng định dạng. Kiểm tra backend/.env rồi khởi động lại API');
    return false;
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, mongoConnectionOptions(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    }));
    console.log('Đã kết nối MongoDB');
    return true;
  } catch (error) {
    console.error(formatMongoConnectionError(error));
    return false;
  }
};

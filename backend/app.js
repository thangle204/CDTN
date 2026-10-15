import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import productRoutes from './routes/productRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import voucherRoutes from './routes/voucherRoutes.js';
import { requireDatabase } from './middleware/authMiddleware.js';
import { serveProductImages } from './controllers/uploadController.js';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Demo-Mode'],
  }));
  app.use('/uploads/products', serveProductImages());
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    req.body ??= {};
    if (typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'Nội dung yêu cầu phải là một đối tượng JSON' });
    next();
  });
  app.get('/api/test', (req, res) => res.json({
    message: 'SHOE STORE API đang hoạt động',
    databaseConnected: mongoose.connection.readyState === 1,
  }));
  app.use('/api/products', productRoutes);
  app.use('/api/customers', requireDatabase, customerRoutes);
  app.use('/api/staff', requireDatabase, staffRoutes);
  app.use('/api/orders', requireDatabase, orderRoutes);
  app.use('/api/vouchers', requireDatabase, voucherRoutes);
  app.use((req, res) => res.status(404).json({ message: 'Không tìm thấy chức năng yêu cầu' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || (res.statusCode >= 400 ? res.statusCode : 500);
    let message = error.message;
    if (error.name === 'CastError') { status = 400; message = 'Mã dữ liệu không hợp lệ'; }
    if (error.name === 'ValidationError') {
      status = 400;
      message = Object.values(error.errors).map((entry) => entry.message).join('. ');
    }
    if (error.code === 11000) { status = 409; message = 'Email hoặc mã dữ liệu đã tồn tại'; }
    if (error.name === 'VersionError') { status = 409; message = 'Dữ liệu vừa được thay đổi. Vui lòng tải lại và thử lại'; }
    if (error.type === 'entity.parse.failed') { status = 400; message = 'Nội dung JSON không hợp lệ'; }
    if (status >= 500) {
      console.error('SHOE STORE API:', error.name || 'ServerError');
      message = status === 503 ? 'Dịch vụ tạm thời chưa sẵn sàng. ' + (error.status === 503 ? error.message : 'Vui lòng thử lại sau') : 'Có lỗi máy chủ. Vui lòng thử lại sau';
    }
    res.status(status).json({ message });
  });
  return app;
};

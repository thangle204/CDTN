// Dữ liệu mẫu cho cửa hàng giày. Chỉ dùng với database học/test.
// Lệnh: npm run seed -- --reset
// --reset xóa customers, products, orders và vouchers trước khi tạo dữ liệu mới.
// Đặt SEED_ADMIN_PASSWORD và SEED_USER_PASSWORD; script không in mật khẩu.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { mongoConnectionOptions } from './config/mongoOptions.js';
import bcrypt from 'bcryptjs';
import Customer from './models/customerModel.js';
import Product from './models/productModel.js';
import Order from './models/orderModel.js';
import Voucher from './models/voucherModel.js';
import mockProducts from './data/mockProducts.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(directory, '.env'), quiet: true });

const createData = async () => {
  if (!process.argv.includes('--reset')) {
    console.error('Chưa thay đổi dữ liệu. Dùng npm run seed -- --reset khi muốn xóa và tạo lại dữ liệu mẫu.');
    process.exitCode = 1;
    return;
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const userPassword = process.env.SEED_USER_PASSWORD;
  if (!adminPassword || adminPassword.trim().length < 6 || Buffer.byteLength(adminPassword) > 72 || !userPassword || userPassword.trim().length < 6 || Buffer.byteLength(userPassword) > 72) {
    console.error('Đặt SEED_ADMIN_PASSWORD và SEED_USER_PASSWORD với ít nhất 6 ký tự, tối đa 72 byte trước khi seed.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.MONGO_URI) {
    console.error('Chưa cấu hình MONGO_URI.');
    process.exitCode = 1;
    return;
  }

  try {
    // Chuẩn bị và kiểm tra dữ liệu trước khi xóa collections.
    const customers = [
      new Customer({
        email: 'admin@shoeshop.com',
        name: 'Admin cửa hàng giày',
        phone: '0901234567',
        password: await bcrypt.hash(adminPassword, 10),
        isAdmin: true,
        isActive: true,
        cart: [],
      }),
      new Customer({
        email: 'user1@example.com',
        name: 'Khách hàng mẫu',
        phone: '0907654321',
        password: await bcrypt.hash(userPassword, 10),
        isAdmin: false,
        isActive: true,
        cart: [],
      }),
    ];
    const products = mockProducts.map(({ _id, createdAt, updatedAt, ...product }) => new Product(product));
    await Promise.all([...customers, ...products].map(document => document.validate()));

    await mongoose.connect(process.env.MONGO_URI, mongoConnectionOptions(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 }));
    await Order.deleteMany({});
    await Voucher.deleteMany({});
    await Customer.deleteMany({});
    await Product.deleteMany({});
    await Customer.insertMany(customers);
    await Product.insertMany(products);
    console.log(`Đã tạo ${customers.length} tài khoản và ${products.length} mẫu giày; đơn hàng và voucher đã được làm trống.`);
    console.log('Tài khoản mẫu: admin@shoeshop.com và user1@example.com. Mật khẩu lấy từ các biến SEED_*_PASSWORD đã cấu hình.');
  } catch {
    process.exitCode = 1;
    console.error('Không tạo được dữ liệu mẫu. Kiểm tra cấu hình MongoDB và dữ liệu; lần reset có thể chưa hoàn tất.');
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      process.exitCode = 1;
      console.error('Không đóng được kết nối MongoDB.');
    }
  }
};

await createData();

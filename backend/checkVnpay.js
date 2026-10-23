import './config/env.js';
import { getVnpayConfig } from './utils/vnpay.js';

try {
  getVnpayConfig();
  console.log('Cấu hình VNPAY Sandbox hợp lệ.');
  console.log('Đây chỉ là kiểm tra cấu hình cục bộ; chưa kiểm tra merchant với VNPAY, URL IPN hoặc kết nối MongoDB.');
} catch {
  process.exitCode = 1;
  console.error('Chưa bật hoặc chưa cấu hình đầy đủ VNPAY Sandbox.');
  console.error('Kiểm tra VNPAY_ENABLED, VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VNPAY_RETURN_URL và VNPAY_IPN_URL trong backend/.env.');
  console.error('IPN cần URL HTTPS công khai. Xem hướng dẫn VNPAY Sandbox trong README.md.');
}

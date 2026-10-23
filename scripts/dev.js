import '../backend/config/env.js';
import concurrently from 'concurrently';
import { fileURLToPath } from 'node:url';
import { developmentPort, inspectDevelopmentServices } from '../backend/utils/devStartup.js';

try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const apiPort = developmentPort(process.env.PORT, 5000);
  const services = [
    { name: 'api', port: apiPort, pathname: '/api/test', command: 'npm run server' },
    { name: 'web', port: 5173, pathname: '/', command: 'npm run client' },
  ];
  if (process.argv.includes('--vnpay') || process.env.VNPAY_ENABLED === 'true') {
    services.push({ name: 'ipn', port: developmentPort(process.env.VNPAY_IPN_PORT, 5010),
      pathname: '/api/payments/vnpay/ipn', command: 'npm run vnpay:ipn' });
  }
  const states = await inspectDevelopmentServices(services);
  const blocked = states.filter(service => service.state === 'blocked');
  if (blocked.length) {
    console.error('Chưa khởi động: các cổng sau đang do tiến trình khác hoặc bản chạy cũ sử dụng:');
    for (const service of blocked) console.error(`  ${service.name}: ${service.port}`);
    console.error('Dừng bản chạy trước bằng Ctrl+C rồi chạy lại. Không tự đổi cổng hoặc dừng chương trình khác.');
    process.exitCode = 1;
  } else {
    for (const service of states.filter(service => service.state === 'running')) {
      console.log(`Đang dùng dịch vụ ${service.name} của dự án trên cổng ${service.port}.`);
    }
    console.log('Mở website: http://localhost:5173');
    console.log(`Kiểm tra API: http://localhost:${apiPort}/api/test`);
    const missing = states.filter(service => service.state === 'available');
    if (!missing.length) {
      console.log('Dự án đã chạy. Không khởi động thêm tiến trình trùng.');
    } else {
      const { result } = concurrently(missing.map(service => ({ name: service.name, command: service.command })), {
        cwd: root, prefix: 'name', killOthersOn: ['failure'], killTimeout: 3000,
      });
      await result.catch(() => { process.exitCode = 1; });
    }
  }
} catch (error) {
  console.error(error instanceof TypeError ? error.message : 'Không khởi động được môi trường phát triển.');
  process.exitCode = 1;
}

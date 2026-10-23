import './config/env.js';
import { createVnpayIpnRelay } from './utils/vnpayIpnRelay.js';

const configuredPort = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new TypeError('Invalid relay port configuration');
  }
  return Number(value);
};

try {
  const apiPort = configuredPort('PORT', 5000);
  const relayPort = configuredPort('VNPAY_IPN_PORT', 5010);
  if (apiPort === relayPort) throw new TypeError('Relay and API ports must differ');
  const server = createVnpayIpnRelay({ apiPort });
  let stopping = false;
  const shutdown = (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    const forceClose = setTimeout(() => server.closeAllConnections(), 6000);
    forceClose.unref();
    server.close(() => clearTimeout(forceClose));
  };
  server.once('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Không mở được IPN relay: cổng đang được sử dụng.'
      : 'Không mở được IPN relay.');
    shutdown(1);
  });
  server.listen(relayPort, '127.0.0.1', () => {
    console.log('VNPAY IPN relay: http://127.0.0.1:' + relayPort + '/api/payments/vnpay/ipn');
  });
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
} catch {
  process.exitCode = 1;
  console.error('Cần PORT và VNPAY_IPN_PORT hợp lệ, khác nhau, trong khoảng 1–65535.');
}

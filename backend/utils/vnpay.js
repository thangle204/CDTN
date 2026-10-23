import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { orderError } from './orderPricing.js';

const SANDBOX_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const CONFIGURATION_MESSAGE = 'Thanh toán VNPAY Sandbox chưa được cấu hình đầy đủ. Vui lòng liên hệ cửa hàng.';
const configurationError = () => orderError(503, CONFIGURATION_MESSAGE);
const text = value => typeof value === 'string' ? value.trim() : '';
const validReference = value => typeof value === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(value);
const validAmount = value => Number.isSafeInteger(value) && value > 0 && value <= 9_999_999_999;

const isLocalHostname = hostname => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::' || host.startsWith('::ffff:')) return true;
  if (isIP(host) === 4) {
    const [first, second] = host.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || first === 169 && second === 254
      || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
  }
  return isIP(host) === 6 && /^(?:f[cd]|fe[89ab])/i.test(host);
};

const configurationUrl = (value, publicHttps = false) => {
  const raw = text(value);
  try {
    const url = new URL(raw);
    if (!raw || raw.length > 255 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw configurationError();
    if (publicHttps && (url.protocol !== 'https:' || isLocalHostname(url.hostname))) throw configurationError();
    return url.href;
  } catch { throw configurationError(); }
};

export const getVnpayConfig = (env = process.env, { requireEnabled = true } = {}) => {
  // Disabling new checkouts must not discard a previously initiated payment.
  if (requireEnabled && env.VNPAY_ENABLED !== 'true') throw configurationError();
  const tmnCode = text(env.VNPAY_TMN_CODE);
  const hashSecret = text(env.VNPAY_HASH_SECRET);
  const bankCode = text(env.VNPAY_BANK_CODE).toUpperCase();
  const timeout = env.VNPAY_TIMEOUT_MINUTES == null || env.VNPAY_TIMEOUT_MINUTES === '' ? '15' : text(env.VNPAY_TIMEOUT_MINUTES);
  const timeoutMinutes = Number(timeout);
  if (!/^[a-zA-Z0-9]{8}$/.test(tmnCode) || hashSecret.length < 16 || hashSecret.length > 1024
    || bankCode && !/^[a-zA-Z0-9]{3,20}$/.test(bankCode)
    || !/^\d+$/.test(timeout) || timeoutMinutes < 5 || timeoutMinutes > 60) throw configurationError();
  return Object.freeze({
    tmnCode, hashSecret,
    returnUrl: configurationUrl(env.VNPAY_RETURN_URL),
    ipnUrl: configurationUrl(env.VNPAY_IPN_URL, true),
    bankCode, timeoutMinutes,
  });
};

export const formatVnpayDate = date => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw orderError(400, 'Thời gian thanh toán không hợp lệ');
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  if (!Number.isFinite(local.getTime()) || local.getUTCFullYear() < 1 || local.getUTCFullYear() > 9999) throw orderError(400, 'Thời gian thanh toán không hợp lệ');
  return local.toISOString().slice(0, 19).replace(/[-T:]/g, '');
};

// VNPAY 2.1.0 signs sorted, encoded query values. A space is represented by +;
// already encoded values must never be passed through URLSearchParams again.
const canonicalQuery = parameters => Object.keys(parameters).sort()
  .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(parameters[key]).replace(/%20/g, '+')}`).join('&');
const signature = (parameters, secret) => createHmac('sha512', secret).update(canonicalQuery(parameters), 'utf8').digest('hex');

export const createVnpayPaymentUrl = ({ config, amount, txnRef, ipAddress, now = new Date(), expiresAt }) => {
  if (!config?.tmnCode || !config?.hashSecret || !config?.returnUrl) throw configurationError();
  if (!validAmount(amount) || amount < 5000) throw orderError(400, 'Số tiền thanh toán VNPAY phải từ 5.000đ và nằm trong giới hạn cho phép');
  if (!validReference(txnRef)) throw orderError(400, 'Mã giao dịch VNPAY không hợp lệ');
  let address = typeof ipAddress === 'string' ? ipAddress : '';
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  if (address === '::1') address = '127.0.0.1';
  if (!isIP(address)) throw orderError(400, 'Địa chỉ kết nối thanh toán không hợp lệ');
  const createDate = formatVnpayDate(now);
  const expiry = expiresAt ?? new Date(now.getTime() + config.timeoutMinutes * 60 * 1000);
  const expireDate = formatVnpayDate(expiry);
  if (expiry.getTime() <= now.getTime() || expiry.getTime() - now.getTime() > 60 * 60 * 1000) throw orderError(400, 'Thời hạn thanh toán VNPAY không hợp lệ');
  const parameters = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(amount * 100), vnp_CurrCode: 'VND', vnp_TxnRef: txnRef,
    vnp_OrderInfo: `Thanh toan don hang ${txnRef}`, vnp_OrderType: 'other',
    vnp_Locale: 'vn', vnp_ReturnUrl: config.returnUrl, vnp_IpAddr: address,
    vnp_CreateDate: createDate, vnp_ExpireDate: expireDate,
    ...(config.bankCode ? { vnp_BankCode: config.bankCode } : {}),
  };
  return `${SANDBOX_URL}?${canonicalQuery(parameters)}&vnp_SecureHash=${signature(parameters, config.hashSecret)}`;
};

export const verifyVnpayParameters = (query, config) => {
  try {
    if (!query || typeof query !== 'object' || Array.isArray(query) || !config?.hashSecret || !config?.tmnCode) return null;
    const prototype = Object.getPrototypeOf(query);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const entries = Object.entries(query);
    if (entries.length < 7 || entries.length > 64) return null;
    const parameters = {};
    for (const [key, value] of entries) {
      if (!/^vnp_[a-zA-Z0-9]{1,60}$/.test(key) || typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
      parameters[key] = value;
    }
    const suppliedHash = parameters.vnp_SecureHash;
    if (!/^[a-fA-F0-9]{128}$/.test(suppliedHash || '')) return null;
    delete parameters.vnp_SecureHash;
    delete parameters.vnp_SecureHashType;
    if (parameters.vnp_TmnCode !== config.tmnCode || !/^\d{1,12}$/.test(parameters.vnp_Amount || '')
      || !validAmount(Number(parameters.vnp_Amount) / 100) || !validReference(parameters.vnp_TxnRef)
      || !/^\d{2}$/.test(parameters.vnp_ResponseCode || '') || !/^\d{2}$/.test(parameters.vnp_TransactionStatus || '')
      || !/^[a-zA-Z0-9]{1,30}$/.test(parameters.vnp_TransactionNo || '')
      || parameters.vnp_PayDate !== undefined && !/^\d{14}$/.test(parameters.vnp_PayDate)) return null;
    const expectedHash = signature(parameters, config.hashSecret);
    if (!timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(expectedHash, 'hex'))) return null;
    return parameters;
  } catch { return null; }
};

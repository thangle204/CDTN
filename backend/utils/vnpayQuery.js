import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import tls from 'node:tls';
import { formatVnpayDate } from './vnpay.js';

const HOSTNAME = 'sandbox.vnpayment.vn';
const PATHNAME = '/merchant_webapi/api/transaction';
const REQUEST_FIELDS = Object.freeze([
  'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TxnRef',
  'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo',
]);
const RESPONSE_FIELDS = Object.freeze([
  'vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode',
  'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo',
  'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo',
  'vnp_PromotionCode', 'vnp_PromotionAmount',
]);
const HASH = /^[a-fA-F0-9]{128}$/;
const REFERENCE = /^[a-zA-Z0-9]{1,100}$/;
const CODE = /^\d{2}$/;
const invalidInput = () => new TypeError('Invalid VNPAY query configuration or input');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const safeText = (value, maximum = 255) => typeof value === 'string' && value.length <= maximum
  && !/[|\u0000-\u001f\u007f]/.test(value);
const validConfig = config => typeof config?.tmnCode === 'string' && /^[a-zA-Z0-9]{8}$/.test(config.tmnCode)
  && typeof config?.hashSecret === 'string' && config.hashSecret.length >= 16 && config.hashSecret.length <= 1024;
const amountInRange = value => Number.isSafeInteger(value) && value >= 5000 && value <= 9_999_999_999;
const sign = (fields, data, secret) => createHmac('sha512', secret)
  .update(fields.map(field => data[field] ?? '').join('|'), 'utf8').digest('hex');
const equalHash = (actual, expected) => typeof actual === 'string' && HASH.test(actual)
  && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));

const validDate = value => {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return false;
  try {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`;
    return formatVnpayDate(new Date(iso)) === value;
  } catch { return false; }
};

const normalizedIp = value => {
  if (typeof value !== 'string') return '';
  if (value === '::1') return '127.0.0.1';
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) return value.slice(7);
  return isIP(value) ? value : '';
};

/** Build a QueryDR body. Dates are GMT+7; amount is never supplied by a browser. */
export const createQueryDrRequest = ({
  config, txnRef, transactionDate, ipAddress, now = new Date(),
  requestId = randomBytes(16).toString('hex'), orderInfo = 'Truy van giao dich VNPAY',
} = {}) => {
  try {
    const originalDate = transactionDate instanceof Date ? formatVnpayDate(transactionDate) : transactionDate;
    const ip = normalizedIp(ipAddress);
    if (!validConfig(config) || !REFERENCE.test(txnRef || '')
      || typeof txnRef !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(requestId || '')
      || typeof requestId !== 'string' || !validDate(originalDate) || !ip
      || !safeText(orderInfo) || !orderInfo.trim()) throw invalidInput();
    const body = {
      vnp_RequestId: requestId, vnp_Version: '2.1.0', vnp_Command: 'querydr',
      vnp_TmnCode: config.tmnCode, vnp_TxnRef: txnRef,
      vnp_TransactionDate: originalDate, vnp_CreateDate: formatVnpayDate(now),
      vnp_IpAddr: ip, vnp_OrderInfo: orderInfo,
    };
    return Object.freeze({ ...body, vnp_SecureHash: sign(REQUEST_FIELDS, body, config.hashSecret) });
  } catch { throw invalidInput(); }
};

const safeCodes = body => Object.fromEntries([
  ['responseCode', body?.vnp_ResponseCode],
  ['transactionStatus', body?.vnp_TransactionStatus],
  ['transactionType', body?.vnp_TransactionType],
].filter(([, value]) => typeof value === 'string' && CODE.test(value)));
const unverified = (reason, body) => ({ verified: false, paid: false, status: 'unverified', reason, ...safeCodes(body) });

/** Verify the QueryDR protocol, independently of IPN's sorted-query signature. */
export const verifyQueryDrResponse = (body, { config, request, amount } = {}) => {
  try {
    if (!validConfig(config) || !plain(request) || request.vnp_TmnCode !== config.tmnCode
      || !REFERENCE.test(request.vnp_TxnRef || '') || !amountInRange(amount) || !plain(body)) {
      return unverified('INVALID_RESPONSE');
    }
    const allowed = new Set([...RESPONSE_FIELDS, 'vnp_SecureHash']);
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.has(key) || !safeText(value, 2048)) return unverified('INVALID_RESPONSE');
    }
    if (!CODE.test(body.vnp_ResponseCode || '')) return unverified('INVALID_RESPONSE');
    if (!Object.hasOwn(body, 'vnp_SecureHash')) {
      return unverified(body.vnp_ResponseCode === '00' ? 'INVALID_SIGNATURE' : 'UNSIGNED_GATEWAY_ERROR', body);
    }
    if (!equalHash(body.vnp_SecureHash, sign(RESPONSE_FIELDS, body, config.hashSecret))) {
      return unverified('INVALID_SIGNATURE', body);
    }
    if (body.vnp_TmnCode !== config.tmnCode) return unverified('MISMATCHED_MERCHANT', body);
    if (body.vnp_TxnRef !== request.vnp_TxnRef) return unverified('MISMATCHED_REFERENCE', body);
    if (body.vnp_Command !== undefined && body.vnp_Command !== '' && body.vnp_Command !== 'querydr') {
      return unverified('INVALID_RESPONSE', body);
    }
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(body.vnp_ResponseId || '')
      || !safeText(body.vnp_Message) || !body.vnp_Message) return unverified('INVALID_RESPONSE', body);
    const codes = safeCodes(body);
    if (body.vnp_ResponseCode !== '00') {
      return { verified: true, paid: false, status: 'review', reason: 'GATEWAY_ERROR', ...codes };
    }
    if (!/^\d{1,12}$/.test(body.vnp_Amount || '') || Number(body.vnp_Amount) % 100 !== 0
      || !amountInRange(Number(body.vnp_Amount) / 100)) return unverified('INVALID_RESPONSE', body);
    if (Number(body.vnp_Amount) !== amount * 100) {
      return unverified('MISMATCHED_AMOUNT', body);
    }
    if (!CODE.test(body.vnp_TransactionType || '') || !CODE.test(body.vnp_TransactionStatus || '')
      || !/^\d{1,15}$/.test(body.vnp_TransactionNo || '')
      || !/^[a-zA-Z0-9]{3,20}$/.test(body.vnp_BankCode || '')
      || !safeText(body.vnp_OrderInfo) || !body.vnp_OrderInfo
      || body.vnp_PayDate && !validDate(body.vnp_PayDate)
      || body.vnp_PromotionCode !== undefined && !/^[a-zA-Z0-9]{0,12}$/.test(body.vnp_PromotionCode)
      || body.vnp_PromotionAmount !== undefined && !/^\d{0,12}$/.test(body.vnp_PromotionAmount)) {
      return unverified('INVALID_RESPONSE', body);
    }
    const verified = { verified: true, paid: false, ...codes };
    if (body.vnp_TransactionType !== '01') {
      return { ...verified, status: 'review', reason: 'NON_PAYMENT_TRANSACTION' };
    }
    if (body.vnp_PromotionCode || Number(body.vnp_PromotionAmount || '0') > 0) {
      return { ...verified, status: 'review', reason: 'PROMOTION_REQUIRES_REVIEW' };
    }
    if (body.vnp_TransactionStatus !== '00') {
      return { ...verified, status: body.vnp_TransactionStatus === '01' ? 'pending' : 'review',
        reason: body.vnp_TransactionStatus === '01' ? 'PAYMENT_PENDING' : 'PAYMENT_NOT_CONFIRMED' };
    }
    if (Number(body.vnp_TransactionNo) === 0) return unverified('INVALID_RESPONSE', body);
    return { ...verified, paid: true, status: 'paid', reason: 'PAID', amount,
      transactionNo: body.vnp_TransactionNo, bankCode: body.vnp_BankCode, payDate: body.vnp_PayDate || '' };
  } catch { return unverified('INVALID_RESPONSE'); }
};

const connectionTrust = () => {
  // Trust the same default and OS roots as the MongoDB connection helper.
  // This affects this HTTPS connection only; chain and hostname checks stay on.
  try {
    if (typeof tls.getCACertificates === 'function') {
      const ca = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
      if (ca.length) return { ca };
    }
  } catch { /* Keep Node's normal TLS defaults on unsupported platforms. */ }
  return {};
};
const transportReason = error => /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)/
  .test(typeof error?.code === 'string' ? error.code : '') ? 'TLS_ERROR' : 'TRANSPORT_ERROR';
const responseType = headers => {
  const contentType = headers?.['content-type'];
  if (typeof contentType !== 'string') return 'missing';
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  return ['application/json', 'text/html', 'text/plain'].includes(mime) ? mime : 'other';
};

/** One bounded, fixed-target HTTPS lookup. No retries and no database writes. */
export const queryVnpayTransaction = ({
  config, request, amount, timeoutMS = 10000, maxResponseBytes = 65536, transport = httpsRequest,
} = {}) => {
  let payload;
  try {
    if (!validConfig(config) || !plain(request) || !amountInRange(amount)
      || !Number.isInteger(timeoutMS) || timeoutMS < 1 || timeoutMS > 60000
      || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1048576
      || typeof transport !== 'function') throw invalidInput();
    const rebuilt = createQueryDrRequest({ config, txnRef: request.vnp_TxnRef,
      transactionDate: request.vnp_TransactionDate, ipAddress: request.vnp_IpAddr,
      now: new Date(`${request.vnp_CreateDate?.slice(0, 4)}-${request.vnp_CreateDate?.slice(4, 6)}-${request.vnp_CreateDate?.slice(6, 8)}T${request.vnp_CreateDate?.slice(8, 10)}:${request.vnp_CreateDate?.slice(10, 12)}:${request.vnp_CreateDate?.slice(12, 14)}+07:00`),
      requestId: request.vnp_RequestId, orderInfo: request.vnp_OrderInfo });
    if (Object.keys(request).length !== Object.keys(rebuilt).length
      || Object.keys(rebuilt).some(key => request[key] !== rebuilt[key])) throw invalidInput();
    payload = JSON.stringify(rebuilt);
  } catch { throw invalidInput(); }

  return new Promise(resolve => {
    let outgoing;
    let incoming;
    let complete = false;
    let httpStatus;
    let contentType;
    const metadata = () => ({ ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(contentType === undefined ? {} : { contentType }) });
    const finish = result => {
      if (complete) return;
      complete = true;
      clearTimeout(deadline);
      outgoing?.destroy?.();
      incoming?.destroy?.();
      resolve({ ...result, ...metadata() });
    };
    const failure = reason => finish({ verified: false, paid: false, status: 'error', reason });
    const deadline = setTimeout(() => failure('TIMEOUT'), timeoutMS);
    try {
      outgoing = transport({
        protocol: 'https:', hostname: HOSTNAME, port: 443, path: PATHNAME, method: 'POST',
        servername: HOSTNAME, rejectUnauthorized: true, ...connectionTrust(),
        maxHeaderSize: 8192,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          'User-Agent': 'shoe-store-vnpay-sandbox/1.0',
          'Content-Length': Buffer.byteLength(payload) },
      }, response => {
        incoming = response;
        response.once('error', error => failure(transportReason(error)));
        response.once('aborted', () => failure('TRANSPORT_ERROR'));
        if (complete) { response.destroy(); return; }
        if (Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599) {
          httpStatus = response.statusCode;
        }
        contentType = responseType(response.headers);
        if (httpStatus !== 200) return failure('HTTP_STATUS');
        if (contentType !== 'application/json') return failure('NON_JSON_RESPONSE');
        if (response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          return failure('NON_JSON_RESPONSE');
        }
        const declaredBytes = response.headers?.['content-length'];
        if (declaredBytes !== undefined && (!/^\d+$/.test(declaredBytes) || Number(declaredBytes) > maxResponseBytes)) {
          return failure('RESPONSE_TOO_LARGE');
        }
        let bytes = 0;
        const chunks = [];
        response.on('data', chunk => {
          if (complete) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxResponseBytes) return failure('RESPONSE_TOO_LARGE');
          chunks.push(buffer);
        });
        response.once('end', () => {
          if (complete) return;
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return failure('INVALID_JSON'); }
          finish(verifyQueryDrResponse(body, { config, request, amount }));
        });
      });
      outgoing.once('error', error => failure(transportReason(error)));
      if (complete) { outgoing.destroy(); return; }
      outgoing.end(payload);
    } catch { failure('TRANSPORT_ERROR'); }
  });
};

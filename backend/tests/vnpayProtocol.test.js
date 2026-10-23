import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { createVnpayPaymentUrl, formatVnpayDate, getVnpayConfig, verifyVnpayParameters } from '../utils/vnpay.js';

// All credentials and callbacks below are local test vectors. No .env is read,
// no live gateway is called, and no database operations are performed.
const environment = {
  VNPAY_ENABLED: 'true', VNPAY_TMN_CODE: 'TEST0001',
  VNPAY_HASH_SECRET: 'unit-test-secret-never-used-live',
  VNPAY_RETURN_URL: 'http://localhost:5173/payment/vnpay/return',
  VNPAY_IPN_URL: 'https://shop.example.com/api/payments/vnpay/ipn',
};
const config = getVnpayConfig(environment);
const now = new Date('2026-10-22T00:05:06.000Z');
const request = { config, amount: 230000, txnRef: 'TEST20261022', ipAddress: '127.0.0.1', now };
const callback = {
  vnp_Amount: '23000000', vnp_BankCode: 'NCB',
  vnp_OrderInfo: 'Thanh toan: A + B & 100%/giay (40)!',
  vnp_PayDate: '20261022071006', vnp_ResponseCode: '00', vnp_TmnCode: 'TEST0001',
  vnp_TransactionNo: '12345678', vnp_TransactionStatus: '00', vnp_TxnRef: 'TEST20261022',
  vnp_SecureHash: '078501dc118a7861c88dcd24cd5f970b0884161e5e7934e0d61136b289e262609f7e3b4eb8ba0217fdc1413c24ca2a41f5db769c94d793552e6621593d9c65db',
};
const signCallback = values => {
  const fields = { ...values };
  delete fields.vnp_SecureHash;
  delete fields.vnp_SecureHashType;
  const data = Object.keys(fields).sort().map(key => `${key}=${encodeURIComponent(fields[key]).replaceAll('%20', '+')}`).join('&');
  return { ...fields, vnp_SecureHash: createHmac('sha512', config.hashSecret).update(data).digest('hex') };
};

test('VNPAY config requires explicit enabling and returns only sandbox configuration', () => {
  assert.deepEqual(config, {
    tmnCode: 'TEST0001', hashSecret: environment.VNPAY_HASH_SECRET,
    returnUrl: environment.VNPAY_RETURN_URL, ipnUrl: environment.VNPAY_IPN_URL,
    bankCode: '', timeoutMinutes: 15,
  });
  assert.equal(Object.isFrozen(config), true);
  for (const enabled of [undefined, '', 'false', 'TRUE', true]) {
    assert.throws(() => getVnpayConfig({ ...environment, VNPAY_ENABLED: enabled }), error => error.status === 503);
  }
});

test('disabled VNPAY prevents new links but keeps configured callbacks verifiable', () => {
  const disabled = { ...environment, VNPAY_ENABLED: 'false' };
  assert.throws(() => getVnpayConfig(disabled), error => error.status === 503);
  const callbackConfig = getVnpayConfig(disabled, { requireEnabled: false });
  assert.deepEqual(callbackConfig, config);
  assert.ok(verifyVnpayParameters(callback, callbackConfig));
  assert.throws(() => getVnpayConfig({ ...disabled, VNPAY_HASH_SECRET: '' }, { requireEnabled: false }), error => error.status === 503);
});

test('VNPAY configuration rejects malformed credentials, banks and timeouts without leaking values', () => {
  for (const patch of [
    { VNPAY_TMN_CODE: 'invalid-merchant' }, { VNPAY_HASH_SECRET: 'short-private' },
    { VNPAY_BANK_CODE: 'NCB&vnp_Amount=1' }, { VNPAY_TIMEOUT_MINUTES: '4' },
    { VNPAY_TIMEOUT_MINUTES: '61' }, { VNPAY_TIMEOUT_MINUTES: '15.5' },
  ]) {
    assert.throws(() => getVnpayConfig({ ...environment, ...patch }), error => {
      assert.equal(error.status, 503);
      assert.equal(error.message, 'Thanh toán VNPAY Sandbox chưa được cấu hình đầy đủ. Vui lòng liên hệ cửa hàng.');
      assert.equal(error.message.includes(environment.VNPAY_HASH_SECRET), false);
      return true;
    });
  }
  assert.equal(getVnpayConfig({ ...environment, VNPAY_TIMEOUT_MINUTES: '5' }).timeoutMinutes, 5);
  assert.equal(getVnpayConfig({ ...environment, VNPAY_TIMEOUT_MINUTES: '60' }).timeoutMinutes, 60);
});

test('VNPAY IPN requires HTTPS on a public host while return may use localhost for testing', () => {
  for (const value of [
    'http://shop.example.com/ipn', 'https://localhost/ipn', 'https://foo.localhost/ipn',
    'https://localhost./ipn', 'https://foo.localhost./ipn',
    'https://127.0.0.1/ipn', 'https://127.0.0.2/ipn', 'https://[::1]/ipn',
    'https://0.0.0.0/ipn', 'https://10.1.2.3/ipn', 'https://192.168.1.4/ipn',
    'https://172.16.1.2/ipn', 'https://[fd00::1]/ipn',
    'https://user:password@shop.example.com/ipn', 'https://shop.example.com/ipn#fragment',
  ]) assert.throws(() => getVnpayConfig({ ...environment, VNPAY_IPN_URL: value }), error => error.status === 503);
  for (const value of ['javascript:alert(1)', 'file:///tmp/return', 'http://user:password@localhost:5173/return', 'http://localhost:5173/return#fragment']) {
    assert.throws(() => getVnpayConfig({ ...environment, VNPAY_RETURN_URL: value }), error => error.status === 503);
  }
});

test('VNPAY dates always use GMT+7, including day/year rollover', () => {
  assert.equal(formatVnpayDate(now), '20261022070506');
  assert.equal(formatVnpayDate(new Date('2026-12-31T20:01:02.000Z')), '20270101030102');
  assert.equal(formatVnpayDate(new Date('2026-10-22T07:05:06+07:00')), '20261022070506');
  for (const value of [new Date('invalid'), undefined, '2026-10-22', new Date(8.64e15)]) {
    assert.throws(() => formatVnpayDate(value), error => error.status === 400);
  }
});

test('VNPAY create URL matches a fixed HMAC-SHA512 vector using official 2.1.0 query encoding', () => {
  const expectedQuery = 'vnp_Amount=23000000&vnp_Command=pay&vnp_CreateDate=20261022070506&vnp_CurrCode=VND&vnp_ExpireDate=20261022072006&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+don+hang+TEST20261022&vnp_OrderType=other&vnp_ReturnUrl=http%3A%2F%2Flocalhost%3A5173%2Fpayment%2Fvnpay%2Freturn&vnp_TmnCode=TEST0001&vnp_TxnRef=TEST20261022&vnp_Version=2.1.0';
  const expectedHash = 'c635b28f76b22713ec1cb4b5b1580e4d0f401d222e81c0426beab8c9e5151356ab17edc740f267e59121cc4dcdd68c7c534218854270731b91a6c020f6a4dbc8';
  assert.equal(createVnpayPaymentUrl(request), `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?${expectedQuery}&vnp_SecureHash=${expectedHash}`);
  const parsed = new URL(createVnpayPaymentUrl({ ...request, config: { ...config, paymentUrl: 'https://untrusted.example/pay' } }));
  assert.equal(parsed.origin, 'https://sandbox.vnpayment.vn');
  assert.equal(parsed.searchParams.has('vnp_IpnUrl'), false, 'IPN is registered with the merchant portal rather than sent as an unsigned setting');
  assert.equal(parsed.searchParams.has('vnp_BankCode'), false, 'Gateway chooser supports sandbox NCB cards and QR');
});

test('VNPAY create URL supports configured QR and bank routes and normalizes local IP addresses', () => {
  for (const bank of ['VNPAYQR', 'VNBANK', 'INTCARD', 'NCB']) {
    const selected = getVnpayConfig({ ...environment, VNPAY_BANK_CODE: bank });
    const url = new URL(createVnpayPaymentUrl({ ...request, config: selected, ipAddress: '::ffff:127.0.0.1' }));
    assert.equal(url.searchParams.get('vnp_BankCode'), bank);
    assert.equal(url.searchParams.get('vnp_IpAddr'), '127.0.0.1');
  }
  assert.equal(new URL(createVnpayPaymentUrl({ ...request, ipAddress: '::1' })).searchParams.get('vnp_IpAddr'), '127.0.0.1');
  assert.equal(new URL(createVnpayPaymentUrl({ ...request, ipAddress: '2001:db8::1' })).searchParams.get('vnp_IpAddr'), '2001:db8::1');
});

test('VNPAY creation validates amount bounds, reference, address and expiry before signing', () => {
  for (const amount of [0, -1, 1.5, 4999, '230000', Number.NaN, Infinity, 10_000_000_000]) {
    assert.throws(() => createVnpayPaymentUrl({ ...request, amount }), error => error.status === 400);
  }
  assert.equal(new URL(createVnpayPaymentUrl({ ...request, amount: 5000 })).searchParams.get('vnp_Amount'), '500000');
  assert.equal(new URL(createVnpayPaymentUrl({ ...request, amount: 9_999_999_999 })).searchParams.get('vnp_Amount'), '999999999900');
  for (const txnRef of ['', 'ref&amount=1', 'a'.repeat(101)]) {
    assert.throws(() => createVnpayPaymentUrl({ ...request, txnRef }), error => error.status === 400);
  }
  for (const ipAddress of ['', '127.0.0.1, 10.0.0.1', 'localhost']) {
    assert.throws(() => createVnpayPaymentUrl({ ...request, ipAddress }), error => error.status === 400);
  }
  for (const expiresAt of [new Date(now), new Date(now.getTime() - 1), new Date(now.getTime() + 61 * 60000), new Date('invalid')]) {
    assert.throws(() => createVnpayPaymentUrl({ ...request, expiresAt }), error => error.status === 400);
  }
});

test('VNPAY verification accepts the fixed special-character vector and strips hash metadata', () => {
  const expected = { ...callback };
  delete expected.vnp_SecureHash;
  assert.deepEqual(verifyVnpayParameters(callback, config), expected);
  assert.deepEqual(verifyVnpayParameters({ ...callback, vnp_SecureHashType: 'HMACSHA512' }, config), expected);
  assert.deepEqual(verifyVnpayParameters({ ...callback, vnp_SecureHash: callback.vnp_SecureHash.toUpperCase() }, config), expected);
  assert.ok(callback.vnp_SecureHash, 'Verification must not mutate req.query');
});

test('VNPAY verification detects amount/reference/merchant/status tampering and wrong secrets', () => {
  for (const patch of [
    { vnp_Amount: '23000100' }, { vnp_TxnRef: 'OTHERREF' }, { vnp_TmnCode: 'OTHER001' },
    { vnp_ResponseCode: '24' }, { vnp_TransactionStatus: '02' }, { vnp_TransactionNo: '99999' },
  ]) assert.equal(verifyVnpayParameters({ ...callback, ...patch }, config), null);
  assert.equal(verifyVnpayParameters(callback, { ...config, hashSecret: 'another-unit-test-secret' }), null);
  assert.equal(verifyVnpayParameters(signCallback({ ...callback, vnp_TmnCode: 'OTHER001' }), config), null, 'Even a signed response must belong to the configured merchant');
});

test('VNPAY verification accepts signed unsuccessful outcomes without interpreting them as paid', () => {
  const failed = signCallback({ ...callback, vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' });
  const verified = verifyVnpayParameters(failed, config);
  assert.equal(verified.vnp_ResponseCode, '24');
  assert.equal(verified.vnp_TransactionStatus, '02');
});

test('VNPAY verification rejects validly signed malformed critical fields', () => {
  for (const patch of [
    { vnp_Amount: '0' }, { vnp_Amount: '23000001' }, { vnp_Amount: '1e8' },
    { vnp_Amount: '1000000000000' }, { vnp_Amount: '-23000000' }, { vnp_TxnRef: 'A/B' },
    { vnp_ResponseCode: '0' }, { vnp_TransactionStatus: '000' },
    { vnp_TransactionNo: 'bad/value' }, { vnp_TransactionNo: '' }, { vnp_PayDate: '2026-10-22' },
  ]) assert.equal(verifyVnpayParameters(signCallback({ ...callback, ...patch }), config), null);
  for (const field of ['vnp_Amount', 'vnp_TxnRef', 'vnp_ResponseCode', 'vnp_TransactionStatus', 'vnp_TransactionNo']) {
    const missing = { ...callback };
    delete missing[field];
    assert.equal(verifyVnpayParameters(signCallback(missing), config), null);
  }
});

test('VNPAY verification rejects repeated query values, objects, unexpected keys and oversized input', () => {
  for (const query of [
    null, undefined, [], 'query', new URLSearchParams(callback),
    { ...callback, vnp_Amount: ['23000000', '100'] },
    { ...callback, vnp_Amount: { value: '23000000' } },
    { ...callback, vnp_Amount: 23000000 }, { ...callback, arbitrary: 'value' },
    { ...callback, 'vnp_$where': 'payload' }, { ...callback, vnp_OrderInfo: 'a'.repeat(2049) },
    { ...callback, vnp_OrderInfo: 'order\u0000injection' },
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`vnp_Field${index}`, 'x'])),
  ]) assert.equal(verifyVnpayParameters(query, config), null);
  assert.ok(verifyVnpayParameters(Object.assign(Object.create(null), callback), config), 'Express may use a null-prototype query object');
});

test('VNPAY verification rejects malformed hashes and safely handles invalid Unicode', () => {
  for (const hash of ['', 'a'.repeat(127), 'a'.repeat(129), 'g'.repeat(128), '00', undefined]) {
    assert.equal(verifyVnpayParameters({ ...callback, vnp_SecureHash: hash }, config), null);
  }
  assert.equal(verifyVnpayParameters({ ...callback, vnp_OrderInfo: '\ud800' }, config), null);
  assert.equal(verifyVnpayParameters(callback, undefined), null);
});

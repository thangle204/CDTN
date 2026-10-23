import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createQueryDrRequest, verifyQueryDrResponse, queryVnpayTransaction } from '../utils/vnpayQuery.js';

// Synthetic protocol vectors only. Every transport is fake; no .env, database,
// real merchant credential, or gateway connection is used by these tests.
const config = Object.freeze({ tmnCode: 'TEST0001', hashSecret: 'querydr-unit-test-secret-never-live' });
const amount = 230000;
const txnRef = '0123456789abcdef01234567abcdef0123456789';
const originalDate = new Date('2026-10-22T18:15:35.000Z');
const now = new Date('2026-10-23T03:00:00.000Z');
const requestId = 'querydrtest202610230001';
const orderInfo = 'Tra cứu: A + B & 100%/giay (40)!';
const requestOptions = { config, txnRef, transactionDate: originalDate, ipAddress: '127.0.0.1', now, requestId, orderInfo };
const request = () => createQueryDrRequest(requestOptions);
const hash = data => createHmac('sha512', config.hashSecret).update(data, 'utf8').digest('hex');

// Keep the documented field sequence literal and independent of production
// constants. Optional values retain their positions as empty strings.
const signResponse = fields => ({
  ...fields,
  vnp_SecureHash: hash([
    fields.vnp_ResponseId ?? '', fields.vnp_Command ?? '', fields.vnp_ResponseCode ?? '',
    fields.vnp_Message ?? '', fields.vnp_TmnCode ?? '', fields.vnp_TxnRef ?? '',
    fields.vnp_Amount ?? '', fields.vnp_BankCode ?? '', fields.vnp_PayDate ?? '',
    fields.vnp_TransactionNo ?? '', fields.vnp_TransactionType ?? '',
    fields.vnp_TransactionStatus ?? '', fields.vnp_OrderInfo ?? '',
    fields.vnp_PromotionCode ?? '', fields.vnp_PromotionAmount ?? '',
  ].join('|')),
});
const responseFields = (patch = {}) => ({
  vnp_ResponseId: 'response202610230001', vnp_Command: 'querydr', vnp_ResponseCode: '00',
  vnp_Message: 'Success', vnp_TmnCode: config.tmnCode, vnp_TxnRef: txnRef,
  vnp_Amount: '23000000', vnp_BankCode: 'NCB', vnp_PayDate: '20261023011535',
  vnp_TransactionNo: '12345678', vnp_TransactionType: '01', vnp_TransactionStatus: '00',
  vnp_OrderInfo: orderInfo, vnp_PromotionCode: '', vnp_PromotionAmount: '', ...patch,
});
const responseBody = patch => signResponse(responseFields(patch));
const verify = body => verifyQueryDrResponse(body, { config, request: request(), amount });
const assertOutcome = (result, { verified, paid, status, reason }) => {
  assert.equal(result.verified, verified);
  assert.equal(result.paid, paid);
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
  const serialized = JSON.stringify(result);
  for (const forbidden of [config.hashSecret, 'vnp_SecureHash', 'vnp_Message']) {
    assert.equal(serialized.includes(forbidden), false, 'Results must not expose secrets or raw gateway data');
  }
  if (!paid) {
    for (const field of ['transactionNo', 'bankCode', 'payDate', 'amount']) {
      assert.equal(Object.hasOwn(result, field), false, 'Only a verified payment produces a receipt');
    }
  }
};

const fakeTransport = ({
  statusCode = 200, contentType = 'application/json', body = JSON.stringify(responseBody()),
  chunks, error, neverRespond = false,
} = {}) => {
  const calls = [];
  const transport = (options, callback) => {
    const outgoing = new EventEmitter();
    const call = { options, outgoing };
    calls.push(call);
    outgoing.destroyed = false;
    outgoing.destroy = failure => {
      if (outgoing.destroyed) return outgoing;
      outgoing.destroyed = true;
      if (failure) queueMicrotask(() => outgoing.emit('error', failure));
      queueMicrotask(() => outgoing.emit('close'));
      return outgoing;
    };
    outgoing.end = data => {
      call.body = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (neverRespond) return outgoing;
      queueMicrotask(() => {
        if (error) return outgoing.emit('error', error);
        const incoming = new EventEmitter();
        call.incoming = incoming;
        incoming.statusCode = statusCode;
        incoming.headers = contentType === undefined ? {} : { 'content-type': contentType };
        incoming.destroyed = false;
        incoming.destroy = () => { incoming.destroyed = true; return incoming; };
        incoming.resume = () => incoming;
        incoming.setEncoding = () => incoming;
        callback(incoming);
        queueMicrotask(() => {
          for (const chunk of chunks ?? [Buffer.from(body, 'utf8')]) {
            if (incoming.destroyed || outgoing.destroyed) break;
            incoming.emit('data', chunk);
          }
          if (!incoming.destroyed && !outgoing.destroyed) incoming.emit('end');
        });
      });
      return outgoing;
    };
    return outgoing;
  };
  return { transport, calls };
};
const perform = (fake, options = {}) => queryVnpayTransaction({ config, request: request(), amount, transport: fake.transport, ...options });
const header = (headers, name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

test('QueryDR signs the exact nine UTF-8 pipe fields and uses GMT+7 original/request dates', () => {
  const value = request();
  assert.deepEqual(value, {
    vnp_RequestId: requestId, vnp_Version: '2.1.0', vnp_Command: 'querydr',
    vnp_TmnCode: 'TEST0001', vnp_TxnRef: txnRef, vnp_TransactionDate: '20261023011535',
    vnp_CreateDate: '20261023100000', vnp_IpAddr: '127.0.0.1', vnp_OrderInfo: orderInfo,
    vnp_SecureHash: hash(`querydrtest202610230001|2.1.0|querydr|TEST0001|${txnRef}|20261023011535|20261023100000|127.0.0.1|Tra cứu: A + B & 100%/giay (40)!`),
  });
  assert.equal(Object.hasOwn(value, 'vnp_TransactionNo'), false);
  assert.deepEqual(createQueryDrRequest({ ...requestOptions, transactionDate: '20261023011535' }), value);
  assert.equal(createQueryDrRequest({ ...requestOptions, now: new Date('2026-12-31T20:01:02.000Z') }).vnp_CreateDate, '20270101030102');
});

test('QueryDR generates fresh bounded request IDs and rejects ambiguous or malformed request fields', () => {
  const { requestId: supplied, ...withoutId } = requestOptions;
  const first = createQueryDrRequest(withoutId);
  const second = createQueryDrRequest(withoutId);
  assert.match(first.vnp_RequestId, /^[a-zA-Z0-9]{1,32}$/);
  assert.notEqual(first.vnp_RequestId, second.vnp_RequestId);
  for (const patch of [
    { config: undefined }, { config: { ...config, tmnCode: 'BAD|CODE' } },
    { config: { ...config, hashSecret: '' } }, { txnRef: 'ref|injected' },
    { txnRef: 'ref\ninjected' }, { txnRef: '' }, { requestId: 'a'.repeat(33) },
    { requestId: 'id|injected' }, { ipAddress: '127.0.0.1|injected' },
    { ipAddress: 'localhost' }, { orderInfo: 'order\u0000injected' },
    { orderInfo: 'order|injected' }, { transactionDate: '2026-10-23' },
    { transactionDate: new Date('invalid') }, { now: new Date('invalid') },
  ]) {
    assert.throws(() => createQueryDrRequest({ ...requestOptions, ...patch }), error => {
      assert.ok(error instanceof TypeError);
      assert.equal(error.message.includes(config.hashSecret), false);
      assert.equal(error.message.includes('injected'), false);
      return true;
    });
  }
});

test('QueryDR verifies the independent fifteen-field response signature and returns a sanitized paid receipt', () => {
  const body = responseBody();
  const result = verify(body);
  assertOutcome(result, { verified: true, paid: true, status: 'paid', reason: 'PAID' });
  assert.equal(result.transactionNo, '12345678');
  assert.equal(result.bankCode, 'NCB');
  assert.equal(result.payDate, '20261023011535');
  assert.equal(result.amount, amount);
  assert.ok(body.vnp_SecureHash, 'Verification must not mutate gateway input');
});

test('QueryDR keeps empty optional response slots in the signature', () => {
  const fields = responseFields();
  for (const optional of ['vnp_Command', 'vnp_PayDate', 'vnp_PromotionCode', 'vnp_PromotionAmount']) delete fields[optional];
  const body = signResponse(fields);
  const explicitPipe = `response202610230001||00|Success|TEST0001|${txnRef}|23000000|NCB||12345678|01|00|Tra cứu: A + B & 100%/giay (40)!||`;
  assert.equal(body.vnp_SecureHash, hash(explicitPipe));
  const result = verify(body);
  assertOutcome(result, { verified: true, paid: true, status: 'paid', reason: 'PAID' });
  assert.equal(result.payDate, '');
  const collapsedHash = hash(explicitPipe.split('|').filter(Boolean).join('|'));
  assertOutcome(verify({ ...body, vnp_SecureHash: collapsedHash }), { verified: false, paid: false, status: 'unverified', reason: 'INVALID_SIGNATURE' });
});

test('QueryDR rejects tampered signatures and independently signed merchant/reference/amount mismatches', () => {
  const cases = [
    [{ ...responseBody(), vnp_SecureHash: '0'.repeat(128) }, 'INVALID_SIGNATURE'],
    [{ ...responseBody(), vnp_Amount: '23000100' }, 'INVALID_SIGNATURE'],
    [responseBody({ vnp_TmnCode: 'OTHER001' }), 'MISMATCHED_MERCHANT'],
    [responseBody({ vnp_TxnRef: 'abcdef0123456789abcdef010123456789abcdef' }), 'MISMATCHED_REFERENCE'],
    [responseBody({ vnp_Amount: '23000100' }), 'MISMATCHED_AMOUNT'],
  ];
  for (const [body, reason] of cases) {
    assertOutcome(verify(body), { verified: false, paid: false, status: 'unverified', reason });
  }
});

test('QueryDR rejects non-string fields, control characters, malformed critical fields and unknown data', () => {
  for (const body of [
    null, [], 'not an object',
    responseBody({ vnp_Amount: 23000000 }), responseBody({ vnp_TransactionStatus: 0 }),
    responseBody({ vnp_PromotionAmount: 0 }), responseBody({ vnp_TransactionNo: ['12345678'] }),
    responseBody({ vnp_Message: 'success\nforged' }), responseBody({ vnp_OrderInfo: 'order|injected' }),
    responseBody({ vnp_Amount: '23000001' }), responseBody({ vnp_TransactionNo: '' }),
    responseBody({ vnp_TransactionStatus: '0' }), responseBody({ vnp_PayDate: '2026-10-23' }),
    { ...responseBody(), unexpected: 'untrusted gateway metadata' },
  ]) {
    assertOutcome(verify(body), { verified: false, paid: false, status: 'unverified', reason: 'INVALID_RESPONSE' });
  }
});

test('a successful QueryDR lookup with unfinished payment status remains pending', () => {
  assertOutcome(verify(responseBody({ vnp_TransactionStatus: '01' })), {
    verified: true, paid: false, status: 'pending', reason: 'PAYMENT_PENDING',
  });
});

test('refund transaction types never produce a payment receipt even with status 00', () => {
  for (const vnp_TransactionType of ['02', '03']) {
    assertOutcome(verify(responseBody({ vnp_TransactionType })), {
      verified: true, paid: false, status: 'review', reason: 'NON_PAYMENT_TRANSACTION',
    });
  }
});

test('other transaction statuses and promotions require review without marking paid', () => {
  for (const vnp_TransactionStatus of ['02', '04', '05', '06', '07', '09']) {
    assertOutcome(verify(responseBody({ vnp_TransactionStatus })), {
      verified: true, paid: false, status: 'review', reason: 'PAYMENT_NOT_CONFIRMED',
    });
  }
  for (const patch of [{ vnp_PromotionCode: 'PROMO1' }, { vnp_PromotionAmount: '10000' }]) {
    assertOutcome(verify(responseBody(patch)), {
      verified: true, paid: false, status: 'review', reason: 'PROMOTION_REQUIRES_REVIEW',
    });
  }
  assertOutcome(verify(responseBody({ vnp_PromotionAmount: '0' })), { verified: true, paid: true, status: 'paid', reason: 'PAID' });
});

test('signed gateway errors remain verified errors while unsigned errors remain unverified', () => {
  assertOutcome(verify(responseBody({ vnp_ResponseCode: '94', vnp_Message: 'Duplicate request' })), {
    verified: true, paid: false, status: 'review', reason: 'GATEWAY_ERROR',
  });
  assertOutcome(verify({ vnp_ResponseCode: '91', vnp_Message: 'Synthetic private gateway failure' }), {
    verified: false, paid: false, status: 'unverified', reason: 'UNSIGNED_GATEWAY_ERROR',
  });
});

test('QueryDR client sends one JSON POST to the fixed sandbox host with TLS verification enabled', async () => {
  const fake = fakeTransport();
  const result = await perform(fake);
  assertOutcome(result, { verified: true, paid: true, status: 'paid', reason: 'PAID' });
  assert.equal(fake.calls.length, 1);
  const [{ options, body }] = fake.calls;
  assert.equal(options.hostname, 'sandbox.vnpayment.vn');
  assert.equal(Number(options.port), 443);
  assert.equal(options.path, '/merchant_webapi/api/transaction');
  assert.equal(options.method, 'POST');
  assert.equal(options.rejectUnauthorized, true);
  assert.match(header(options.headers, 'Content-Type'), /^application\/json(?:;|$)/i);
  assert.match(header(options.headers, 'Accept'), /application\/json/i);
  assert.equal(header(options.headers, 'User-Agent'), 'shoe-store-vnpay-sandbox/1.0');
  assert.equal(Number(header(options.headers, 'Content-Length')), Buffer.byteLength(body, 'utf8'));
  assert.deepEqual(JSON.parse(body), request());
  assert.equal(result.httpStatus, 200);
});

test('QueryDR client rejects HTML, malformed JSON and redirects without retrying', async () => {
  for (const [options, reason, httpStatus] of [
    [{ contentType: 'text/html', body: '<html>Gateway login</html>' }, 'NON_JSON_RESPONSE', 200],
    [{ body: '{broken json' }, 'INVALID_JSON', 200],
    [{ statusCode: 302, body: '{}' }, 'HTTP_STATUS', 302],
    [{ statusCode: 503, body: '{}' }, 'HTTP_STATUS', 503],
  ]) {
    const fake = fakeTransport(options);
    const result = await perform(fake);
    assertOutcome(result, { verified: false, paid: false, status: 'error', reason });
    assert.equal(result.httpStatus, httpStatus);
    assert.equal(fake.calls.length, 1);
  }
});

test('QueryDR client bounds response bytes while streaming and stops oversized data', async () => {
  const fake = fakeTransport({ chunks: [Buffer.alloc(40000, 'x'), Buffer.alloc(30000, 'x')] });
  const result = await perform(fake);
  assertOutcome(result, { verified: false, paid: false, status: 'error', reason: 'RESPONSE_TOO_LARGE' });
  assert.equal(result.httpStatus, 200);
  assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0].outgoing.destroyed || fake.calls[0].incoming.destroyed);
});

test('QueryDR client uses an absolute timeout and never retries a timed-out request', async () => {
  const fake = fakeTransport({ neverRespond: true });
  const result = await perform(fake, { timeoutMS: 20 });
  assertOutcome(result, { verified: false, paid: false, status: 'error', reason: 'TIMEOUT' });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].outgoing.destroyed, true);
});

test('QueryDR client sanitizes TLS and transport failures without retrying', async () => {
  for (const [code, reason] of [['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS_ERROR'], ['ECONNRESET', 'TRANSPORT_ERROR']]) {
    const failure = Object.assign(new Error(`Synthetic private error ${config.hashSecret}`), { code });
    const fake = fakeTransport({ error: failure });
    assertOutcome(await perform(fake), { verified: false, paid: false, status: 'error', reason });
    assert.equal(fake.calls.length, 1);
  }
});

test('QueryDR client rejects unsafe options before opening a connection', async () => {
  for (const patch of [
    { config: undefined }, { request: null }, { request: {} },
    { request: { ...request(), vnp_TmnCode: 'OTHER001' } },
    { request: { ...request(), vnp_SecureHash: '0'.repeat(128) } },
    { amount: '230000' }, { amount: 0 }, { timeoutMS: 0 }, { timeoutMS: Infinity },
    { maxResponseBytes: 0 }, { transport: {} },
  ]) {
    const fake = fakeTransport();
    await assert.rejects(async () => perform(fake, patch), error => {
      assert.ok(error instanceof TypeError);
      assert.equal(error.message.includes(config.hashSecret), false);
      return true;
    });
    assert.equal(fake.calls.length, 0);
  }
});

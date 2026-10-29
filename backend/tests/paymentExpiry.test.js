import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import { createPaymentExpirySweep, startPaymentExpiryWorker } from '../utils/paymentExpiry.js';

const now = new Date('2026-10-28T10:00:00Z');
const config = { tmnCode: 'TEST1234', hashSecret: 'expiry-test-secret-only-32-characters' };
const attempt = { txnRef: '111111111111111111111111aaaaaaaaaaaaaaaa', tmnCode: config.tmnCode,
  amount: 500000, state: 'pending', createdAt: new Date(now.getTime() - 30 * 60000), expiresAt: new Date(now.getTime() - 15 * 60000) };
let originalState;
before(() => { originalState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 }); });
after(() => { if (originalState) Object.defineProperty(mongoose.connection, 'readyState', originalState);else delete mongoose.connection.readyState; });
const setup = (t, options = {}) => {
  const order = { _id: '111111111111111111111111', user: '222222222222222222222222', __v: 0, checkoutState: 'committed', paymentMethod: 'VNPAY',
    isPaid: false, cancellationLock: null, orderStatus: 'Đang xử lý', paymentDeadline: now, totalPrice: attempt.amount,
    vnpayPayments: structuredClone(options.attempts ?? [attempt]) };
  const calls = { cancelled: [], queries: [], receipts: [], claims: [] };
  t.mock.method(Order, 'find', filter => {
    const values = filter.autoCancelledAt ? [] : [structuredClone(order)];
    if (!filter.autoCancelledAt) { assert.equal(filter.isPaid, false);assert.equal(filter.paymentMethod, 'VNPAY');assert(filter.paymentDeadline.$lte); }
    return { sort() { return this; }, limit: async () => values };
  });
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    calls.claims.push({ filter, update });
    if (options.claimLost || filter.__v !== order.__v) return null;
    Object.assign(order, update.$set);order.__v++;return structuredClone(order);
  });
  t.mock.method(Order, 'findById', async () => structuredClone(order));
  t.mock.method(Order, 'updateOne', async (filter, update) => { if (order.isPaid) return { matchedCount: 0 };Object.assign(order, update.$set);order.__v++;return { matchedCount: 1 }; });
  const run = createPaymentExpirySweep({ clock: options.clock || (() => now), configOf: () => config,
    query: async args => {
      calls.queries.push(args);if (options.duringQuery) await options.duringQuery(order);
      if (options.error) throw Error('network timeout');
      return options.result || { verified: true, paid: false, responseCode: '00', transactionType: '01', transactionStatus: '02' };
    },
    record: async (parameters, source) => { calls.receipts.push({ parameters, source });order.isPaid = true;order.__v++;return { code: '00' }; },
    cancel: async (id, user) => { calls.cancelled.push({ id, user });order.orderStatus = 'Đã hủy'; },
  });
  return { order, calls, run };
};

test('expired VNPAY orders cancel only after a verified payment failure with correct amount and merchant', async t => {
  const { order, calls, run } = setup(t);await run();
  assert.equal(calls.queries.length, 1);assert.equal(calls.queries[0].amount, order.totalPrice);
  assert.equal(calls.queries[0].request.vnp_TmnCode, config.tmnCode);
  assert.equal(calls.cancelled.length, 1);assert.equal(calls.cancelled[0].user.paymentExpiryVersion, 1);assert.equal(order.orderStatus, 'Đã hủy');
});

for (const [label, result] of [
  ['pending', { verified: true, responseCode: '00', transactionType: '01', transactionStatus: '01' }],
  ['reversal', { verified: true, responseCode: '00', transactionType: '01', transactionStatus: '04' }],
  ['refund', { verified: true, responseCode: '00', transactionType: '01', transactionStatus: '05' }],
  ['not found', { verified: true, responseCode: '91', transactionType: '01', transactionStatus: '02' }],
  ['bad signature', { verified: false, responseCode: '00', transactionType: '01', transactionStatus: '02' }],
  ['other transaction type', { verified: true, responseCode: '00', transactionType: '02', transactionStatus: '02' }],
  ['unverified paid result', { verified: false, paid: true, responseCode: '00', transactionType: '01', transactionStatus: '00' }],
]) test(`expiry keeps the order and voucher for review when query reports ${label}`, async t => {
  const { order, calls, run } = setup(t, { result });await run();
  assert.equal(calls.cancelled.length, 0);assert.equal(calls.receipts.length, 0);assert.equal(order.paymentExpiryReviewRequired, true);assert.equal(order.orderStatus, 'Đang xử lý');
});

test('network timeout keeps a five-minute cooldown and never restores inventory or voucher', async t => {
  const { order, calls, run } = setup(t, { error: true });await run();
  assert.equal(calls.cancelled.length, 0);assert.equal(order.paymentExpiryReviewRequired, true);
  assert.equal(new Date(order.vnpayQueryNextAt).getTime(), now.getTime() + 5 * 60000);
});

test('a verified successful query records a signed receipt instead of cancelling', async t => {
  const { order, calls, run } = setup(t, { result: { verified: true, paid: true, responseCode: '00', transactionType: '01', transactionStatus: '00', transactionNo: '123456', bankCode: 'NCB' } });
  await run();assert.equal(calls.cancelled.length, 0);assert.equal(calls.receipts.length, 1);assert.equal(calls.receipts[0].source, 'querydr');
  assert.equal(calls.receipts[0].parameters.vnp_Amount, '50000000');assert.equal(order.isPaid, true);
});

test('a payment arriving during the gateway query wins over automatic cancellation', async t => {
  const { order, calls, run } = setup(t, { duringQuery: record => { record.isPaid = true;record.__v++; } });await run();
  assert.equal(calls.cancelled.length, 0);assert.equal(order.isPaid, true);
});

test('a concurrent order edit makes a previous unpaid result stale and prevents cancellation', async t => {
  const { order, calls, run } = setup(t, { duringQuery: record => { record.__v++;record.orderStatus = 'Đã xác nhận'; } });await run();
  assert.equal(calls.cancelled.length, 0);assert.equal(order.paymentExpiryReviewRequired, true);
});

test('no attempt means no payment link was issued, so expiry cancels without querying', async t => {
  const { calls, run } = setup(t, { attempts: [] });await run();assert.equal(calls.queries.length, 0);assert.equal(calls.cancelled.length, 1);
});

test('every payment attempt must be settled; a pending second attempt prevents release', async t => {
  const { calls, run } = setup(t, { attempts: [attempt, { ...attempt, txnRef: '111111111111111111111111bbbbbbbbbbbbbbbb', expiresAt: new Date(now.getTime() + 1000) }] });
  await run();assert.equal(calls.queries.length, 1);assert.equal(calls.cancelled.length, 0);
});

test('a concurrent worker losing the atomic claim makes no gateway call', async t => {
  const { calls, run } = setup(t, { claimLost: true });await run();assert.equal(calls.queries.length, 0);assert.equal(calls.cancelled.length, 0);
});

test('claim cooldown uses a fresh clock rather than the beginning of a long sweep', async t => {
  let read = 0;const { calls, run } = setup(t, { clock: () => new Date(now.getTime() + read++ * 30000) });await run();
  assert.equal(new Date(calls.claims[0].update.$set.paymentExpiryNextAt).getTime(), now.getTime() + 330000);
});

test('the background worker never overlaps sweeps and stops scheduling on shutdown', async () => {
  let started = 0, finish;const pending = new Promise(resolve => { finish = resolve; });
  const worker = startPaymentExpiryWorker({ intervalMS: 5, sweep: async () => { started++;await pending; } });
  await new Promise(resolve => setTimeout(resolve, 22));assert.equal(started, 1);worker.stop();finish();
  await new Promise(resolve => setTimeout(resolve, 12));assert.equal(started, 1);
});

test('automatic cancellation recovery retries the durable claim even if recording its diagnostic flag failed', async t => {
  const order = { _id: '111111111111111111111111', user: '222222222222222222222222', cancellationLock: 'durable', autoCancelledAt: now, stockRestored: false };
  let resumed = 0;
  t.mock.method(Order, 'find', filter => ({ sort() { return this; }, limit: async () => {
    if (filter.autoCancelledAt) { assert.equal(filter.cancellationRecoveryRequired, undefined);assert.equal(filter.cancellationLock.$type, 'string');return [order]; }
    return [];
  } }));
  await createPaymentExpirySweep({ clock: () => now, cancel: async (id, user) => { assert.equal(id, order._id);assert.equal(user.isAdmin, true);resumed++; } })();
  assert.equal(resumed, 1);
});

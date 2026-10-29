import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { addOrderItems, confirmOrderRefund, deleteOrder, updatePaymentStatus } from '../controllers/orderController.js';
import { validateOrderTransition } from '../utils/orderPricing.js';
import { createVnpayPayment, createReconcileVnpayPayment, vnpayIpn, vnpayReturn } from '../controllers/vnpayController.js';
import { createApp } from '../app.js';

const id = () => String(new mongoose.Types.ObjectId());
const clone = value => JSON.parse(JSON.stringify(value));
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const valueAt = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const scalar = value => value instanceof Date ? value.getTime() : value instanceof mongoose.Types.ObjectId ? String(value) : value;
const equal = (actual, expected) => expected === null ? actual == null : scalar(actual) === scalar(expected);
const matchesValue = (actual, expected) => {
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof mongoose.Types.ObjectId) && !Array.isArray(expected)) {
    return Object.entries(expected).every(([operator, operand]) => {
      if (operator === '$ne') return !equal(actual, operand);
      if (operator === '$eq') return equal(actual, operand);
      if (operator === '$exists') return (actual !== undefined) === operand;
      if (operator === '$in') return operand.some(value => equal(actual, value));
      if (operator === '$nin') return !operand.some(value => equal(actual, value));
      if (operator === '$gt') return (operand instanceof Date ? new Date(actual).getTime() : actual) > scalar(operand);
      if (operator === '$gte') return (operand instanceof Date ? new Date(actual).getTime() : actual) >= scalar(operand);
      if (operator === '$lt') return (operand instanceof Date ? new Date(actual).getTime() : actual) < scalar(operand);
      if (operator === '$lte') return (operand instanceof Date ? new Date(actual).getTime() : actual) <= scalar(operand);
      if (operator === '$size') return Array.isArray(actual) && actual.length === operand;
      if (operator === '$elemMatch') return Array.isArray(actual) && actual.some(row => matches(row, operand));
      if (operator === '$not') return !matchesValue(actual, operand);
      throw new Error(`Unhandled payment-test condition ${operator}`);
    });
  }
  return equal(actual, expected);
};
const matches = (object, filter) => Object.entries(filter).every(([path, expected]) => {
  if (path === '$or') return expected.some(branch => matches(object, branch));
  if (path === '$and') return expected.every(branch => matches(object, branch));
  const keys = path.split('.');
  if (Array.isArray(object[keys[0]]) && keys.length > 1) {
    return object[keys[0]].some(row => matchesValue(valueAt(row, keys.slice(1).join('.')), expected));
  }
  return matchesValue(valueAt(object, path), expected);
});
const set = (object, path, value, filter, options) => {
  const keys = path.split('.');
  const finalKey = keys.pop();
  let target = object;
  for (const key of keys) {
    if (key === '$') {
      const arrayName = path.split('.')[0];
      const match = filter[arrayName]?.$elemMatch || Object.fromEntries(Object.entries(filter)
        .filter(([name]) => name.startsWith(`${arrayName}.`)).map(([name, expected]) => [name.slice(arrayName.length + 1), expected]));
      target = target.find(row => matches(row, match));
      assert.ok(target, 'A positional payment write must select an existing attempt');
    } else if (key.startsWith('$[')) {
      const alias = key.slice(2, -1);
      const constraints = Object.assign({}, ...(options.arrayFilters || []).map(branch => Object.fromEntries(Object.entries(branch)
        .filter(([name]) => name.startsWith(`${alias}.`)).map(([name, expected]) => [name.slice(alias.length + 1), expected]))));
      target = target.find(row => matches(row, constraints));
      assert.ok(target, 'An array-filtered payment write must select an existing attempt');
    } else target = target[key] ||= {};
  }
  target[finalKey] = value === undefined ? undefined : clone(value);
};
const apply = (object, update, filter, options = {}) => {
  for (const [path, value] of Object.entries(update.$set || {})) set(object, path, value, filter, options);
  for (const [path, value] of Object.entries(update.$inc || {})) set(object, path, (valueAt(object, path) || 0) + value, filter, options);
  for (const [path, value] of Object.entries(update.$push || {})) {
    object[path] ||= [];
    object[path].push(...clone(value.$each || [value]));
  }
  for (const path of Object.keys(update.$unset || {})) {
    const keys = path.split('.');
    const finalKey = keys.pop();
    delete keys.reduce((target, key) => target?.[key], object)?.[finalKey];
  }
};
const queryOf = value => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ['select', 'lean', 'populate']) query[method] = () => query;
  return query;
};

const fakeConfig = {
  VNPAY_ENABLED: 'true', VNPAY_TMN_CODE: 'TESTCODE', VNPAY_HASH_SECRET: 'payment-test-secret-never-a-merchant-key',
  VNPAY_RETURN_URL: 'http://localhost:5173/payment/vnpay/return',
  VNPAY_IPN_URL: 'https://merchant.example.test/api/payments/vnpay/ipn', VNPAY_BANK_CODE: '', VNPAY_TIMEOUT_MINUTES: '15',
};
const setup = (t, overrides = {}) => {
  const previous = Object.fromEntries(Object.keys(fakeConfig).map(key => [key, process.env[key]]));
  Object.assign(process.env, fakeConfig);
  const readyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  let databaseState = 1;
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => databaseState });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    if (readyState) Object.defineProperty(mongoose.connection, 'readyState', readyState);
    else delete mongoose.connection.readyState;
  });
  const owner = id();
  let store = clone(new Order({
    _id: id(), __v: 0, user: owner, checkoutState: 'committed', paymentMethod: 'VNPAY',
    orderStatus: 'Đang xử lý', isPaid: false, cancellationLock: null, stockRestored: false,
    orderItems: [{ product: id(), name: 'Giày trắng', image: '/shoe.jpg', price: 200000, quantity: 2, size: 40, color: 'Trắng', inventoryVariant: true }],
    shippingAddress: { name: 'Khách hàng', phone: '0901234567', address: '10 Nguyễn Huệ', city: 'TP. Hồ Chí Minh' },
    itemsPrice: 400000, shippingPrice: 30000, discountAmount: 10000, totalPrice: 420000,
    ...overrides,
  }).toObject());
  const writes = [];
  let beforeWrite;
  const snapshot = () => store ? new Order(clone(store)) : null;
  const read = t.mock.method(Order, 'findById', value => queryOf(store && String(value) === String(store._id) ? snapshot() : null));
  t.mock.method(Order, 'findOne', filter => queryOf(store && matches(store, filter) ? snapshot() : null));
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update, options = {}) => {
    if (beforeWrite) { const run = beforeWrite; beforeWrite = undefined; await run(); }
    const matched = Boolean(store && matches(store, filter));
    writes.push({ filter, update, matched });
    if (!matched) return null;
    apply(store, update, filter, options);
    return snapshot();
  });
  t.mock.method(Order, 'updateOne', async (filter, update, options = {}) => {
    const matched = Boolean(store && matches(store, filter));
    writes.push({ filter, update, matched });
    if (!matched) return { matchedCount: 0, modifiedCount: 0 };
    apply(store, update, filter, options);
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const remove = t.mock.method(Order, 'deleteOne', async () => { throw new Error('Payment records must not be deleted'); });
  const stock = t.mock.method(Product, 'updateOne', async () => { throw new Error('Gateway notifications must not change inventory'); });
  const voucher = t.mock.method(Voucher, 'updateOne', async () => { throw new Error('Gateway notifications must not release vouchers'); });
  const request = (body = {}) => ({ params: { id: store._id }, user: { _id: owner, isAdmin: false }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, body });
  return {
    current: () => store, replace(value) { store = value; }, writes, read, remove, stock, voucher, request,
    databaseState(value) { databaseState = value; },
    beforeWrite(callback) { beforeWrite = callback; },
    async create(body) { const res = response(); await createVnpayPayment(request(body), res); return res; },
    async ipn(query) { const res = response(); await vnpayIpn({ query }, res); return res; },
    async returned(query) { const res = response(); await vnpayReturn({ query }, res); return res; },
  };
};

// Sign independently from the production helper so a shared canonicalization bug
// cannot make forged or wrongly encoded notifications appear valid in the tests.
const signed = (parameters) => {
  const encoded = Object.keys(parameters).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(parameters[key]).replace(/%20/g, '+')}`).join('&');
  return { ...parameters, vnp_SecureHash: createHmac('sha512', fakeConfig.VNPAY_HASH_SECRET).update(encoded).digest('hex') };
};
const notification = (state, overrides = {}) => signed({
  vnp_TmnCode: fakeConfig.VNPAY_TMN_CODE, vnp_TxnRef: state.current().vnpayPayments.at(-1).txnRef,
  vnp_Amount: String(state.current().totalPrice * 100), vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
  vnp_TransactionNo: '142536789', vnp_BankCode: 'NCB', vnp_PayDate: '20261022143000', ...overrides,
});

test('VNPAY creation fails closed when merchant configuration is unavailable', async t => {
  const state = setup(t);
  process.env.VNPAY_ENABLED = 'false';
  const result = await state.create();
  assert.equal(result.statusCode, 503);
  assert.equal(state.writes.length, 0);
  assert.equal(state.current().isPaid, false);
});

test('expired order payment deadlines prevent opening or renewing VNPAY links', async t => {
  const state = setup(t, { paymentDeadline: new Date(Date.now() - 1000) });
  const result = await state.create();assert.equal(result.statusCode, 409);
  assert.equal(state.writes.length, 0);assert.equal(state.current().vnpayPayments, undefined);
});

test('a new VNPAY link cannot outlive the order remaining thirty-minute payment window', async t => {
  const deadline = new Date(Date.now() + 120000), state = setup(t, { paymentDeadline: deadline });
  const result = await state.create();assert.equal(result.statusCode, 200);
  assert.equal(new Date(state.current().vnpayPayments[0].expiresAt).toISOString(), deadline.toISOString());
});

test('disabled VNPAY checkout fails before claiming the customer cart or touching inventory', async t => {
  const state = setup(t);
  process.env.VNPAY_ENABLED = 'false';
  const customer = t.mock.method(Customer, 'findOneAndUpdate', async () => { throw new Error('Disabled checkout must not claim a cart'); });
  const products = t.mock.method(Product, 'find', async () => { throw new Error('Disabled checkout must not read inventory'); });
  const reserve = t.mock.method(Product, 'findOneAndUpdate', async () => { throw new Error('Disabled checkout must not reserve inventory'); });
  const result = response();
  await addOrderItems(state.request({ paymentMethod: 'VNPAY' }), result);
  assert.equal(result.statusCode, 503);
  assert.equal(customer.mock.callCount(), 0);
  assert.equal(products.mock.callCount(), 0);
  assert.equal(reserve.mock.callCount(), 0);
  assert.equal(state.stock.mock.callCount(), 0);
  assert.equal(state.writes.length, 0);
});

test('payment creation rejects totals below 5,000 before writing an attempt and accepts 5,000', async t => {
  const state = setup(t, { totalPrice: 4999 });
  assert.equal((await state.create()).statusCode, 400);
  assert.equal(state.writes.length, 0);
  assert.equal((state.current().vnpayPayments || []).length, 0);
  state.current().totalPrice = 5000;
  const result = await state.create();
  assert.equal(result.statusCode, 200);
  assert.equal(new URL(result.body.paymentUrl).searchParams.get('vnp_Amount'), '500000');
  assert.equal(state.current().vnpayPayments.length, 1);
  assert.equal(state.current().vnpayPayments[0].amount, 5000);
});

test('only the owner can pay a committed, unpaid and available VNPAY order', async t => {
  const state = setup(t);
  const outsider = response();
  await createVnpayPayment({ ...state.request(), user: { _id: id(), isAdmin: true } }, outsider);
  assert.equal(outsider.statusCode, 403);
  const initial = clone(state.current());
  for (const [change, status] of [
    [{ checkoutState: 'pending', checkoutToken: 'checkout-pending' }, 409],
    [{ isPaid: true }, 409], [{ paymentMethod: 'BANK' }, 409],
    [{ orderStatus: 'Đã hủy' }, 409], [{ orderStatus: 'Đang giao' }, 409],
    [{ cancellationLock: 'cancelling-now' }, 409],
    [{ deliveryReturn: { state: 'processing' } }, 409],
  ]) {
    state.replace({ ...clone(initial), ...change });
    assert.equal((await state.create()).statusCode, status);
  }
  assert.equal(state.writes.length, 0);
});

test('payment URL uses the persisted total and configured merchant URL, ignoring browser pricing', async t => {
  const state = setup(t);
  const result = await state.create({ amount: 1, totalPrice: 1, returnUrl: 'https://attacker.example/', vnp_TmnCode: 'BADCODE1' });
  assert.equal(result.statusCode, 200);
  const url = new URL(result.body.paymentUrl);
  assert.equal(url.origin, 'https://sandbox.vnpayment.vn');
  assert.equal(url.searchParams.get('vnp_Amount'), '42000000');
  assert.equal(url.searchParams.get('vnp_ReturnUrl'), fakeConfig.VNPAY_RETURN_URL);
  assert.equal(url.searchParams.get('vnp_TmnCode'), fakeConfig.VNPAY_TMN_CODE);
  const parameters = Object.fromEntries(url.searchParams);
  const hash = parameters.vnp_SecureHash;
  delete parameters.vnp_SecureHash;
  assert.equal(hash, signed(parameters).vnp_SecureHash);
  assert.equal(state.current().vnpayPayments.length, 1);
  assert.equal(state.current().vnpayPayments[0].amount, 420000);
  assert.equal(state.current().isPaid, false);
});

test('active attempt is reused and concurrent payment creation cannot create two pending attempts', async t => {
  const state = setup(t);
  const results = await Promise.all([state.create(), state.create()]);
  assert.ok(results.every(result => [200, 409].includes(result.statusCode)));
  assert.equal(state.current().vnpayPayments.length, 1);
  assert.equal(state.current().vnpayPayments.filter(row => row.state === 'pending').length, 1);
  const ref = state.current().vnpayPayments[0].txnRef;
  const expiry = state.current().vnpayPayments[0].expiresAt;
  const appliedWrites = state.writes.filter(write => write.matched).length;
  const retry = await state.create();
  assert.equal(retry.statusCode, 200);
  assert.equal(new URL(retry.body.paymentUrl).searchParams.get('vnp_TxnRef'), ref);
  assert.equal(state.current().vnpayPayments[0].expiresAt, expiry);
  assert.equal(state.writes.filter(write => write.matched).length, appliedWrites);
});

test('invalid signatures and signed amount mismatches never update payment records', async t => {
  const state = setup(t);
  await state.create();
  const writes = state.writes.length;
  const forged = { ...notification(state), vnp_SecureHash: '0'.repeat(128) };
  assert.equal((await state.ipn(forged)).body.RspCode, '97');
  assert.equal((await state.ipn(notification(state, { vnp_Amount: '100' }))).body.RspCode, '04');
  assert.equal((await state.ipn(notification(state, { vnp_TmnCode: 'OTHER001' }))).body.RspCode, '97');
  assert.equal(state.writes.length, writes);
  assert.equal(state.current().isPaid, false);
  assert.equal(state.current().vnpayPayments[0].state, 'pending');
});

test('successful signed IPN records payment once and duplicate notification receives 02', async t => {
  const state = setup(t);
  await state.create();
  const query = notification(state);
  const first = await state.ipn(query);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.RspCode, '00');
  assert.equal(state.current().isPaid, true);
  assert.ok(state.current().paidAt);
  assert.equal(state.current().vnpayPayments[0].state, 'succeeded');
  assert.equal(state.current().vnpayPayments[0].transactionNo, query.vnp_TransactionNo);
  const written = clone(state.current());
  const writes = state.writes.length;
  assert.equal((await state.ipn(query)).body.RspCode, '02');
  assert.deepEqual(state.current(), written);
  assert.equal(state.writes.length, writes);
  assert.equal(state.stock.mock.callCount(), 0);
  assert.equal(state.voucher.mock.callCount(), 0);
});

test('both gateway response and transaction status must indicate success before marking paid', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  for (const failure of [{ vnp_ResponseCode: '24' }, { vnp_TransactionStatus: '02' }]) {
    state.replace(clone(initial));
    const query = notification(state, failure);
    assert.equal((await state.ipn(query)).body.RspCode, '00');
    assert.equal(state.current().isPaid, false);
    assert.equal(state.current().paidAt, undefined);
    assert.equal(state.current().vnpayPayments[0].state, 'failed');
    assert.equal((await state.ipn(query)).body.RspCode, '02');
  }
});

test('unknown order or attempt is rejected without writes', async t => {
  const state = setup(t);
  await state.create();
  const count = state.writes.length;
  assert.equal((await state.ipn(notification(state, { vnp_TxnRef: `${id()}${'a'.repeat(16)}` }))).body.RspCode, '01');
  assert.equal((await state.ipn(notification(state, { vnp_TxnRef: `${state.current()._id}${'b'.repeat(16)}` }))).body.RspCode, '01');
  assert.equal(state.writes.length, count);
});

test('late successful IPN on a cancelled order requires refund without reopening or restocking', async t => {
  const state = setup(t);
  await state.create();
  const query = notification(state);
  Object.assign(state.current(), { orderStatus: 'Đã hủy', stockRestored: true, voucherReleased: true, refundStatus: 'not_required', __v: state.current().__v + 1 });
  const result = await state.ipn(query);
  assert.equal(result.body.RspCode, '00');
  assert.equal(state.current().orderStatus, 'Đã hủy');
  assert.equal(state.current().isPaid, true);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.current().stockRestored, true);
  assert.equal(state.current().voucherReleased, true);
  assert.equal(state.stock.mock.callCount(), 0);
  assert.equal(state.voucher.mock.callCount(), 0);
});

test('IPN retries while cancellation owns the order and succeeds once cancellation finishes', async t => {
  const state = setup(t);
  await state.create();
  const query = notification(state);
  state.current().cancellationLock = 'cancellation-in-progress';
  const count = state.writes.length;
  assert.equal((await state.ipn(query)).body.RspCode, '99');
  assert.equal(state.writes.length, count);
  assert.equal(state.current().isPaid, false);
  Object.assign(state.current(), { cancellationLock: null, orderStatus: 'Đã hủy', stockRestored: true });
  assert.equal((await state.ipn(query)).body.RspCode, '00');
  assert.equal(state.current().refundStatus, 'pending');
});

test('cancellation claimed between IPN read and payment write prevents the stale update', async t => {
  const state = setup(t);
  await state.create();
  state.beforeWrite(() => { Object.assign(state.current(), { cancellationLock: 'claim-after-read', orderStatus: 'Đã hủy', __v: state.current().__v + 1 }); });
  assert.equal((await state.ipn(notification(state))).body.RspCode, '99');
  assert.equal(state.current().isPaid, false);
  assert.equal(state.current().vnpayPayments[0].state, 'pending');
});

test('a second completed gateway attempt is retained and flagged for payment review', async t => {
  const state = setup(t);
  await state.create();
  const firstRef = state.current().vnpayPayments[0].txnRef;
  state.current().vnpayPayments[0].expiresAt = new Date(Date.now() - 60000).toISOString();
  assert.equal((await state.create()).statusCode, 200);
  assert.equal(state.current().vnpayPayments.length, 2);
  const first = notification(state, { vnp_TxnRef: firstRef, vnp_TransactionNo: '111111111' });
  const second = notification(state, { vnp_TransactionNo: '222222222' });
  assert.equal((await state.ipn(first)).body.RspCode, '00');
  const paidAt = state.current().paidAt;
  assert.equal((await state.ipn(second)).body.RspCode, '00');
  assert.equal(state.current().isPaid, true);
  assert.equal(state.current().paidAt, paidAt);
  assert.equal(state.current().paymentReviewRequired, true);
  assert.equal(state.current().vnpayPayments[0].state, 'succeeded');
  assert.equal(state.current().vnpayPayments[1].state, 'succeeded');
  assert.equal(state.current().vnpayPayments[1].overpayment, true);
  const count = state.writes.length;
  assert.equal((await state.ipn(second)).body.RspCode, '02');
  assert.equal(state.writes.length, count);
});

test('overpayment on an already refunded cancelled order reopens the refund and requires review', async t => {
  const state = setup(t);
  await state.create();
  const firstRef = state.current().vnpayPayments[0].txnRef;
  state.current().vnpayPayments[0].expiresAt = new Date(Date.now() - 60000).toISOString();
  assert.equal((await state.create()).statusCode, 200);
  assert.equal((await state.ipn(notification(state, { vnp_TxnRef: firstRef, vnp_TransactionNo: '111111111' }))).body.RspCode, '00');
  const paidAt = state.current().paidAt;
  Object.assign(state.current(), {
    orderStatus: 'Đã hủy', stockRestored: true, refundStatus: 'refunded',
    refundedAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal((await state.ipn(notification(state, { vnp_TransactionNo: '222222222' }))).body.RspCode, '00');
  assert.equal(state.current().orderStatus, 'Đã hủy');
  assert.equal(state.current().stockRestored, true);
  assert.equal(state.current().paidAt, paidAt);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.current().refundedAt, null);
  assert.equal(state.current().paymentReviewRequired, true);
  assert.equal(state.current().vnpayPayments[1].overpayment, true);
  assert.equal(state.stock.mock.callCount(), 0);
  assert.equal(state.voucher.mock.callCount(), 0);
});

test('admin cannot confirm a refund while an overpayment requires review', async t => {
  const state = setup(t, {
    orderStatus: 'Đã hủy', stockRestored: true, isPaid: true,
    refundStatus: 'pending', refundedAt: null, paymentReviewRequired: true,
  });
  const result = response();
  await confirmOrderRefund({ ...state.request(), user: { _id: id(), isAdmin: true } }, result);
  assert.equal(result.statusCode, 409);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.current().refundedAt, null);
  assert.equal(state.writes.length, 0);
});

test('an overpayment IPN after the admin read prevents stale refund confirmation', async t => {
  const state = setup(t);
  await state.create();
  Object.assign(state.current(), {
    orderStatus: 'Đã hủy', stockRestored: true, isPaid: true,
    paidAt: new Date(Date.now() - 1000).toISOString(),
    refundStatus: 'pending', refundedAt: null, paymentReviewRequired: false,
  });
  const query = notification(state);
  state.beforeWrite(async () => {
    assert.equal(state.current().paymentReviewRequired, false);
    assert.equal((await state.ipn(query)).body.RspCode, '00');
    assert.equal(state.current().paymentReviewRequired, true);
  });
  const result = response();
  await confirmOrderRefund({ ...state.request(), user: { _id: id(), isAdmin: true } }, result);
  assert.equal(result.statusCode, 409);
  assert.equal(state.current().paymentReviewRequired, true);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.current().refundedAt, null);
  assert.equal(state.current().vnpayPayments[0].state, 'succeeded');
  assert.equal(state.current().vnpayPayments[0].overpayment, true);
  assert.equal(state.writes.at(-1).matched, false);
  assert.equal(state.writes.at(-1).update.$set.refundStatus, 'refunded');
});

test('browser return validates signed transaction but never writes or marks the order paid', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  const count = state.writes.length;
  const returned = await state.returned(notification(state));
  assert.equal(returned.statusCode, 200);
  assert.equal(returned.body.status, 'pending');
  assert.equal(returned.body.orderId, state.current()._id);
  assert.deepEqual(Object.keys(returned.body).sort(), ['message', 'orderId', 'responseCode', 'status']);
  assert.deepEqual(state.current(), initial);
  assert.equal(state.writes.length, count);
  assert.equal((await state.returned({ ...notification(state), vnp_Amount: '100' })).statusCode, 400);
  assert.equal((await state.returned(notification(state, { vnp_Amount: '100' }))).statusCode, 400);
  assert.equal((await state.returned(notification(state, { vnp_ResponseCode: '24' }))).body.status, 'failed');
  assert.deepEqual(state.current(), initial);
  assert.equal(state.writes.length, count);
  await state.ipn(notification(state));
  const countAfterIpn = state.writes.length;
  assert.equal((await state.returned(notification(state))).body.status, 'paid');
  assert.equal(state.writes.length, countAfterIpn);
});

test('offline IPN requests gateway retry while browser return shows pending without writes', async t => {
  const state = setup(t);
  await state.create();
  const query = notification(state);
  const count = state.writes.length;
  state.databaseState(0);
  assert.equal((await state.ipn(query)).body.RspCode, '99');
  const returned = await state.returned(query);
  assert.equal(returned.statusCode, 503);
  assert.equal(returned.body.status, 'pending');
  assert.equal(state.writes.length, count);
  assert.equal(state.current().isPaid, false);
});

test('public gateway callback routes accept signed IPN without a customer session', async t => {
  const state = setup(t);
  await state.create();
  const server = createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const parameters = new URLSearchParams(notification(state));
  const ipn = await fetch(`${base}/api/payments/vnpay/ipn?${parameters}`);
  assert.equal(ipn.status, 200);
  assert.equal((await ipn.json()).RspCode, '00');
  assert.equal(state.current().isPaid, true);
  const returned = await fetch(`${base}/api/payments/vnpay/return?${parameters}`);
  assert.equal(returned.status, 200);
  assert.equal((await returned.json()).status, 'paid');
  const invalid = await fetch(`${base}/api/payments/vnpay/ipn?vnp_TxnRef=forged`);
  assert.equal(invalid.status, 200);
  assert.equal((await invalid.json()).RspCode, '97');
});

test('admin cannot manually toggle VNPAY payments or delete their gateway history', async t => {
  const state = setup(t);
  await state.create();
  const count = state.writes.length;
  const admin = { ...state.request(), user: { _id: id(), isAdmin: true }, body: { isPaid: true } };
  const paid = response();
  await updatePaymentStatus(admin, paid);
  assert.equal(paid.statusCode, 400);
  Object.assign(state.current(), { orderStatus: 'Đã hủy', stockRestored: true, isPaid: true, refundStatus: 'refunded' });
  const deleted = response();
  await deleteOrder(admin, deleted);
  assert.equal(deleted.statusCode, 400);
  assert.equal(state.remove.mock.callCount(), 0);
  assert.equal(state.writes.length, count);
});

test('unpaid VNPAY orders cannot ship or be closed as delivered', () => {
  assert.throws(() => validateOrderTransition({ paymentMethod: 'VNPAY', isPaid: false, orderStatus: 'Đã xác nhận' }, 'Đang giao'), error => error.status === 400);
  assert.throws(() => validateOrderTransition({ paymentMethod: 'VNPAY', isPaid: false, orderStatus: 'Đang giao' }, 'Đã giao'), error => error.status === 400);
  assert.doesNotThrow(() => validateOrderTransition({ paymentMethod: 'VNPAY', isPaid: true, orderStatus: 'Đã xác nhận' }, 'Đang giao'));
});

const paidQueryResult = () => ({ verified: true, paid: true, status: 'paid',
  responseCode: '00', transactionStatus: '00', transactionType: '01',
  transactionNo: '142536789', bankCode: 'NCB', payDate: '20261022143000' });
const reconcile = async (state, query, overrides = {}) => {
  const result = response();
  await createReconcileVnpayPayment({ query })({ ...state.request(), ...overrides }, result);
  return result;
};

test('QueryDR authorizes the owner or admin before reserving or contacting the gateway', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  const query = t.mock.fn(async () => paidQueryResult());
  for (const extra of [{ user: { _id: id() } }, { accountType: 'staff', user: { _id: state.current().user } }]) {
    assert.equal((await reconcile(state, query, extra)).statusCode, 403);
    assert.deepEqual(state.current(), initial);
  }
  assert.equal(query.mock.callCount(), 0);
  const result = await reconcile(state, query, { user: { _id: id(), isAdmin: true }, accountType: 'staff' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.order.isPaid, true);
  assert.equal(state.current().vnpayPayments[0].verificationSource, 'querydr');
});

test('QueryDR rejects injected pricing, status, invalid references and unavailable orders without contacting VNPAY', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  const query = t.mock.fn(async () => paidQueryResult());
  for (const body of [{ isPaid: true }, { amount: 1 }, { txnRef: [state.current().vnpayPayments[0].txnRef] }, { txnRef: {} }, []]) {
    assert.equal((await reconcile(state, query, { body })).statusCode, 400);
  }
  for (const patch of [{ paymentMethod: 'COD' }, { checkoutState: 'pending' }, { cancellationLock: 'cancelling' }, { deliveryReturn: { state: 'processing' } }]) {
    state.replace({ ...clone(initial), ...patch });
    assert.equal((await reconcile(state, query)).statusCode, 409);
  }
  assert.equal(query.mock.callCount(), 0);
});

test('QueryDR uses only the persisted reference/date/amount and hides internal metadata in its response', async t => {
  const state = setup(t);
  await state.create();
  const saved = clone(state.current().vnpayPayments[0]);
  process.env.VNPAY_ENABLED = 'false'; // Existing receipts remain recoverable.
  const query = t.mock.fn(async ({ request, amount }) => {
    assert.equal(request.vnp_TxnRef, saved.txnRef);
    assert.equal(amount, state.current().totalPrice);
    assert.ok(state.current().vnpayQueryNextAt, 'Reserve the durable cooldown before network I/O');
    assert.equal(state.current().isPaid, false);
    return paidQueryResult();
  });
  const result = await reconcile(state, query);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.order.isPaid, true);
  assert.equal(result.body.order.vnpayPayments, undefined);
  assert.equal(result.body.order.vnpayQueryNextAt, undefined);
  assert.equal(result.body.order.cancellationLock, undefined);
  assert.equal(state.stock.mock.callCount(), 0);
  assert.equal(state.voucher.mock.callCount(), 0);
  const repeat = await state.ipn(notification(state));
  assert.equal(repeat.body.RspCode, '02', 'A later real IPN is idempotent after QueryDR');
});

test('verified pending, refund or query failure results never publish a payment receipt', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  for (const status of ['pending', 'review', 'error']) {
    state.replace(clone(initial));
    const result = await reconcile(state, async () => ({ verified: true, paid: false, status }));
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.order.isPaid, false);
    assert.equal(state.current().vnpayPayments[0].state, 'pending');
    assert.ok(state.current().vnpayQueryNextAt);
  }
});

test('unverified or unavailable QueryDR retains the cooldown and never changes payment state', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  for (const query of [async () => ({ verified: false, paid: false }), async () => { throw new Error('private transport details'); }]) {
    state.replace(clone(initial));
    const result = await reconcile(state, query);
    assert.equal(result.statusCode, 502);
    assert.equal(state.current().isPaid, false);
    assert.equal(state.current().vnpayPayments[0].state, 'pending');
    assert.ok(result.body.nextQueryAt);
    assert.equal(JSON.stringify(result.body).includes('private transport details'), false);
    const again = t.mock.fn(async () => paidQueryResult());
    assert.equal((await reconcile(state, again)).statusCode, 429);
    assert.equal(again.mock.callCount(), 0);
  }
});

test('two overlapping QueryDR calls contact the gateway once and remain idempotent with concurrent IPN', async t => {
  const state = setup(t);
  await state.create();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let started;
  const called = new Promise(resolve => { started = resolve; });
  const query = t.mock.fn(async () => { started(); await wait; return paidQueryResult(); });
  const first = reconcile(state, query);
  await called;
  assert.equal((await reconcile(state, query)).statusCode, 429);
  assert.equal((await state.ipn(notification(state))).body.RspCode, '00');
  release();
  assert.equal((await first).body.order.isPaid, true);
  assert.equal(query.mock.callCount(), 1);
  assert.equal(state.current().paymentReviewRequired, false);
  assert.equal(Boolean(state.current().vnpayPayments[0].overpayment), false);
});

test('cancellation completing during QueryDR requires a refund without reopening or restocking', async t => {
  const state = setup(t);
  await state.create();
  const result = await reconcile(state, async () => {
    Object.assign(state.current(), { orderStatus: 'Đã hủy', stockRestored: true, refundStatus: 'not_required' });
    state.current().__v += 1;
    return paidQueryResult();
  });
  assert.equal(result.statusCode, 200);
  assert.equal(state.current().isPaid, true);
  assert.equal(state.current().orderStatus, 'Đã hủy');
  assert.equal(state.current().stockRestored, true);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.stock.mock.callCount(), 0);
});

test('QueryDR blocked by an in-progress cancellation cannot bypass its lock', async t => {
  const state = setup(t);
  await state.create();
  const result = await reconcile(state, async () => {
    state.current().cancellationLock = 'cancel-in-progress';
    state.current().__v += 1;
    return paidQueryResult();
  });
  assert.equal(result.statusCode, 409);
  assert.equal(state.current().isPaid, false);
  assert.equal(state.current().cancellationLock, 'cancel-in-progress');
});

test('ambiguous attempts require an explicit stored reference and never guess which payment succeeded', async t => {
  const state = setup(t);
  await state.create();
  const original = state.current().vnpayPayments[0];
  original.expiresAt = new Date(Date.now() - 1000).toISOString();
  await state.create();
  const query = t.mock.fn(async () => paidQueryResult());
  assert.equal((await reconcile(state, query)).statusCode, 409);
  assert.equal(query.mock.callCount(), 0);
  assert.equal((await reconcile(state, query, { body: { txnRef: id() + '0'.repeat(16) } })).statusCode, 409);
  const result = await reconcile(state, query, { body: { txnRef: original.txnRef } });
  assert.equal(result.statusCode, 200);
  assert.equal(state.current().vnpayPayments[0].state, 'succeeded');
  assert.equal(state.current().vnpayPayments[1].state, 'pending');
});

test('reconciliation is a protected POST route; public return remains read-only', async t => {
  setup(t);
  const server = createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/${id()}/vnpay/reconcile`, { method: 'POST' });
  assert.equal(result.status, 401);
});

test('reconciliation requires successful payment codes as well as the verified paid flag', async t => {
  const state = setup(t);
  await state.create();
  const initial = clone(state.current());
  for (const patch of [{ responseCode: '97' }, { transactionStatus: '01' }, { transactionType: '02' }, { transactionNo: '' }]) {
    state.replace(clone(initial));
    const result = await reconcile(state, async () => ({ ...paidQueryResult(), ...patch }));
    assert.equal(result.statusCode, 502);
    assert.equal(state.current().isPaid, false);
    assert.equal(state.current().vnpayPayments[0].state, 'pending');
  }
});

test('QueryDR success for an older attempt concurrent with another paid attempt flags overpayment', async t => {
  const state = setup(t);
  await state.create();
  const original = state.current().vnpayPayments[0];
  original.expiresAt = new Date(Date.now() - 1000).toISOString();
  await state.create();
  const result = await reconcile(state, async () => {
    assert.equal((await state.ipn(notification(state))).body.RspCode, '00');
    return { ...paidQueryResult(), transactionNo: '987654321' };
  }, { body: { txnRef: original.txnRef } });
  assert.equal(result.statusCode, 200);
  assert.equal(state.current().isPaid, true);
  assert.equal(state.current().paymentReviewRequired, true);
  assert.equal(state.current().vnpayPayments[0].overpayment, true);
  assert.deepEqual(state.current().vnpayPayments.map(attempt => attempt.state), ['succeeded', 'succeeded']);
  assert.equal(state.stock.mock.callCount(), 0);
});

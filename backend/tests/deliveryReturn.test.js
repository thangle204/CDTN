import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { recordDeliveryFailure, completeDeliveryReturn } from '../controllers/deliveryController.js';
import { aggregateRestockItems, calculateDeliveryReturnAmounts, normalizeDeliveryReturnRequest } from '../utils/deliveryReturn.js';

const id = () => String(new mongoose.Types.ObjectId());
const clone = value => structuredClone(value);
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const get = (object, path) => path.split('.').reduce((current, key) => current?.[key], object);
const set = (object, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((current, key) => current[key] ||= {}, object);
  target[last] = clone(value);
};
const matchesValue = (value, expected) => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return Object.entries(expected).every(([operator, operand]) => {
      if (operator === '$ne') return Array.isArray(value) ? !value.includes(operand) : value !== operand;
      if (operator === '$exists') return (value !== undefined) === operand;
      if (operator === '$lte') return value <= operand;
      if (operator === '$gt') return value > operand;
      if (operator === '$size') return Array.isArray(value) && value.length === operand;
      if (operator === '$elemMatch') return Array.isArray(value) && value.some(row => matches(row, operand));
      throw new Error(`Unhandled matcher ${operator}`);
    });
  }
  if (expected === null) return value == null;
  return Array.isArray(value) ? value.includes(expected) : value === expected;
};
const matches = (object, filter) => Object.entries(filter).every(([key, expected]) => key === '$or'
  ? expected.some(branch => matches(object, branch)) : matchesValue(get(object, key), expected));
const apply = (object, update, filter = {}) => {
  for (const [path, value] of Object.entries(update.$set || {})) set(object, path, value);
  for (const [path, value] of Object.entries(update.$inc || {})) {
    if (path === 'variants.$.quantity') {
      object.variants.find(row => matches(row, filter.variants.$elemMatch)).quantity += value;
    } else set(object, path, (get(object, path) || 0) + value);
  }
  for (const [path, value] of Object.entries(update.$addToSet || {})) {
    const array = get(object, path) || [];
    if (!array.includes(value)) array.push(value);
    set(object, path, array);
  }
  for (const [path, value] of Object.entries(update.$pull || {})) set(object, path, (get(object, path) || []).filter(entry => entry !== value));
};

const setup = (t, options = {}) => {
  const productId = id();
  const voucherId = id();
  const actorId = id();
  const order = {
    _id: id(), __v: 0, checkoutState: 'committed', user: id(), cancellationLock: null,
    orderStatus: options.status || 'Đang giao', isPaid: options.paid || false,
    paymentMethod: options.paid ? 'BANK' : 'COD', isDelivered: false, stockRestored: false,
    totalPrice: 830000, shippingPrice: 30000, itemsPrice: 850000, discountAmount: 50000,
    refundStatus: 'not_required', voucherReleased: false,
    voucher: { _id: voucherId, code: 'SAVE', type: 'fixed', discount: 50000 },
    orderItems: [{ product: productId, name: 'Giày Trắng', price: 212500, quantity: 4, color: 'Trắng', size: 40, inventoryVariant: true }],
    ...(options.order || {}),
  };
  if (order.orderStatus === 'Giao thất bại') order.deliveryFailure = { reason: 'Khách từ chối nhận', notes: '', failedBy: actorId, failedAt: new Date() };
  const products = new Map([[productId, {
    _id: productId, __v: 0, countInStock: 3, deliveryReturnReceipts: [],
    variants: [{ color: 'Trắng', size: 40, quantity: 3 }],
  }]]);
  const voucher = { _id: voucherId, usedCount: 1, __v: 0, deliveryReturnReceipts: [], deliveryReturnHolds: [] };
  const faults = new Map();
  const before = new Map();
  const after = new Map();
  const writes = [];
  const run = async (name, action) => {
    const beforeHook = before.get(name);
    before.delete(name);
    if (beforeHook) await beforeHook();
    if (faults.get(name) === 'before') { faults.delete(name); throw new Error('Private database detail'); }
    const result = action();
    const afterHook = after.get(name);
    after.delete(name);
    if (afterHook) await afterHook();
    if (faults.get(name) === 'after') { faults.delete(name); throw new Error('Private database detail'); }
    return result;
  };
  t.mock.method(Order, 'findById', async () => run('orderRead', () => clone(order)));
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    const name = update.$set?.deliveryFailure ? 'failure' : update.$set?.deliveryReturn ? 'claim' : 'complete';
    return run(name, () => {
      writes.push({ name, filter: clone(filter), update: clone(update) });
      if (!matches(order, filter)) return null;
      apply(order, update, filter);
      return clone(order);
    });
  });
  t.mock.method(Order, 'updateOne', async (filter, update) => run('recovery', () => {
    if (!matches(order, filter)) return { matchedCount: 0 };
    apply(order, update, filter);
    return { matchedCount: 1 };
  }));
  t.mock.method(Product, 'updateOne', async (filter, update) => run('stock', () => {
    const product = products.get(String(filter._id));
    writes.push({ name: 'stock', filter: clone(filter), update: clone(update) });
    if (!product || !matches(product, filter)) return { matchedCount: 0 };
    apply(product, update, filter);
    return { matchedCount: 1 };
  }));
  t.mock.method(Product, 'findById', async product => run('stockRead', () => clone(products.get(String(product)))));
  t.mock.method(Voucher, 'updateOne', async (filter, update) => {
    const name = update.$inc?.usedCount ? 'voucher' : 'cleanup';
    return run(name, () => {
      writes.push({ name, filter: clone(filter), update: clone(update) });
      if (options.voucherMissing || !matches(voucher, filter)) return { matchedCount: 0 };
      apply(voucher, update, filter);
      return { matchedCount: 1 };
    });
  });
  t.mock.method(Voucher, 'findById', async () => run('voucherRead', () => options.voucherMissing ? null : clone(voucher)));
  const request = body => ({ params: { id: order._id }, user: { _id: actorId, isAdmin: true }, body });
  const inspection = [{ itemIndex: 0, restockQuantity: 2, damagedQuantity: 1, missingQuantity: 1 }];
  const returnBody = { inspection, returnShippingCost: 45000, notes: 'Đã kiểm tra hàng tại kho' };
  return {
    order, products, productId, voucher, writes, request, returnBody,
    fault(name, phase = 'before') { faults.set(name, phase); },
    before(name, callback) { before.set(name, callback); },
    after(name, callback) { after.set(name, callback); },
    async failure(body = { reason: 'Khách từ chối nhận' }) { const res = response(); await recordDeliveryFailure(request(body), res); return res; },
    async complete(body = returnBody) { const res = response(); await completeDeliveryReturn(request(body), res); return res; },
  };
};

test('delivery failure records the reason without stock changes or COD collection', async t => {
  const state = setup(t);
  const result = await state.failure();
  assert.equal(result.statusCode, 200);
  assert.equal(state.order.orderStatus, 'Giao thất bại');
  assert.equal(state.order.isPaid, false);
  assert.equal(state.order.isDelivered, false);
  assert.equal(state.order.paidAt, undefined);
  assert.equal(state.order.deliveredAt, undefined);
  assert.equal(state.order.refundStatus, 'not_required');
  assert.equal(state.products.get(state.productId).countInStock, 3);
  assert.equal(state.voucher.usedCount, 1);
  assert.equal(state.writes.filter(row => row.name === 'stock').length, 0);
  const timestamp = state.order.deliveryFailure.failedAt;
  assert.equal((await state.failure()).statusCode, 200);
  assert.deepEqual(state.order.deliveryFailure.failedAt, timestamp);
  assert.equal(state.writes.filter(row => row.name === 'failure').length, 1);
});

test('paid failed delivery retains payment history and awaits net-product refund', async t => {
  const paidAt = new Date('2026-10-15T00:00:00Z');
  const state = setup(t, { paid: true, order: { paidAt } });
  assert.equal((await state.failure()).statusCode, 200);
  assert.equal(state.order.refundStatus, 'pending');
  assert.equal(state.order.isPaid, true);
  assert.deepEqual(state.order.paidAt, paidAt);
});

test('delivery failure rejects invalid reasons, unauthorized users, ids and non-shipping states', async t => {
  const state = setup(t);
  for (const reason of ['', true, 'x'.repeat(301)]) assert.equal((await state.failure({ reason })).statusCode, 400);
  for (const status of ['Đang xử lý', 'Đã xác nhận', 'Đã giao', 'Đã hủy', 'Giao thất bại', 'Đã xử lý hoàn hàng']) {
    state.order.orderStatus = status;
    assert.equal((await state.failure()).statusCode, ['Giao thất bại', 'Đã xử lý hoàn hàng'].includes(status) ? 409 : 400);
  }
  state.order.orderStatus = 'Đang giao';
  state.order.checkoutState = 'pending';
  assert.equal((await state.failure()).statusCode, 409);
  state.order.checkoutState = 'committed';
  state.order.cancellationLock = 'cancel';
  assert.equal((await state.failure()).statusCode, 409);
  const denied = response();
  await recordDeliveryFailure({ ...state.request({ reason: 'Từ chối' }), user: { isAdmin: false } }, denied);
  assert.equal(denied.statusCode, 403);
  const invalid = response();
  await recordDeliveryFailure({ ...state.request({ reason: 'Từ chối' }), params: { id: 'bad' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(state.writes.length, 0);
});

test('a stale failure cannot overwrite concurrent delivery or payment changes', async t => {
  const state = setup(t);
  state.before('failure', () => { state.order.orderStatus = 'Đã giao'; state.order.isDelivered = true; state.order.isPaid = true; state.order.__v += 1; });
  assert.equal((await state.failure()).statusCode, 409);
  assert.equal(state.order.orderStatus, 'Đã giao');
  assert.equal(state.order.deliveryFailure, undefined);
  state.order.orderStatus = 'Đang giao'; state.order.isDelivered = false; state.order.isPaid = false;
  state.before('failure', () => { state.order.isPaid = true; state.order.__v += 1; });
  assert.equal((await state.failure()).statusCode, 409);
  assert.equal(state.order.deliveryFailure, undefined);
});

test('failure with a lost acknowledgement reads back the recorded transition', async t => {
  const state = setup(t);
  state.fault('failure', 'after');
  const result = await state.failure();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.orderStatus, 'Giao thất bại');
});

test('physical return restores only good pairs and records costs/refund, leaving COD unpaid', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  const result = await state.complete();
  assert.equal(result.statusCode, 200);
  assert.equal(state.order.orderStatus, 'Đã xử lý hoàn hàng');
  assert.equal(state.order.deliveryReturn.state, 'completed');
  assert.equal(state.order.deliveryReturn.refundAmount, 0);
  assert.equal(state.order.deliveryReturn.retainedShippingFee, 0);
  assert.equal(state.order.deliveryReturn.returnShippingCost, 45000);
  assert.equal(state.order.refundStatus, 'not_required');
  assert.equal(state.order.stockRestored, false);
  assert.equal(state.order.isPaid, false);
  assert.equal(state.order.isDelivered, false);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.products.get(state.productId).variants[0].quantity, 5);
  assert.equal(state.voucher.usedCount, 0);
  assert.equal(state.voucher.deliveryReturnHolds.length, 0);
  assert.equal(state.voucher.deliveryReturnReceipts.length, 1);
  assert.equal(state.order.voucherReleased, true);
  assert.equal(result.body.deliveryReturn.token, undefined);
  assert.equal(result.body.deliveryReturn.requestHash, undefined);
});

test('paid return refunds net products after voucher and retains outgoing shipping only', async t => {
  const state = setup(t, { status: 'Giao thất bại', paid: true });
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.order.deliveryReturn.refundAmount, 800000);
  assert.equal(state.order.deliveryReturn.retainedShippingFee, 30000);
  assert.equal(state.order.deliveryReturn.returnShippingCost, 45000);
  assert.equal(state.order.refundStatus, 'pending');
  assert.equal(state.order.isPaid, true);
});

test('a shipping voucher keeps the full paid total refundable', () => {
  assert.deepEqual(calculateDeliveryReturnAmounts({ totalPrice: 800000, shippingPrice: 0, isPaid: true }), {
    refundAmount: 800000, retainedShippingFee: 0,
  });
  assert.deepEqual(calculateDeliveryReturnAmounts({ totalPrice: 30000, shippingPrice: 30000, isPaid: true }), {
    refundAmount: 0, retainedShippingFee: 30000,
  });
});

test('inspection validates every position, strict numeric counts and exact shipped totals', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  const badRows = [[], [{ itemIndex: 1, restockQuantity: 4, damagedQuantity: 0, missingQuantity: 0 }],
    [{ itemIndex: 0, restockQuantity: 5, damagedQuantity: 0, missingQuantity: 0 }],
    [{ itemIndex: 0, restockQuantity: '2', damagedQuantity: 1, missingQuantity: 1 }],
    [{ itemIndex: 0, restockQuantity: true, damagedQuantity: 1, missingQuantity: 2 }],
    [{ itemIndex: 0, restockQuantity: 2, damagedQuantity: -1, missingQuantity: 3 }],
    [{ itemIndex: 0, restockQuantity: 2.5, damagedQuantity: 0.5, missingQuantity: 1 }],
    [{ itemIndex: 0, restockQuantity: Number.MAX_SAFE_INTEGER, damagedQuantity: Number.MAX_SAFE_INTEGER, missingQuantity: 0 }]];
  for (const inspection of badRows) assert.equal((await state.complete({ ...state.returnBody, inspection })).statusCode, 400);
  for (const returnShippingCost of [-1, '45000', true, undefined, 0.5, Infinity]) {
    assert.equal((await state.complete({ ...state.returnBody, returnShippingCost })).statusCode, 400);
  }
  assert.equal((await state.complete({ ...state.returnBody, notes: 'x'.repeat(1001) })).statusCode, 400);
  state.order.orderStatus = 'Đang giao';
  assert.equal((await state.complete()).statusCode, 400);
  assert.equal(state.writes.length, 0);
});

test('duplicate inspection positions are rejected and canonical order permits safe replay', () => {
  const order = { orderItems: [{ quantity: 1 }, { quantity: 2 }] };
  const first = { itemIndex: 0, restockQuantity: 1, damagedQuantity: 0, missingQuantity: 0 };
  const second = { itemIndex: 1, restockQuantity: 0, damagedQuantity: 1, missingQuantity: 1 };
  const body = { inspection: [first, second], returnShippingCost: 0 };
  assert.throws(() => normalizeDeliveryReturnRequest({ ...body, inspection: [first, first] }, order), error => error.status === 400);
  assert.equal(normalizeDeliveryReturnRequest(body, order).requestHash,
    normalizeDeliveryReturnRequest({ ...body, inspection: [second, first], notes: ' ' }, order).requestHash);
});

test('concurrent duplicate returns and late retries restore stock and release voucher once', async t => {
  const state = setup(t, { status: 'Giao thất bại', paid: true });
  const results = await Promise.all([state.complete(), state.complete(), state.complete()]);
  assert.deepEqual(results.map(result => result.statusCode), [200, 200, 200]);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.products.get(state.productId).deliveryReturnReceipts.length, 1);
  assert.equal(state.voucher.usedCount, 0);
  assert.equal(state.voucher.deliveryReturnReceipts.length, 1);
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 5);
});

test('changed inspection or fees cannot replace a frozen operation after partial failure', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.fault('voucher');
  const first = await state.complete();
  assert.equal(first.statusCode, 503);
  assert.equal(state.order.deliveryReturn.state, 'processing');
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.voucher.usedCount, 1);
  const token = state.order.deliveryReturn.token;
  const changed = await state.complete({ ...state.returnBody, returnShippingCost: 50000 });
  assert.equal(changed.statusCode, 409);
  assert.equal(state.order.deliveryReturn.token, token);
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.voucher.usedCount, 0);
});

test('partial failure across products resumes remaining SKUs without compensating completed stock', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  const secondId = id();
  state.products.set(secondId, { ...clone(state.products.get(state.productId)), _id: secondId });
  state.order.orderItems.push({ ...clone(state.order.orderItems[0]), product: secondId });
  const body = { ...state.returnBody, inspection: [
    ...state.returnBody.inspection,
    { itemIndex: 1, restockQuantity: 2, damagedQuantity: 1, missingQuantity: 1 },
  ] };
  state.before('stock', () => state.before('stock', () => state.fault('stock')));
  assert.equal((await state.complete(body)).statusCode, 503);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.products.get(secondId).countInStock, 3);
  assert.equal(state.voucher.usedCount, 1);
  assert.equal((await state.complete(body)).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.products.get(secondId).countInStock, 5);
  assert.equal(state.voucher.usedCount, 0);
});

for (const stage of ['claim', 'stock', 'voucher', 'complete']) {
  test(`lost ${stage} acknowledgement is resolved without repeating effects`, async t => {
    const state = setup(t, { status: 'Giao thất bại' });
    state.fault(stage, 'after');
    assert.equal((await state.complete()).statusCode, 200);
    assert.equal(state.products.get(state.productId).countInStock, 5);
    assert.equal(state.voucher.usedCount, 0);
    assert.equal(state.order.deliveryReturn.state, 'completed');
  });
}

test('finalization failure keeps voucher hold and receipts, then resumes without compensation', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.fault('complete');
  assert.equal((await state.complete()).statusCode, 503);
  assert.equal(state.order.orderStatus, 'Giao thất bại');
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.voucher.usedCount, 0);
  assert.equal(state.voucher.deliveryReturnHolds.length, 1);
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.voucher.usedCount, 0);
  assert.equal(state.voucher.deliveryReturnHolds.length, 0);
});

test('missing variant or product blocks completion and keeps a resumable frozen inspection', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.products.get(state.productId).variants[0].size = 41;
  assert.equal((await state.complete()).statusCode, 503);
  assert.equal(state.products.get(state.productId).countInStock, 3);
  assert.equal(state.voucher.usedCount, 1);
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  state.products.delete(state.productId);
  assert.equal((await state.complete()).statusCode, 503);
  assert.equal(state.order.orderStatus, 'Giao thất bại');
});

test('missing voucher or zero usage without a receipt requires reconciliation', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.voucher.usedCount = 0;
  assert.equal((await state.complete()).statusCode, 503);
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  assert.equal(state.order.voucherReleased, false);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.voucher.deliveryReturnReceipts.length, 0);
});

test('a deleted voucher is not silently treated as successfully released', async t => {
  const state = setup(t, { status: 'Giao thất bại', voucherMissing: true });
  assert.equal((await state.complete()).statusCode, 503);
  assert.equal(state.order.orderStatus, 'Giao thất bại');
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  assert.equal(state.order.voucherReleased, false);
});

test('return confirmation requires admin and a committed checkout before any write', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  const denied = response();
  await completeDeliveryReturn({ ...state.request(state.returnBody), user: { isAdmin: false } }, denied);
  assert.equal(denied.statusCode, 403);
  state.order.checkoutState = 'pending';
  assert.equal((await state.complete()).statusCode, 409);
  assert.equal(state.writes.length, 0);
});

test('all damaged or missing pairs can close a return without adding sellable stock', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  const body = { ...state.returnBody, inspection: [{ itemIndex: 0, restockQuantity: 0, damagedQuantity: 2, missingQuantity: 2 }] };
  assert.equal((await state.complete(body)).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 3);
  assert.equal(state.writes.filter(row => row.name === 'stock').length, 0);
  assert.equal(state.order.stockRestored, false);
});

test('legacy shared-stock lines aggregate across sizes and cannot restore into converted inventory', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.order.orderItems = [
    { product: state.productId, quantity: 2, size: 40, inventoryVariant: false },
    { product: state.productId, quantity: 1, size: 41, inventoryVariant: false },
  ];
  const body = { returnShippingCost: 0, inspection: [
    { itemIndex: 0, restockQuantity: 1, damagedQuantity: 1, missingQuantity: 0 },
    { itemIndex: 1, restockQuantity: 1, damagedQuantity: 0, missingQuantity: 0 },
  ] };
  assert.equal((await state.complete(body)).statusCode, 503);
  assert.equal(state.products.get(state.productId).countInStock, 3);
  state.products.get(state.productId).variants = [];
  assert.equal((await state.complete(body)).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.products.get(state.productId).deliveryReturnReceipts.length, 1);
});

test('same SKU lines aggregate, distinct variants receive distinct durable receipts', () => {
  const product = id();
  const order = {
    orderItems: [
      { product, quantity: 2, inventoryVariant: true, color: 'Trắng', size: 40 },
      { product, quantity: 1, inventoryVariant: true, color: 'Trắng', size: 40 },
      { product, quantity: 2, inventoryVariant: true, color: 'Đen', size: 41 },
    ],
    deliveryReturn: { token: 'operation', inspection: [
      { itemIndex: 0, restockQuantity: 1 }, { itemIndex: 1, restockQuantity: 1 }, { itemIndex: 2, restockQuantity: 2 },
    ] },
  };
  const groups = aggregateRestockItems(order);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(row => row.quantity), [2, 2]);
  assert.notEqual(groups[0].receipt, groups[1].receipt);
  assert.deepEqual(aggregateRestockItems(order), groups);
});

test('post-completion cleanup failure never undoes a return and an identical retry clears the hold', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.fault('cleanup');
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.order.orderStatus, 'Đã xử lý hoàn hàng');
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  assert.equal(state.voucher.deliveryReturnHolds.length, 1);
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.order.deliveryReturn.recoveryRequired, false);
  assert.equal(state.voucher.deliveryReturnHolds.length, 0);
  assert.equal(state.products.get(state.productId).countInStock, 5);
});

test('a stock write with unreadable acknowledgement remains protected until its receipt can be read', async t => {
  const state = setup(t, { status: 'Giao thất bại' });
  state.fault('stock', 'after');
  state.fault('stockRead');
  const failed = await state.complete();
  assert.equal(failed.statusCode, 503);
  assert.ok(!failed.body.message.includes('Private database detail'));
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.order.deliveryReturn.recoveryRequired, true);
  assert.equal((await state.complete()).statusCode, 200);
  assert.equal(state.products.get(state.productId).countInStock, 5);
});

test('a delayed worker recognizes another completed return after voucher deletion', async t => {
  const options = { status: 'Giao thất bại', paid: true };
  const state = setup(t, options);
  state.after('stock', async () => {
    const other = await state.complete();
    assert.equal(other.statusCode, 200);
    assert.equal(state.voucher.deliveryReturnHolds.length, 0);
    options.voucherMissing = true;
  });
  const delayed = await state.complete();
  assert.equal(delayed.statusCode, 200);
  assert.equal(state.order.orderStatus, 'Đã xử lý hoàn hàng');
  assert.equal(state.products.get(state.productId).countInStock, 5);
  assert.equal(state.voucher.usedCount, 0);
});

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Voucher from '../models/voucherModel.js';
import Wallet from '../models/voucherWalletModel.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import { getActiveVouchers, getCustomerVouchers, grantCustomerVouchers, saveVoucher, updateVoucher, toggleVoucherVisibility, deleteVoucher } from '../controllers/voucherController.js';
import { calculateOrderPricing } from '../utils/orderPricing.js';
import { checkVoucherCustomer, reserveVoucher, releaseVoucherUsage, firstOrderEligible } from '../utils/voucherUsage.js';
import { cancelOrder } from '../controllers/orderController.js';
const id = () => new mongoose.Types.ObjectId();
beforeEach(t => { t.mock.method(Wallet, 'init', async () => Wallet);t.mock.method(Wallet, 'createIndexes', async () => []); });
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value;return this; }, set() {}, json(value) { this.body = value;return this; } });
const query = value => ({ sort() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const fixture = patch => ({ _id: id(), __v: 0, code: 'SHOE10', description: 'Test promotion', type: 'percent', discount: 10,
  maxUses: 10, usedCount: 0, minOrder: 0, startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 30 * 86400000),
  isActive: true, visibility: 'public', eligibility: 'all', reservations: [], releaseReceipts: [], releaseHolds: [], ...patch });

test('percentage caps reduce products only; fixed and shipping rules keep integer VND totals', () => {
  assert.deepEqual(calculateOrderPricing(10000000, fixture({ maxDiscount: 100000 })), { itemsPrice: 10000000, discountAmount: 100000, shippingPrice: 30000, totalPrice: 9930000 });
  assert.equal(calculateOrderPricing(100000, fixture({ maxDiscount: 50000 })).discountAmount, 10000);
  assert.equal(calculateOrderPricing(100000, fixture({ type: 'fixed', discount: 200000 })).totalPrice, 30000);
  assert.equal(calculateOrderPricing(100000, fixture({ type: 'shipping', discount: 30000 })).totalPrice, 100000);
});

test('public catalog excludes private campaigns and never returns reservation owners or receipts', async t => {
  const voucher = fixture({ reservations: [{ token: 'private', user: id(), order: id() }], releaseReceipts: ['secret'] });
  t.mock.method(Voucher, 'find', filter => { assert.deepEqual(filter.visibility, { $ne: 'private' });return query([voucher]); });
  const res = response();await getActiveVouchers({}, res);
  assert.equal(res.body[0].code, voucher.code);assert.equal(Object.hasOwn(res.body[0], 'reservations'), false);assert.equal(Object.hasOwn(res.body[0], 'releaseReceipts'), false);
});

test('private codes require their owner grant and reject expired grants even when code is known', async t => {
  const user = id(), voucher = fixture({ visibility: 'private', eligibility: 'after_purchase' });let wallet = null;
  t.mock.method(Wallet, 'findOne', async filter => { assert.equal(String(filter.user), String(user)); assert.equal(filter.kind, 'granted');return wallet; });
  await assert.rejects(checkVoucherCustomer(voucher, undefined, 500000), error => error.status === 401);
  await assert.rejects(checkVoucherCustomer(voucher, user, 500000), error => error.status === 403);
  wallet = { _id: id(), expiresAt: new Date(Date.now() - 1000) };
  await assert.rejects(checkVoucherCustomer(voucher, user, 500000), error => error.status === 400);
  wallet.expiresAt = new Date(Date.now() + 86400000);
  assert.equal((await checkVoucherCustomer(voucher, user, 500000)).wallet, wallet);
});

test('first purchase eligibility blocks delivered orders and other pending or partially cancelled orders', async t => {
  let existing = true;
  t.mock.method(Order, 'exists', async filter => {
    assert(filter.$or[0].orderStatus.$nin.includes('Đã hủy'));
    assert(!filter.$or[0].orderStatus.$nin.includes('Giao thất bại'));
    assert.equal(filter.$or[1].cancellationLock.$type, 'string');return existing;
  });
  assert.equal(await firstOrderEligible(id()), false);existing = false;assert.equal(await firstOrderEligible(id()), true);
});

test('personal limits count both tracked reservations and legacy unreleased orders', async t => {
  const user = id(), voucher = fixture({ perCustomerLimit: 2, reservations: [{ user, token: 'held', order: id() }] });
  t.mock.method(Wallet, 'findOne', async () => ({ _id: id(), kind: 'saved' }));
  t.mock.method(Order, 'countDocuments', async filter => { assert.deepEqual(filter['voucher.reservationToken'], { $exists: false });return 1; });
  await assert.rejects(checkVoucherCustomer(voucher, user, 500000), error => error.status === 400);
});

test('two concurrent reservations cannot consume the last global use and carry a customer limit into the atomic filter', async t => {
  const voucher = fixture({ maxUses: 1, perCustomerLimit: 1 });let stored = structuredClone(voucher);
  t.mock.method(Voucher, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.$expr.$and.length, 2);assert.equal(filter.__v, 0);
    assert(update.$push.reservations.order);assert(update.$push.reservations.user);
    if (stored.usedCount >= stored.maxUses || stored.__v !== filter.__v) return null;
    stored.usedCount++;stored.__v++;stored.reservations.push(update.$push.reservations);return stored;
  });
  const results = await Promise.all([1, 2].map(n => reserveVoucher({ voucher, user: id(), order: id(), token: `token-${n}`, itemsPrice: 500000, customer: { legacyCount: 0 } })));
  assert.equal(results.filter(Boolean).length, 1);assert.equal(stored.usedCount, 1);assert.equal(stored.reservations.length, 1);
});

test('lost reservation acknowledgement is recovered only by the matching durable order token', async t => {
  const voucher = fixture(), order = id();let stored = { ...voucher, reservations: [{ token: 'mine', order }] };
  t.mock.method(Voucher, 'findOneAndUpdate', async () => { throw Error('write response lost'); });
  t.mock.method(Voucher, 'findById', async () => stored);
  assert.equal(await reserveVoucher({ voucher, user: id(), order, token: 'mine', itemsPrice: 500000, customer: { legacyCount: 0 } }), stored);
  stored = { ...voucher, reservations: [] };
  await assert.rejects(reserveVoucher({ voucher, user: id(), order, token: 'unknown', itemsPrice: 500000, customer: { legacyCount: 0 } }), error => error.status === 503 && error.voucherReservationUncertain);
});

test('releasing usage is atomic and idempotent, removes its reservation and verifies uncertain writes', async t => {
  const voucher = fixture({ usedCount: 1 }), order = { voucher: { _id: voucher._id, reservationToken: 'reserve' } };
  let writes = 0;
  t.mock.method(Voucher, 'updateOne', async (filter, update) => {
    if (voucher.releaseReceipts.includes(filter.releaseReceipts.$ne)) return { matchedCount: 0 };
    assert.equal(update.$pull.reservations.token, 'reserve');voucher.usedCount--;voucher.releaseReceipts.push(update.$addToSet.releaseReceipts);writes++;
    throw Error('lost acknowledgement');
  });
  t.mock.method(Voucher, 'findById', async () => voucher);
  await releaseVoucherUsage(order, 'cancel');await releaseVoucherUsage(order, 'cancel');
  assert.equal(writes, 1);assert.equal(voucher.usedCount, 0);
});

test('zero usage without a matching release receipt is retained for reconciliation', async t => {
  t.mock.method(Voucher, 'updateOne', async () => ({ matchedCount: 0 }));
  t.mock.method(Voucher, 'findById', async () => fixture());
  await assert.rejects(releaseVoucherUsage({ voucher: { _id: id() } }, 'unknown'), error => error.status === 503);
});

test('legacy cancellation locks without durable receipts cannot replay stock restoration', async t => {
  const order = new Order({ _id: id(), user: id(), orderStatus: 'Đã hủy', cancellationLock: 'old-lock', stockRestored: false });
  t.mock.method(Order, 'findById', async () => order);
  const stock = t.mock.method(Product, 'updateOne', async () => { throw Error('must not guess legacy restoration state'); });
  const res = response();await cancelOrder({ params: { id: order._id }, user: { isAdmin: true } }, res);
  assert.equal(res.statusCode, 503);assert.equal(stock.mock.callCount(), 0);assert.equal(order.cancellationLock, 'old-lock');
});

test('stale admin forms and stale status switches return 409 before editing', async t => {
  const voucher = new Voucher(fixture({ __v: 2, discount: 20 }));
  t.mock.method(Voucher, 'findById', async () => voucher);
  const saved = t.mock.method(voucher, 'save', async () => { throw Error('must not save'); });
  for (const operation of [updateVoucher, toggleVoucherVisibility]) await assert.rejects(operation({ params: { id: voucher._id }, body: { version: 1, discount: 10 } }, response()), error => error.status === 409);
  assert.equal(saved.mock.callCount(), 0);assert.equal(voucher.discount, 20);
});

test('description-only API edits preserve exact dates and issued economic conditions cannot be rewritten', async t => {
  const voucher = new Voucher(fixture({ walletCount: 1, startDate: new Date('2026-01-01T05:12:30.123Z'), endDate: new Date('2027-01-01T03:10:30.123Z') }));
  t.mock.method(Voucher, 'findById', async () => voucher);t.mock.method(Voucher, 'exists', async () => false);
  t.mock.method(voucher, 'save', async () => voucher);
  await updateVoucher({ params: { id: voucher._id }, body: { version: 0, description: 'Updated words' } }, response());
  assert.equal(voucher.startDate.toISOString(), '2026-01-01T05:12:30.123Z');assert.equal(voucher.endDate.toISOString(), '2027-01-01T03:10:30.123Z');
  await assert.rejects(updateVoucher({ params: { id: voucher._id }, body: { version: 0, discount: 99 } }, response()), error => error.status === 409);
});

test('saving a public code changes only its wallet deletion guard and never reserves a use', async t => {
  const voucher = new Voucher(fixture());let entry;
  t.mock.method(Voucher, 'findById', async () => voucher);t.mock.method(Wallet, 'exists', async () => false);
  t.mock.method(Voucher, 'updateOne', async (filter, update) => { assert.equal(update.$inc.usedCount, undefined);assert.equal(update.$inc.walletCount, 1);return { matchedCount: 1 }; });
  t.mock.method(Wallet, 'updateOne', async (filter, update) => { entry = update.$setOnInsert;assert.equal(filter.user, 'owner');return { upsertedCount: 1 }; });
  await saveVoucher({ params: { id: voucher._id }, user: { _id: 'owner' } }, response());
  assert.equal(entry.kind, 'saved');assert.equal(entry.expiresAt, undefined);assert.equal(voucher.usedCount, 0);
});

test('wallet issuance cannot race deletion or editing without the voucher version guard', async t => {
  const voucher = new Voucher(fixture());t.mock.method(Voucher, 'findById', async () => voucher);t.mock.method(Wallet, 'exists', async () => false);
  t.mock.method(Voucher, 'updateOne', async () => ({ matchedCount: 0 }));
  const insert = t.mock.method(Wallet, 'updateOne', async () => {});
  await assert.rejects(saveVoucher({ params: { id: voucher._id }, user: { _id: id() } }, response()), error => error.status === 409);
  assert.equal(insert.mock.callCount(), 0);
});

test('private first-order grants are assigned once without extending expiry on refresh', async t => {
  const voucher = fixture({ visibility: 'private', eligibility: 'first_order', validityDays: 2 });const user = id();let entry;
  t.mock.method(Voucher, 'find', async () => [voucher]);t.mock.method(Order, 'exists', async () => false);
  t.mock.method(Wallet, 'exists', async filter => { assert.equal(filter.user, user);return Boolean(entry); });
  t.mock.method(Voucher, 'updateOne', async () => ({ matchedCount: 1 }));
  t.mock.method(Wallet, 'updateOne', async (filter, update) => { entry = update.$setOnInsert;return { upsertedCount: 1 }; });
  const now = new Date();await grantCustomerVouchers(user, now);const expiry = entry.expiresAt.toISOString();
  await grantCustomerVouchers(user, new Date(now.getTime() + 86400000));assert.equal(entry.expiresAt.toISOString(), expiry);
  assert.equal(entry.kind, 'granted');assert.equal(entry.issuedAt, now);
});

test('after-purchase gifts require a paid delivered order in the campaign and preserve its source', async t => {
  const voucher = fixture({ visibility: 'private', eligibility: 'after_purchase' });const source = { _id: id() };let stored;
  t.mock.method(Voucher, 'find', async () => [voucher]);t.mock.method(Order, 'findOne', filter => {
    assert.equal(filter.orderStatus, 'Đã giao');assert.equal(filter.isPaid, true);assert.equal(filter.isDelivered, true);assert.equal(filter.deliveredAt.$gte, voucher.startDate);return query(source);
  });
  t.mock.method(Wallet, 'exists', async () => false);t.mock.method(Voucher, 'updateOne', async () => ({ matchedCount: 1 }));
  t.mock.method(Wallet, 'updateOne', async (filter, update) => { stored = update.$setOnInsert;return {}; });
  await grantCustomerVouchers(id());assert.equal(stored.sourceOrder, source._id);
});

test('wallet cards scope grants to the authenticated owner and recommend lowest total including shipping', async t => {
  const user = id(), fixed = fixture({ code: 'SAVE20', type: 'fixed', discount: 20000 }), shipping = fixture({ code: 'SHIP', type: 'shipping', discount: 30000 });
  const wallets = [fixed, shipping].map(voucher => ({ _id: id(), user, voucher: voucher._id, kind: 'saved' }));
  t.mock.method(Wallet, 'find', async filter => { assert.equal(filter.user, user);return wallets; });
  t.mock.method(Wallet, 'findOne', async filter => wallets.find(wallet => String(wallet.voucher) === String(filter.voucher)));
  t.mock.method(Order, 'countDocuments', async () => 0);
  t.mock.method(Voucher, 'find', async filter => { assert.deepEqual(filter, { _id: { $in: wallets.map(wallet => wallet.voucher) } });return [fixed, shipping]; });
  const res = response();await getCustomerVouchers({ user: { _id: user }, query: { orderTotal: '500000' }, path: '/available' }, res);
  assert.equal(res.body[0].code, 'SHIP');assert.equal(res.body[0].savings, 30000);assert.equal(res.body[1].savings, 20000);
  assert(res.body.every(card => card.walletId));
});

test('public codes require an owned saved entry even when there is no per-customer limit', async t => {
  const voucher = fixture(), user = id(), stranger = id();let saved = false;
  t.mock.method(Wallet, 'findOne', async filter => {
    assert.equal(String(filter.voucher), String(voucher._id));assert.equal(filter.kind, 'saved');
    return saved && String(filter.user) === String(user) ? { _id: id(), kind: 'saved' } : null;
  });
  await assert.rejects(checkVoucherCustomer(voucher, undefined, 500000), { status: 401 });
  await assert.rejects(checkVoucherCustomer(voucher, user, 500000), error => error.status === 403 && /Mã của tôi/.test(error.message));
  saved = true;
  assert((await checkVoucherCustomer(voucher, user, 500000)).wallet);
  await assert.rejects(checkVoucherCustomer(voucher, stranger, 500000), { status: 403 });
  saved = false;
  await assert.rejects(checkVoucherCustomer(voucher, user, 500000), { status: 403 });
});

test('checkout recommendations are empty when the customer has no wallet, even if public offers exist', async t => {
  t.mock.method(Wallet, 'find', async () => []);
  t.mock.method(Voucher, 'find', async filter => { assert.deepEqual(filter, { _id: { $in: [] } });return []; });
  const res = response();await getCustomerVouchers({ user: { _id: id() }, query: { orderTotal: '500000' }, path: '/available' }, res);
  assert.deepEqual(res.body, []);
});

test('issued coupons and in-progress release holds cannot be deleted', async t => {
  let voucher = fixture({ walletCount: 1 });t.mock.method(Voucher, 'findById', async () => voucher);
  const remove = t.mock.method(Voucher, 'deleteOne', async () => { throw Error('must not delete'); });
  await assert.rejects(deleteVoucher({ params: { id: voucher._id } }, response()), error => error.status === 409);
  voucher = fixture({ releaseHolds: ['cancel'] });await assert.rejects(deleteVoucher({ params: { id: voucher._id } }, response()), error => error.status === 409);
  assert.equal(remove.mock.callCount(), 0);
});

test('cancellation finalization failure never reopens the order or reclaims a use taken by another checkout', async t => {
  const user = id(), product = { _id: id(), countInStock: 3, cancellationReceipts: [] }, voucher = fixture({ maxUses: 1, usedCount: 1 });
  let order = new Order({ _id: id(), user, orderItems: [{ product: product._id, name: 'Test', image: '/shoe.svg', price: 200000, quantity: 2 }],
    shippingAddress: { name: 'Test', phone: '0901234567', address: 'Street', city: 'City' }, totalPrice: 430000, voucher: { _id: voucher._id, reservationToken: 'old', code: voucher.code, type: voucher.type, discount: voucher.discount } }).toObject();
  let failCompletion = true, reservedByB = false;
  const applyOrder = update => { Object.assign(order, update.$set);order.__v += update.$inc?.__v || 0; };
  t.mock.method(Order, 'findById', async () => new Order(order));
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    if (filter.cancellationLock !== undefined && filter.cancellationLock !== order.cancellationLock) return null;
    if (update.$set.stockRestored && failCompletion) {
      assert.equal(voucher.usedCount, 0);voucher.usedCount = 1;reservedByB = true;failCompletion = false;throw Error('completion failed after B used the released slot');
    }
    applyOrder(update);return new Order(order);
  });
  t.mock.method(Order, 'updateOne', async (filter, update) => { applyOrder(update);return { matchedCount: 1 }; });
  t.mock.method(Product, 'updateOne', async (filter, update) => {
    if (product.cancellationReceipts.includes(filter.cancellationReceipts.$ne)) return { matchedCount: 0 };
    product.countInStock += update.$inc.countInStock;product.cancellationReceipts.push(update.$addToSet.cancellationReceipts);return { matchedCount: 1 };
  });
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(Voucher, 'updateOne', async (filter, update) => {
    if (update.$inc?.usedCount) {
      if (voucher.releaseReceipts.includes(filter.releaseReceipts.$ne)) return { matchedCount: 0 };
      voucher.usedCount--;voucher.releaseReceipts.push(update.$addToSet.releaseReceipts);
    }
    return { matchedCount: 1 };
  });
  t.mock.method(Voucher, 'findById', async () => voucher);
  const req = { params: { id: order._id }, user: { _id: user, isAdmin: false } }, first = response();await cancelOrder(req, first);
  assert.equal(first.statusCode, 503);assert(reservedByB);assert.equal(voucher.usedCount, 1);assert.equal(order.orderStatus, 'Đã hủy');assert(order.cancellationLock);assert.equal(product.countInStock, 5);
  const retry = response();await cancelOrder(req, retry);assert.equal(retry.statusCode, 200);assert.equal(voucher.usedCount, 1);assert.equal(product.countInStock, 5);assert.equal(order.stockRestored, true);
});

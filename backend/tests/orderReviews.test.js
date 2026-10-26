import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';

// Offline HTTP tests. Model reads are isolated fixtures; writes run real
// Mongoose validation, timestamps and optimistic concurrency at the driver boundary.
const ids = Object.fromEntries(['buyer', 'other', 'product', 'unbought', 'order', 'otherOrder'].map((key, index) => [key, String(index + 1).padStart(24, '0')]));
const secret = 'order-review-offline-test-secret';
let server, baseUrl, readyState, originalSecret;
const clone = value => {
  if (value instanceof mongoose.Document) return clone(value.toObject({ transform: false }));
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
};
const query = value => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const orderOf = changes => ({ _id: ids.order, user: ids.buyer, checkoutState: 'committed', orderStatus: 'Đã giao', isPaid: true, isDelivered: true, orderItems: [{ product: ids.product, name: 'Test sneaker', quantity: 1 }], ...changes });
const productOf = () => ({ _id: ids.product, __v: 0, name: 'Test sneaker', brand: 'Test', category: 'Sneaker', description: 'Offline fixture', image: '/shoe.svg', price: 200000, countInStock: 5, sizes: [40], variants: [], reviews: [], rating: 0, numReviews: 0 });
const reviewPath = (orderId = ids.order, productId = ids.product) => `/api/orders/${orderId}/reviews/${productId}`;
const request = async (path, { method = 'GET', body, user = ids.buyer, accountType = 'customer' } = {}) => {
  const token = user ? jwt.sign({ id: user, accountType, authVersion: 0 }, secret) : null;
  const result = await fetch(baseUrl + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: result.status, body: await result.json() };
};
before(async () => {
  originalSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = secret;
  readyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });
  server = createServer(createApp()); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (readyState) Object.defineProperty(mongoose.connection, 'readyState', readyState); else delete mongoose.connection.readyState;
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
const setPath = (object, field, value) => {
  const parts = field.split('.'); let target = object;
  for (const part of parts.slice(0, -1)) target = target[part] ??= {};
  target[parts.at(-1)] = clone(value);
};
const setup = t => {
  const state = { product: productOf(), orders: [orderOf()], updates: [], lookups: [], readGate: null };
  const user = userId => ({ _id: userId, name: userId === ids.buyer ? 'Buyer A' : 'Buyer B', authVersion: 0, isActive: true, isAdmin: false });
  t.mock.method(Customer, 'findById', id => query(user(id)));
  t.mock.method(Staff, 'findById', id => query({ ...user(id), isAdmin: true }));
  t.mock.method(Order, 'findOne', async filter => {
    state.lookups.push(filter);
    return clone(state.orders.find(order => String(order._id) === String(filter._id) && String(order.user) === String(filter.user) && order.checkoutState !== 'pending') || null);
  });
  t.mock.method(Product, 'findById', async id => {
    const snapshot = state.product && String(id) === ids.product ? Product.hydrate(clone(state.product)) : null;
    if (state.readGate) await state.readGate();
    return snapshot;
  });
  t.mock.method(Product, 'find', async () => state.product ? [Product.hydrate(clone(state.product))] : []);
  t.mock.method(Product, 'findOne', async filter => state.product && String(filter._id) === ids.product ? Product.hydrate(clone(state.product)) : null);
  t.mock.method(Product.collection, 'updateOne', async (filter, update) => {
    state.updates.push({ filter: clone(filter), update: clone(update) });
    assert.equal(typeof filter.__v, 'number', 'Every review write must use Mongoose optimistic concurrency');
    if (!state.product || String(filter._id) !== ids.product || filter.__v !== state.product.__v) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    for (const [field, value] of Object.entries(update.$set || {})) setPath(state.product, field, value);
    for (const [field, value] of Object.entries(update.$inc || {})) state.product[field] = (state.product[field] || 0) + value;
    for (const [field, value] of Object.entries(update.$push || {})) state.product[field].push(...clone(value.$each || [value]));
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  return state;
};
const pauseTwoReads = state => {
  let count = 0, release; const gate = new Promise(resolve => { release = resolve; });
  state.readGate = async () => { if (++count === 2) release(); await gate; };
};
const body = { rating: 5, comment: '  Fits well and comfortable  ' };

test('review APIs require a customer session, including for an administrative staff member', async t => {
  const state = setup(t);
  for (const options of [{ user: null }, { accountType: 'staff' }]) {
    const expected = options.user === null ? 401 : 403;
    assert.equal((await request(`/api/orders/${ids.order}/reviews`, options)).status, expected);
    assert.equal((await request(reviewPath(), { ...options, method: 'POST', body })).status, expected);
  }
  assert.equal(state.lookups.length, 0); assert.equal(state.updates.length, 0);
});

test('customers cannot read or write reviews using another customer order', async t => {
  const state = setup(t);
  for (const method of ['GET', 'POST', 'PUT']) {
    const result = await request(method === 'GET' ? `/api/orders/${ids.order}/reviews` : reviewPath(), { method, user: ids.other, ...(method === 'GET' ? {} : { body: { ...body, ...(method === 'PUT' ? { expectedVersion: 0 } : {}) } }) });
    assert.equal(result.status, 404);
  }
  assert(state.lookups.every(filter => filter.user === ids.other)); assert.equal(state.updates.length, 0);
});

test('only a committed paid and successfully delivered order can read or write reviews', async t => {
  const state = setup(t);
  for (const patch of [{ orderStatus: 'Đang xử lý' }, { orderStatus: 'Đã xác nhận' }, { orderStatus: 'Đang giao' }, { orderStatus: 'Đã hủy' }, { orderStatus: 'Giao thất bại' }, { orderStatus: 'Đã xử lý hoàn hàng' }, { isPaid: false }, { isDelivered: false }, { cancellationLock: 'busy' }, { deliveryReturn: { state: 'completed' } }, { checkoutState: 'pending' }]) {
    state.orders = [orderOf(patch)];
    const expected = patch.checkoutState === 'pending' ? 404 : 403;
    assert.equal((await request(reviewPath(), { method: 'POST', body })).status, expected, JSON.stringify(patch));
    assert.equal((await request(`/api/orders/${ids.order}/reviews`)).status, expected);
  }
  assert.equal(state.updates.length, 0);
});

test('validation rejects malformed IDs, invalid stars/comments and forged ownership before database reads', async t => {
  const state = setup(t);
  for (const path of [reviewPath('invalid'), reviewPath(ids.order, 'invalid')]) assert.equal((await request(path, { method: 'POST', body })).status, 400);
  for (const patch of [{ rating: true }, { rating: [5] }, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: 'NaN' }, { comment: '' }, { comment: '   ' }, { comment: 'x'.repeat(2001) }, { user: ids.other }, { name: 'Spoofed' }, { order: ids.otherOrder }]) {
    assert.equal((await request(reviewPath(), { method: 'POST', body: { ...body, ...patch } })).status, 400);
  }
  assert.equal(state.lookups.length, 0); assert.equal(state.updates.length, 0);
});

test('a delivered order cannot review products it did not contain, even if another delivered order contained them', async t => {
  const state = setup(t);
  state.orders.push(orderOf({ _id: ids.otherOrder, orderItems: [{ product: ids.unbought }] }));
  assert.equal((await request(reviewPath(ids.order, ids.unbought), { method: 'POST', body })).status, 403);
  assert.equal(state.updates.length, 0);
});

test('new reviews use the order owner name and persist purchase proof without exposing it publicly', async t => {
  const state = setup(t);
  const result = await request(reviewPath(), { method: 'POST', body });
  assert.equal(result.status, 201, result.body.message);
  assert.equal(result.body.review.comment, body.comment.trim()); assert.equal(result.body.review.version, 0);
  assert.equal(result.body.rating, 5); assert.equal(result.body.numReviews, 1);
  assert.equal(state.product.reviews[0].name, 'Buyer A'); assert.equal(String(state.product.reviews[0].user), ids.buyer);
  assert.equal(String(state.product.reviews[0].order), ids.order);
  const published = await request(`/api/products/${ids.product}/reviews`);
  assert.equal(published.status, 200); assert.equal(published.body.reviews.length, 1);
  assert.equal(published.body.reviews[0].comment, body.comment.trim());
  for (const field of ['order', 'version']) assert.equal(field in published.body.reviews[0], false);
  assert.equal((await request(`/api/products/${ids.product}`)).body.reviews[0].order, undefined);
});

test('order review reads deduplicate color/size lines and disclose only the current customer review', async t => {
  const state = setup(t);
  await request(reviewPath(), { method: 'POST', body });
  state.product.reviews.push({ _id: new mongoose.Types.ObjectId(), user: ids.other, name: 'Other', rating: 1, comment: 'Private to the other owner API' });
  state.orders[0].orderItems.push({ product: ids.product, color: 'Black', size: 41 });
  state.orders[0].orderItems.push({ product: ids.unbought });
  const result = await request(`/api/orders/${ids.order}/reviews`);
  assert.equal(result.status, 200); assert.equal(result.body.products.length, 2);
  assert.equal(result.body.products[0].review.comment, body.comment.trim());
  assert.equal(JSON.stringify(result.body).includes('Private to the other'), false);
  assert.deepEqual(result.body.products[1], { productId: ids.unbought, available: false, review: null });
});

test('buying a product in multiple delivered orders still permits just one review per customer', async t => {
  const state = setup(t);
  state.orders.push(orderOf({ _id: ids.otherOrder }));
  assert.equal((await request(reviewPath(), { method: 'POST', body })).status, 201);
  assert.equal((await request(reviewPath(ids.otherOrder), { method: 'POST', body })).status, 409);
  assert.equal(state.product.reviews.length, 1); assert.equal(state.product.numReviews, 1);
});

test('editing an own review changes the average without creating another review', async t => {
  const state = setup(t);
  state.product.reviews = [{ _id: new mongoose.Types.ObjectId(), user: ids.other, name: 'Other', rating: 4, comment: 'Other customer' }];
  state.product.rating = 4; state.product.numReviews = 1;
  assert.equal((await request(reviewPath(), { method: 'POST', body })).status, 201);
  const result = await request(reviewPath(), { method: 'PUT', body: { rating: 2, comment: 'Updated experience', expectedVersion: 0 } });
  assert.equal(result.status, 200, result.body.message); assert.equal(result.body.rating, 3); assert.equal(result.body.numReviews, 2);
  assert.equal(result.body.review.version, 1); assert.equal(result.body.review.comment, 'Updated experience');
  assert.equal(state.product.reviews[0].comment, 'Other customer');
  assert.equal((await request(reviewPath(), { method: 'PUT', body: { rating: 1, comment: 'Stale tab', expectedVersion: 0 } })).status, 409);
  assert.equal(state.product.rating, 3);
});

test('legacy reviews without a version or order link remain editable from a valid delivered order', async t => {
  const state = setup(t);
  state.product.reviews = [{ _id: new mongoose.Types.ObjectId(), user: ids.buyer, name: 'Old name', rating: 4, comment: 'Legacy' }];
  state.product.rating = 4; state.product.numReviews = 1;
  const result = await request(reviewPath(), { method: 'PUT', body: { rating: 3, comment: 'Edited legacy', expectedVersion: 0 } });
  assert.equal(result.status, 200, result.body.message); assert.equal(result.body.review.version, 1);
  assert.equal(String(state.product.reviews[0].order), ids.order);
});

test('editing requires a review version and never creates a missing review', async t => {
  const state = setup(t);
  for (const expectedVersion of [undefined, null, -1, 0.5, '0', true]) assert.equal((await request(reviewPath(), { method: 'PUT', body: { ...body, expectedVersion } })).status, 400);
  assert.equal((await request(reviewPath(), { method: 'PUT', body: { ...body, expectedVersion: 0 } })).status, 404);
  assert.equal(state.updates.length, 0);
});

test('simultaneous duplicate submissions produce a single review and a conflict', async t => {
  const state = setup(t); pauseTwoReads(state);
  const results = await Promise.all([request(reviewPath(), { method: 'POST', body }), request(reviewPath(), { method: 'POST', body })]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(state.product.reviews.length, 1); assert.equal(state.product.rating, 5); assert.equal(state.product.numReviews, 1);
});

test('concurrent reviews by different buyers cannot erase each other and can retry after a conflict', async t => {
  const state = setup(t); pauseTwoReads(state);
  state.orders.push(orderOf({ _id: ids.otherOrder, user: ids.other }));
  const attempts = [{ path: reviewPath(), options: { method: 'POST', body } }, { path: reviewPath(ids.otherOrder), options: { method: 'POST', body: { rating: 3, comment: 'Second buyer' }, user: ids.other } }];
  const results = await Promise.all(attempts.map(({ path, options }) => request(path, options)));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const retry = attempts[results.findIndex(result => result.status === 409)];
  state.readGate = null;
  assert.equal((await request(retry.path, retry.options)).status, 201);
  assert.equal(state.product.reviews.length, 2); assert.equal(state.product.numReviews, 2); assert.equal(state.product.rating, 4);
});

test('two simultaneous edits of the same review cannot overwrite the first accepted version', async t => {
  const state = setup(t);
  assert.equal((await request(reviewPath(), { method: 'POST', body })).status, 201);
  pauseTwoReads(state);
  const results = await Promise.all([2, 3].map(rating => request(reviewPath(), { method: 'PUT', body: { rating, comment: `Edited to ${rating}`, expectedVersion: 0 } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const accepted = results.find(result => result.status === 200).body.review;
  assert.equal(state.product.reviews.length, 1); assert.equal(state.product.numReviews, 1);
  assert.equal(state.product.rating, accepted.rating); assert.equal(state.product.reviews[0].version, 1);
});

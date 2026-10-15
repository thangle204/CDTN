import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import { addOrderItems, cancelOrder, updatePaymentStatus } from '../controllers/orderController.js';

const id = () => new mongoose.Types.ObjectId();
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const queryOf = value => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ['populate', 'sort', 'limit', 'select']) query[method] = () => query;
  return query;
};
const matches = (record, filter) => record && Object.entries(filter).every(([field, value]) => {
  const actual = field.split('.').reduce((current, key) => current?.[key], record);
  if (value && typeof value === 'object') {
    if ('$ne' in value) return actual !== value.$ne;
    if ('$nin' in value) return !value.$nin.includes(actual);
    if ('$exists' in value) return (actual !== undefined) === value.$exists;
  }
  return String(actual ?? null) === String(value);
});
const shippingAddress = { name: 'Checkout tester', address: 'Test street', city: 'Test city', phone: '0901234567' };
const secret = 'checkout-publication-offline-tests-only';
let server;
let baseUrl;
let originalReadyState;
const originalSecret = process.env.JWT_SECRET;

before(async () => {
  process.env.JWT_SECRET = secret;
  originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });
  server = createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalReadyState) Object.defineProperty(mongoose.connection, 'readyState', originalReadyState);
  else delete mongoose.connection.readyState;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const setup = (t, options = {}) => {
  const ownerId = id();
  const productId = id();
  const product = { _id: productId, __v: 0, name: 'Test sneaker', image: '/shoe.jpg', brand: 'Test', category: 'Sneaker', description: 'Test shoe', price: 200000, sizes: [40], color: 'Trắng', countInStock: 5, variants: [{ color: 'Trắng', size: 40, quantity: 5 }], checkoutReservations: [] };
  const customer = { _id: ownerId, name: 'Tester', authVersion: 0, isActive: true, checkoutLock: null, cart: [{ _id: id(), product: productId, name: 'Old cart snapshot', image: '/old.jpg', price: 1, quantity: 1, size: 40, color: 'Trắng' }] };
  const originalCart = customer.cart.map(item => ({ ...item }));
  const orders = new Map();
  const hooks = {};
  const events = [];
  const deleted = [];
  let releases = 0;
  const snapshot = record => record ? new Order(record) : null;
  t.mock.method(Customer, 'findById', () => queryOf({ _id: ownerId, isAdmin: true, isActive: true, authVersion: 0 }));
  t.mock.method(Customer, 'findOneAndUpdate', async (_filter, update) => {
    if (customer.checkoutLock) return null;
    customer.checkoutLock = update.$set.checkoutLock;
    return { ...customer, cart: customer.cart.map(item => ({ ...item })) };
  });
  t.mock.method(Customer, 'updateOne', async (filter, update) => {
    if (filter['checkoutLock.token'] !== customer.checkoutLock?.token) return { matchedCount: 0 };
    const clearing = update.$set?.cart?.length === 0;
    if (clearing && hooks.beforeClear) await hooks.beforeClear();
    if (clearing) events.push('clear-cart');
    if (update.$set?.cart) customer.cart = update.$set.cart.map(item => ({ ...item }));
    if (clearing && options.clearAcknowledgementFails) throw new Error('Cart clear acknowledgement failed');
    if (Object.hasOwn(update.$set || {}, 'checkoutLock')) {
      if (options.unlockFails) throw new Error('Customer unlock failed');
      events.push('unlock');
      customer.checkoutLock = update.$set.checkoutLock;
    }
    if (update.$set?.['checkoutLock.expiresAt']) customer.checkoutLock.expiresAt = update.$set['checkoutLock.expiresAt'];
    if (update.$set?.['checkoutLock.recoveryRequired']) customer.checkoutLock.recoveryRequired = true;
    return { matchedCount: 1 };
  });
  t.mock.method(Product, 'find', async () => [new Product(product)]);
  t.mock.method(Product, 'findOneAndUpdate', async (filter, update) => {
    if (filter.__v !== product.__v || product.countInStock < filter.countInStock.$gte) return null;
    product.countInStock += update.$inc.countInStock;
    product.variants[0].quantity += update.$inc['variants.$.quantity'];
    product.__v += update.$inc.__v;
    product.checkoutReservations = [...new Set([...product.checkoutReservations, update.$addToSet.checkoutReservations])];
    events.push('reserve');
    return new Product(product);
  });
  t.mock.method(Product, 'updateOne', async (_filter, update) => {
    if (update.$pull?.checkoutReservations) {
      releases += 1;
      if (options.releaseFails) throw new Error('Reservation release failed');
      product.checkoutReservations = product.checkoutReservations.filter(token => token !== update.$pull.checkoutReservations);
      product.__v += update.$inc.__v;
      events.push('release-hold');
    } else {
      if (options.stockRollbackFails) throw new Error('Stock rollback failed');
      product.countInStock += update.$inc.countInStock;
      product.variants[0].quantity += update.$inc['variants.$.quantity'];
      product.__v += update.$inc.__v;
      events.push('restore-stock');
    }
    return { matchedCount: 1 };
  });
  t.mock.method(Order.prototype, 'save', async function () {
    await this.validate();
    if (options.saveFailsBeforeWrite) throw new Error('Pending save acknowledgement is unresolved');
    this.isNew = false;
    orders.set(String(this._id), this.toObject());
    events.push('save-pending');
    if (hooks.afterSave) await hooks.afterSave(this);
    if (options.saveFailsAfterWrite) throw new Error('Pending save acknowledgement failed after write');
    return this;
  });
  t.mock.method(Order, 'findById', value => queryOf(snapshot(orders.get(String(value)))));
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    const record = orders.get(String(filter._id));
    const committing = update.$set?.checkoutState === 'committed';
    if (committing && options.commitFails) return null;
    if (committing && hooks.beforeCommit) await hooks.beforeCommit(record);
    if (!matches(record, filter)) return null;
    Object.assign(record, update.$set);
    record.__v = (record.__v || 0) + (update.$inc?.__v || 0);
    if (committing) {
      events.push('commit');
      if (options.commitAcknowledgementFails) throw new Error('Commit acknowledgement failed after write');
    }
    return snapshot(record);
  });
  t.mock.method(Order, 'deleteOne', async filter => {
    deleted.push(filter);
    const record = orders.get(String(filter._id));
    if (!matches(record, filter)) return { deletedCount: 0 };
    orders.delete(String(filter._id));
    events.push('delete-pending');
    return { deletedCount: 1 };
  });
  t.mock.method(Order, 'find', filter => queryOf([...orders.values()].filter(record => matches(record, filter || {})).map(snapshot)));
  t.mock.method(Order, 'countDocuments', async filter => [...orders.values()].filter(record => matches(record, filter || {})).length);
  t.mock.method(Customer, 'countDocuments', async () => 1);
  t.mock.method(Order, 'aggregate', async pipeline => {
    assert.deepEqual(pipeline[0].$match.checkoutState, { $ne: 'pending' });
    const selected = [...orders.values()].filter(record => matches(record, pipeline[0].$match));
    assert.equal(selected.length, 0, 'The reporting case only contains an unpublished order');
    return [];
  });
  const request = async (method, path, body) => {
    const token = jwt.sign({ id: String(ownerId), accountType: 'customer', authVersion: 0 }, secret);
    const result = await fetch(baseUrl + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, body: await result.json() };
  };
  const checkoutRequest = { accountType: 'customer', user: { _id: ownerId, authVersion: 0, isAdmin: false }, body: { paymentMethod: 'BANK', shippingAddress, expectedTotalPrice: 230000, expectedCart: [{ product: String(productId), color: 'Trắng', size: 40, quantity: 1 }] } };
  return { product, customer, originalCart, orders, hooks, events, deleted, releases: () => releases, request, checkoutRequest };
};

test('pending orders are hidden from HTTP lists/reports and every order mutation returns 409', async t => {
  const state = setup(t);
  state.hooks.afterSave = async order => {
    for (const path of ['/api/orders', '/api/orders/myorders', '/api/orders/stats/revenue', '/api/orders/stats/top-customers']) {
      const result = await state.request('GET', path);
      assert.equal(result.status, 200, path);
      assert.deepEqual(result.body, [], path);
    }
    const overview = await state.request('GET', '/api/orders/stats/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.totalOrders, 0);
    assert.equal(overview.body.totalRevenue, 0);
    assert.deepEqual(overview.body.ordersByStatus, []);
    assert.deepEqual(overview.body.recentOrders, []);
    assert.equal((await state.request('GET', `/api/orders/${order._id}`)).status, 409);
    for (const [method, suffix, body] of [
      ['PUT', 'payment', { isPaid: true }], ['PUT', 'cancel'], ['PUT', 'status', { orderStatus: 'Đã xác nhận' }],
      ['PUT', 'status', { orderStatus: 'Đã hủy' }], ['PUT', 'deliver'], ['PUT', 'refund'], ['DELETE', ''],
    ]) assert.equal((await state.request(method, `/api/orders/${order._id}${suffix ? '/' + suffix : ''}`, body)).status, 409, suffix);
    assert.equal(state.product.countInStock, 4);
    assert.equal(state.orders.size, 1);
    assert.equal([...state.orders.values()][0].isPaid, false);
  };
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 201);
  assert.equal(Object.hasOwn(result.body, 'checkoutToken'), false);
  assert.equal(Object.hasOwn(result.body, 'checkoutState'), false);
  assert.deepEqual(state.events, ['reserve', 'save-pending', 'clear-cart', 'commit', 'release-hold', 'unlock']);
  assert.equal(state.customer.checkoutLock, null);
  assert.deepEqual(state.product.checkoutReservations, []);
});

test('payment and cancellation during cart-clear failure cannot mutate or double-restore the pending order', async t => {
  const state = setup(t);
  state.hooks.beforeClear = async () => {
    const order = [...state.orders.values()][0];
    const payment = response();
    const cancellation = response();
    await updatePaymentStatus({ user: { isAdmin: true }, params: { id: String(order._id) }, body: { isPaid: true } }, payment);
    await cancelOrder({ user: state.checkoutRequest.user, params: { id: String(order._id) } }, cancellation);
    assert.equal(payment.statusCode, 409);
    assert.equal(cancellation.statusCode, 409);
    throw new Error('Cart clear failed before writing');
  };
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 500);
  assert.equal(state.orders.size, 0);
  assert.equal(state.product.countInStock, 5);
  assert.equal(state.product.variants[0].quantity, 5);
  assert.deepEqual(state.customer.cart, state.originalCart);
  assert.equal(state.customer.checkoutLock, null);
  assert.deepEqual(state.product.checkoutReservations, []);
  assert.equal(state.events.filter(event => event === 'restore-stock').length, 1);
});

test('commit failure restores the exact original cart before releasing stock protection', async t => {
  const state = setup(t, { commitFails: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 409);
  assert.equal(state.orders.size, 0);
  assert.deepEqual(state.customer.cart, state.originalCart);
  assert.equal(state.product.countInStock, 5);
  assert.deepEqual(state.product.checkoutReservations, []);
  assert.equal(state.customer.checkoutLock, null);
});

test('an applied cart clear with a failed acknowledgement still restores the original snapshot', async t => {
  const state = setup(t, { clearAcknowledgementFails: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 500);
  assert.equal(state.orders.size, 0);
  assert.deepEqual(state.customer.cart, state.originalCart);
  assert.equal(state.product.countInStock, 5);
  assert.equal(state.customer.checkoutLock, null);
});

test('an owned pending write with lost acknowledgement is conditionally removed before compensation', async t => {
  const state = setup(t, { saveFailsAfterWrite: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 500);
  assert.equal(state.orders.size, 0);
  assert.equal(state.product.countInStock, 5);
  assert.equal(state.deleted[0].checkoutState, 'pending');
  assert.equal(state.deleted[0].isPaid, false);
  assert.equal(state.deleted[0].checkoutToken.length, 36);
  assert.equal(state.customer.checkoutLock, null);
});

test('an unresolved attempted save with no owned pending deletion keeps stock and holds for recovery', async t => {
  const state = setup(t, { saveFailsBeforeWrite: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 503);
  assert.equal(state.orders.size, 0);
  assert.equal(state.product.countInStock, 4);
  assert.equal(state.product.checkoutReservations.length, 1);
  assert.equal(state.customer.checkoutLock.recoveryRequired, true);
  assert.equal(state.releases(), 0);
  assert.deepEqual(state.customer.cart, state.originalCart);
});

test('conditional rollback never deletes a paid or already-restored conflicting order', async t => {
  for (const conflict of ['paid', 'restored', 'different-owner']) {
    const state = setup(t);
    state.hooks.beforeClear = async () => {
      const order = [...state.orders.values()][0];
      if (conflict === 'paid') order.isPaid = true;
      else if (conflict === 'restored') {
        order.orderStatus = 'Đã hủy'; order.stockRestored = true;
        state.product.countInStock = 5; state.product.variants[0].quantity = 5;
      } else order.checkoutToken = 'different-checkout-owner';
      throw new Error('Cart write failed after an unexpected external order change');
    };
    const result = response();
    await addOrderItems(state.checkoutRequest, result);
    assert.equal(result.statusCode, 503, conflict);
    assert.equal(state.orders.size, 1, conflict);
    assert.equal(state.product.countInStock, conflict === 'restored' ? 5 : 4, conflict);
    assert.equal(state.product.checkoutReservations.length, 1, conflict);
    assert.equal(state.customer.checkoutLock.recoveryRequired, true, conflict);
    assert.equal(state.releases(), 0, conflict);
  }
});

test('read-back of an owned committed order resolves a lost commit acknowledgement without compensating', async t => {
  const state = setup(t, { commitAcknowledgementFails: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 201);
  assert.equal(state.orders.size, 1);
  assert.equal([...state.orders.values()][0].checkoutState, 'committed');
  assert.equal(state.product.countInStock, 4);
  assert.deepEqual(state.product.checkoutReservations, []);
  assert.deepEqual(state.customer.cart, []);
  assert.equal(state.customer.checkoutLock, null);
  assert.equal(state.events.includes('restore-stock'), false);
});

test('reservation release failure after a durable commit preserves the order and marks recovery', async t => {
  const state = setup(t, { releaseFails: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 201);
  assert.equal(state.orders.size, 1);
  assert.equal([...state.orders.values()][0].checkoutState, 'committed');
  assert.equal(state.product.countInStock, 4);
  assert.equal(state.product.checkoutReservations.length, 1);
  assert.deepEqual(state.customer.cart, []);
  assert.equal(state.customer.checkoutLock.recoveryRequired, true);
  assert.equal(state.deleted.length, 0);
});

test('customer unlock failure after commit never removes the order or restores its reserved stock', async t => {
  const state = setup(t, { unlockFails: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 201);
  assert.equal(state.orders.size, 1);
  assert.equal(state.product.countInStock, 4);
  assert.deepEqual(state.product.checkoutReservations, []);
  assert.deepEqual(state.customer.cart, []);
  assert.equal(state.customer.checkoutLock.recoveryRequired, true);
  assert.equal(state.deleted.length, 0);
});

test('failed stock compensation retains every hold and its customer recovery lock', async t => {
  const state = setup(t, { commitFails: true, stockRollbackFails: true });
  const result = response();
  await addOrderItems(state.checkoutRequest, result);
  assert.equal(result.statusCode, 503);
  assert.equal(state.product.countInStock, 4);
  assert.equal(state.product.checkoutReservations.length, 1);
  assert.equal(state.releases(), 0);
  assert.equal(state.customer.checkoutLock.recoveryRequired, true);
});

test('legacy orders missing publication fields remain readable and payable without leaking internal fields', async t => {
  const state = setup(t);
  const legacy = new Order({ _id: id(), user: state.customer._id, shippingAddress, paymentMethod: 'BANK', totalPrice: 230000, orderItems: [{ product: state.product._id, name: 'Legacy shoe', image: '/shoe.jpg', price: 200000, quantity: 1, size: 40 }] }).toObject();
  delete legacy.checkoutState;
  delete legacy.checkoutToken;
  state.orders.set(String(legacy._id), legacy);
  const list = await state.request('GET', '/api/orders/myorders');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(Object.hasOwn(list.body[0], 'checkoutState'), false);
  assert.equal(Object.hasOwn(list.body[0], 'checkoutToken'), false);
  const payment = await state.request('PUT', `/api/orders/${legacy._id}/payment`, { isPaid: true });
  assert.equal(payment.status, 200);
  assert.equal(payment.body.isPaid, true);
  assert.equal(Object.hasOwn(payment.body, 'checkoutToken'), false);
});

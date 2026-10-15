import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { createApp } from '../app.js';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import Product from '../models/productModel.js';
import AdminGuard from '../models/adminGuardModel.js';
import { assertCartStock, assertCartUnlocked, findCartItem } from '../utils/cart.js';
import { normalizeEmail, normalizePhone, normalizeSize, positiveQuantity, validatePassword } from '../utils/validation.js';

// Every database/email operation in these tests is replaced with a local stub.
const secret = 'customer-api-test-secret-only';
const customerId = '000000000000000000000001';
const productId = '000000000000000000000002';
const staffId = '000000000000000000000003';
const otherCustomerId = '000000000000000000000004';
let databaseState = 1;
let server;
let baseUrl;
let originalReadyState;
const envKeys = ['JWT_SECRET', 'SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'FRONTEND_URL'];
const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

const queryOf = (value) => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ['select', 'populate', 'sort', 'lean']) query[method] = () => query;
  return query;
};
const token = (id = customerId, claims = {}) => jwt.sign({ id, authVersion: 0, accountType: 'customer', ...claims }, secret);
const request = async (path, { method = 'GET', body, authorization, raw } = {}) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : raw !== undefined ? { body: raw } : {}),
  });
  return { status: response.status, body: await response.json() };
};
const sessionUser = (overrides = {}) => ({ _id: customerId, email: 'shopper@example.test', name: 'Shopper', phone: '0901234567', isAdmin: false, isActive: true, authVersion: 0, ...overrides });
const installUser = (t, user = sessionUser(), Model = Customer) => {
  t.mock.method(Model, 'findById', () => queryOf(user));
  return user;
};
const assertBadRequest = (callback) => assert.throws(callback, error => error.status === 400);

before(async () => {
  process.env.JWT_SECRET = secret;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => databaseState });
  server = createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalReadyState) Object.defineProperty(mongoose.connection, 'readyState', originalReadyState);
  else delete mongoose.connection.readyState;
  for (const key of envKeys) oldEnv[key] === undefined ? delete process.env[key] : process.env[key] = oldEnv[key];
});

test('validation normalizes email/phone while rejecting invalid quantity, size and password types', () => {
  assert.equal(normalizeEmail('  Shopper@Example.Test '), 'shopper@example.test');
  assert.equal(normalizePhone(' 0901234567 '), '0901234567');
  assert.equal(positiveQuantity('2'), 2);
  assert.equal(normalizeSize('38.5', [38, 38.5]), 38.5);
  for (const value of [0, -1, 1.5, '', true, [], {}, Number.MAX_SAFE_INTEGER + 1]) assertBadRequest(() => positiveQuantity(value));
  for (const value of [true, [40], {}, 0, 61, 38.25]) assertBadRequest(() => normalizeSize(value, [1, 40]));
  assertBadRequest(() => normalizeSize(undefined, [40]));
  assertBadRequest(() => normalizeSize(39, [40]));
  assertBadRequest(() => normalizeEmail('shopper@example'));
  assertBadRequest(() => normalizePhone('1234567890'));
  for (const value of ['short', '      ', 'é'.repeat(37), true]) assertBadRequest(() => validatePassword(value));
  assert.equal(validatePassword('é'.repeat(36)), 'é'.repeat(36));
});

test('cart helpers distinguish sizes, reject ambiguous legacy updates and count stock across variants', () => {
  const cart = [{ _id: 'line-38', product: productId, size: 38, quantity: 2 }, { _id: 'line-39', product: { _id: productId }, size: 39, quantity: 1 }];
  assert.equal(findCartItem(cart, { cartItemId: 'line-39' }), cart[1]);
  assert.equal(findCartItem(cart, { productId, size: 38 }), cart[0]);
  assertBadRequest(() => findCartItem(cart, { productId }));
  assert.equal(findCartItem(cart, { productId, size: 40 }), undefined);
  const product = { _id: productId, name: 'Test shoe', countInStock: 3 };
  assert.doesNotThrow(() => assertCartStock(cart, product, 2, 'line-38'));
  assertBadRequest(() => assertCartStock(cart, product, 3, 'line-38'));
  assert.throws(() => assertCartUnlocked({ checkoutLock: { token: 'busy', expiresAt: new Date(Date.now() + 60000) } }), error => error.status === 409);
  assert.throws(() => assertCartUnlocked({ checkoutLock: { token: 'recovery', expiresAt: new Date(0), recoveryRequired: true } }), error => error.status === 409);
  assert.doesNotThrow(() => assertCartUnlocked({ checkoutLock: { token: 'expired', expiresAt: new Date(0) } }));
});

test('customer schema rejects invalid phone, fractional cart quantity and invalid shoe sizes offline', async () => {
  const base = { email: 'shopper@example.test', password: 'test-password', phone: '0901234567' };
  const cartRow = { product: productId, name: 'Test shoe', image: '/shoe.svg', price: 200000, quantity: 1, size: 38 };
  for (const overrides of [{ phone: '1234567890' }, { authVersion: -1 }, { cart: [{ ...cartRow, quantity: 1.5 }] }, { cart: [{ ...cartRow, quantity: 0 }] }, { cart: [{ ...cartRow, size: 38.25 }] }, { cart: [{ ...cartRow, price: -1 }] }]) {
    await assert.rejects(new Customer({ ...base, ...overrides }).validate(), error => error.name === 'ValidationError');
  }
  await new Customer({ ...base, cart: [{ ...cartRow, size: 38.5 }] }).validate();
});

test('cart endpoints preserve separate sizes and cannot exceed shared stock', async (t) => {
  const product = { _id: productId, name: 'Test shoe', image: '/shoe.svg', price: 200000, sizes: [38, 39], countInStock: 3, isHidden: false };
  const customer = sessionUser({ cart: [], save: async () => customer, populate: async () => {
    customer.cart.forEach((item, index) => {
      item._id ??= `line-${index}`;
      item.product = product;
      item.toObject = () => ({ _id: item._id, product, name: item.name, image: item.image, price: item.price, size: item.size, quantity: item.quantity });
    });
    return customer;
  } });
  installUser(t, customer);
  t.mock.method(Product, 'findById', async () => product);
  const auth = token();
  for (const size of [38, 39, 38]) {
    const result = await request('/api/customers/cart', { method: 'POST', authorization: auth, body: { productId, size, quantity: 1 } });
    assert.equal(result.status, 201);
  }
  assert.equal(customer.cart.length, 2);
  assert.deepEqual(customer.cart.map(row => [row.size, row.quantity]), [[38, 2], [39, 1]]);
  const rejected = await request('/api/customers/cart', { method: 'POST', authorization: auth, body: { productId, size: 39, quantity: 1 } });
  assert.equal(rejected.status, 400);
  assert.equal(customer.cart[1].quantity, 1);
  const ambiguous = await request('/api/customers/cart', { method: 'PUT', authorization: auth, body: { productId, quantity: 1 } });
  assert.equal(ambiguous.status, 400);
  const overstock = await request('/api/customers/cart', { method: 'PUT', authorization: auth, body: { cartItemId: 'line-1', quantity: 2 } });
  assert.equal(overstock.status, 400);
  const reduced = await request('/api/customers/cart', { method: 'PUT', authorization: auth, body: { cartItemId: 'line-0', quantity: 1, price: 1 } });
  assert.equal(reduced.status, 200);
  assert.equal(reduced.body[0].quantity, 1);
  assert.equal(reduced.body[0].price, product.price);
  const removed = await request('/api/customers/cart/line-0', { method: 'DELETE', authorization: auth });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.length, 1);
  assert.equal(removed.body[0].size, 39);
});

test('cart mutation refuses active and expired recovery locks before querying products or saving', async (t) => {
  const customer = installUser(t, sessionUser({ cart: [], checkoutLock: { token: 'checkout', expiresAt: new Date(Date.now() + 60000) } }));
  const productLookup = t.mock.method(Product, 'findById', () => { throw new Error('Unexpected database lookup'); });
  const result = await request('/api/customers/cart', { method: 'POST', authorization: token(), body: { productId, size: 38, quantity: 1 } });
  assert.equal(result.status, 409);
  customer.checkoutLock = { token: 'recovery', expiresAt: new Date(0), recoveryRequired: true };
  const recovery = await request('/api/customers/cart', { method: 'POST', authorization: token(), body: { productId, size: 38, quantity: 1 } });
  assert.equal(recovery.status, 409);
  assert.equal(productLookup.mock.callCount(), 0);
});

test('cart endpoints separate colors at the same size and never borrow another variant stock', async (t) => {
  const product = { _id: productId, name: 'Test shoe', image: '/shoe.svg', price: 200000, sizes: [40], countInStock: 12, variants: [
    { color: 'Trắng', size: 40, quantity: 2 }, { color: 'Đen', size: 40, quantity: 10 },
  ] };
  const customer = sessionUser({ cart: [], save: async () => customer, populate: async () => {
    customer.cart.forEach((item, index) => {
      item._id ??= `variant-${index}`;
      item.product = product;
      item.toObject = () => ({ _id: item._id, product, name: item.name, image: item.image, price: item.price, size: item.size, color: item.color, quantity: item.quantity });
    });
    return customer;
  } });
  installUser(t, customer);
  t.mock.method(Product, 'findById', async () => product);
  const call = (method, body) => request('/api/customers/cart', { method, authorization: token(), body: { productId, size: 40, ...body } });
  assert.equal((await call('POST', { quantity: 1 })).status, 400);
  assert.equal((await call('POST', { color: 'Trắng', quantity: 1 })).status, 201);
  assert.equal((await call('POST', { color: ' trắng ', quantity: 1 })).status, 201);
  assert.equal((await call('POST', { color: 'Đen', quantity: 4 })).status, 201);
  assert.deepEqual(customer.cart.map((row) => [row.color, row.quantity]), [['Trắng', 2], ['Đen', 4]]);
  assert.equal((await call('POST', { color: 'Trắng', quantity: 1 })).status, 400);
  assert.equal((await call('PUT', { quantity: 1 })).status, 400);
  assert.equal((await call('PUT', { color: 'Trắng', quantity: 3 })).status, 400);
  const updated = await call('PUT', { color: 'TRẮNG', quantity: 1 });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.map((row) => [row.color, row.quantity]), [['Trắng', 1], ['Đen', 4]]);
});

test('customer/staff endpoint permissions block unauthenticated shoppers and non-admin registration', async (t) => {
  installUser(t);
  installUser(t, sessionUser({ _id: staffId }), Staff);
  for (const [path, method, auth, expected] of [
    ['/api/customers/profile', 'GET', undefined, 401],
    ['/api/customers/all', 'GET', token(), 403],
    ['/api/staff', 'POST', undefined, 401],
    ['/api/staff', 'POST', token(), 403],
    ['/api/customers/cart', 'GET', token(staffId, { accountType: 'staff' }), 403],
    ['/api/customers/profile', 'GET', token(staffId, { accountType: 'staff' }), 403],
  ]) {
    const result = await request(path, { method, authorization: auth, ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(result.status, expected, `${method} ${path}`);
  }
});

test('session revocation rejects old versions and inactive accounts but accepts the current version', async (t) => {
  const customer = installUser(t, sessionUser({ authVersion: 2 }));
  assert.equal((await request('/api/customers/profile', { authorization: token() })).status, 401);
  assert.equal((await request('/api/customers/profile', { authorization: token(customerId, { authVersion: 2 }) })).status, 200);
  customer.isActive = false;
  assert.equal((await request('/api/customers/profile', { authorization: token(customerId, { authVersion: 2 }) })).status, 401);
  assert.equal((await request('/api/customers/profile', { authorization: token(customerId, { accountType: 'unsupported' }) })).status, 401);
});

test('admin cannot demote itself or the final active administrator', async (t) => {
  t.mock.method(AdminGuard, 'findOneAndUpdate', async () => ({ _id: 'admin-role-changes' }));
  t.mock.method(AdminGuard, 'updateOne', async () => ({ matchedCount: 1 }));
  const admin = sessionUser({ isAdmin: true });
  const target = sessionUser({ _id: otherCustomerId, isAdmin: true, save: async () => { throw new Error('Must not save'); } });
  t.mock.method(Customer, 'findById', id => queryOf(String(id) === customerId ? admin : target));
  t.mock.method(Customer, 'countDocuments', async () => 1);
  t.mock.method(Staff, 'countDocuments', async () => 0);
  const self = await request(`/api/customers/${customerId}/toggle-admin`, { method: 'PUT', authorization: token(), body: {} });
  assert.equal(self.status, 400);
  const final = await request(`/api/customers/${otherCustomerId}/toggle-admin`, { method: 'PUT', authorization: token(), body: {} });
  assert.equal(final.status, 400);
  assert.equal(target.isAdmin, true);
});

test('admin password change revokes the edited customer session and never returns password/reset fields', async (t) => {
  const admin = sessionUser({ isAdmin: true });
  const target = sessionUser({ _id: otherCustomerId, password: 'previous-test-password', resetPasswordToken: 'old-reset-hash', resetPasswordExpires: new Date(), save: async () => target });
  t.mock.method(Customer, 'findById', id => queryOf(String(id) === customerId ? admin : target));
  const changed = await request(`/api/customers/${otherCustomerId}/update-info`, { method: 'PUT', authorization: token(), body: { password: 'new-test-password' } });
  assert.equal(changed.status, 200);
  assert.equal(target.authVersion, 1);
  assert.equal(target.resetPasswordToken, undefined);
  assert.equal(target.resetPasswordExpires, undefined);
  assert.equal('password' in changed.body, false);
  assert.equal('resetPasswordToken' in changed.body, false);
  assert.equal((await request('/api/customers/profile', { authorization: token(otherCustomerId) })).status, 401);
});

test('profile password changes require the current password and return a token with the new session version', async (t) => {
  let saved = 0;
  const customer = installUser(t, sessionUser({
    matchPassword: async password => password === 'current-test-password',
    save: async () => { saved++; return customer; },
  }));
  const rejected = await request('/api/customers/profile', { method: 'PUT', authorization: token(), body: { currentPassword: 'wrong-password', newPassword: 'new-test-password' } });
  assert.equal(rejected.status, 400);
  assert.equal(saved, 0);
  const changed = await request('/api/customers/profile', { method: 'PUT', authorization: token(), body: { currentPassword: 'current-test-password', newPassword: 'new-test-password' } });
  assert.equal(changed.status, 200);
  assert.equal(saved, 1);
  assert.equal(jwt.verify(changed.body.token, secret).authVersion, 1);
  assert.equal('password' in changed.body, false);
  assert.equal((await request('/api/customers/profile', { authorization: token() })).status, 401);
  assert.equal((await request('/api/customers/profile', { authorization: changed.body.token })).status, 200);
});

test('forgot-password without SMTP returns unavailable instead of pretending an email was sent', async (t) => {
  const lookup = t.mock.method(Customer, 'findOne', () => { throw new Error('SMTP must be checked first'); });
  const transport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('No actual transport allowed'); });
  const result = await request('/api/customers/forgot-password', { method: 'POST', body: { email: 'shopper@example.test' } });
  assert.equal(result.status, 503);
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(transport.mock.callCount(), 0);
});

test('forgot-password stores a short-lived hash, hides the token and clears it if mocked delivery fails', async (t) => {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_FROM = 'store@example.test';
  process.env.FRONTEND_URL = 'https://shop.example.test';
  t.after(() => { delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; delete process.env.FRONTEND_URL; });
  const customer = sessionUser({ save: async () => customer });
  t.mock.method(Customer, 'findOne', async () => customer);
  let email;
  let failDelivery = false;
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async message => { email = message; if (failDelivery) throw new Error('PRIVATE_SMTP_FAILURE'); } }));
  let cleared;
  t.mock.method(Customer, 'updateOne', async (filter, update) => { cleared = { filter, update }; return { modifiedCount: 1 }; });
  const successful = await request('/api/customers/forgot-password', { method: 'POST', body: { email: customer.email } });
  assert.equal(successful.status, 200);
  const resetToken = /reset-password\/([a-f0-9]{64})/.exec(email.text)[1];
  assert.equal(customer.resetPasswordToken, crypto.createHash('sha256').update(resetToken).digest('hex'));
  assert.ok(customer.resetPasswordExpires > new Date());
  assert.ok(customer.resetPasswordExpires <= new Date(Date.now() + 15 * 60000));
  assert.ok(!JSON.stringify(successful.body).includes(resetToken));
  failDelivery = true;
  const failed = await request('/api/customers/forgot-password', { method: 'POST', body: { email: customer.email } });
  assert.equal(failed.status, 503);
  assert.equal(cleared.filter.resetPasswordToken, customer.resetPasswordToken);
  assert.deepEqual(cleared.update.$unset, { resetPasswordToken: '', resetPasswordExpires: '' });
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_SMTP_FAILURE'));
});

test('password reset hashes the new password, consumes the token once and increments authVersion atomically', async (t) => {
  const resetToken = 'a'.repeat(64);
  let consumed = false;
  let recorded;
  t.mock.method(Customer, 'findOneAndUpdate', async (filter, update, options) => {
    recorded = { filter, update, options };
    if (consumed) return null;
    consumed = true;
    return sessionUser({ authVersion: 1 });
  });
  const result = await request(`/api/customers/reset-password/${resetToken}`, { method: 'POST', body: { password: 'new-test-password' } });
  assert.equal(result.status, 200);
  assert.equal(recorded.filter.resetPasswordToken, crypto.createHash('sha256').update(resetToken).digest('hex'));
  assert.ok(recorded.filter.resetPasswordExpires.$gt instanceof Date);
  assert.deepEqual(recorded.filter.isActive, { $ne: false });
  assert.equal(await bcrypt.compare('new-test-password', recorded.update.$set.password), true);
  assert.equal(recorded.update.$inc.authVersion, 1);
  assert.deepEqual(recorded.update.$unset, { resetPasswordToken: '', resetPasswordExpires: '' });
  assert.equal(recorded.options.new, true);
  assert.equal((await request(`/api/customers/reset-password/${resetToken}`, { method: 'POST', body: { password: 'new-test-password' } })).status, 400);
});

test('malformed or expired reset tokens fail without returning sensitive data', async (t) => {
  const lookup = t.mock.method(Customer, 'findOneAndUpdate', async () => null);
  const invalid = await request('/api/customers/reset-password/invalid-token', { method: 'POST', body: { password: 'new-test-password' } });
  assert.equal(invalid.status, 400);
  assert.equal(lookup.mock.callCount(), 0);
  const expired = await request(`/api/customers/reset-password/${'b'.repeat(64)}`, { method: 'POST', body: { password: 'new-test-password' } });
  assert.equal(expired.status, 400);
  assert.equal(lookup.mock.callCount(), 1);
});

test('JSON validation and duplicate-email errors use useful safe HTTP statuses', async (t) => {
  assert.equal((await request('/api/customers', { method: 'POST', raw: '{invalid' })).status, 400);
  assert.equal((await request('/api/customers', { method: 'POST', body: [] })).status, 400);
  t.mock.method(Customer, 'exists', async () => false);
  t.mock.method(Customer, 'create', async () => { throw Object.assign(new Error('PRIVATE_DATABASE_DETAILS'), { code: 11000 }); });
  const duplicate = await request('/api/customers', { method: 'POST', body: { email: 'new@example.test', name: 'New shopper', phone: '0901234567', password: 'test-password' } });
  assert.equal(duplicate.status, 409);
  assert.ok(!JSON.stringify(duplicate.body).includes('PRIVATE_DATABASE_DETAILS'));
});

test('database outage returns 503 before customer controllers touch model methods', async (t) => {
  databaseState = 0;
  t.after(() => { databaseState = 1; });
  const lookup = t.mock.method(Customer, 'findById', () => { throw new Error('No database calls allowed'); });
  assert.equal((await request('/api/customers/profile', { authorization: token() })).status, 503);
  assert.equal((await request('/api/customers/cart', { method: 'POST', authorization: token(), body: { productId, quantity: 1, size: 38 } })).status, 503);
  assert.equal(lookup.mock.callCount(), 0);
});

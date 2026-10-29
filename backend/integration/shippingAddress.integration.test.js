import test from 'node:test';
import assert from 'node:assert/strict';
import Customer from '../models/customerModel.js';
import Order from '../models/orderModel.js';
import { setupIntegration } from './setup.js';

const original = { name: 'Người nhận A', phone: '0901234567', address: '10 Nguyễn Huệ', city: 'TP. Hồ Chí Minh', district: 'Quận 1', ward: 'Bến Nghé' };
const alternate = { name: 'Người nhận B', phone: '0901234568', address: '20 Trần Phú', city: 'Đà Nẵng', district: 'Hải Châu', ward: 'Thạch Thang' };
const checked = (result, status) => { assert.equal(result.status, status, result.body?.message);return result.body; };

test('real MongoDB default shipping addresses, per-order overrides and conditional first saves', { timeout: 180000 }, async t => {
  const buyerPassword = 'ShippingIntegration!123';
  const ctx = await setupIntegration(t), buyer = await ctx.createCustomer({ password: buyerPassword }), token = await ctx.login(buyer);
  const update = (body, owner = token) => ctx.request('PUT', '/api/customers/profile', { token: owner, body });
  const profile = async (owner = token) => checked(await ctx.request('GET', '/api/customers/profile', { token: owner }), 200);

  await t.test('profile saves the default address, trims fields, excludes notes and restores it on login', async () => {
    const saved = checked(await update({ shippingAddress: { ...original, address: ' 10 Nguyễn Huệ ', notes: 'Only for this order' } }), 200);
    assert.deepEqual(saved.shippingAddress, original);assert.equal(saved.password, undefined);
    assert.deepEqual((await Customer.findById(buyer._id)).shippingAddress.toObject(), original);
    assert.deepEqual((await profile()).shippingAddress, original);
    const login = checked(await ctx.request('POST', '/api/customers/login', { body: { email: buyer.email, password: buyerPassword } }), 200);
    assert.deepEqual(login.shippingAddress, original);
  });

  await t.test('an alternate shipping address belongs to its order and future profile edits cannot change that snapshot', async () => {
    const product = await ctx.createProduct();
    checked(await ctx.request('POST', '/api/customers/cart', { token, body: { productId: product._id, size: 40, color: 'Trắng', quantity: 1 } }), 201);
    const cart = checked(await ctx.request('GET', '/api/customers/cart', { token }), 200);
    const address = { ...alternate, notes: 'Gọi trước khi giao' };
    const order = checked(await ctx.request('POST', '/api/orders', { token, body: { shippingAddress: address, paymentMethod: 'COD', expectedCart: cart, expectedTotalPrice: 230000 } }), 201);
    assert.deepEqual(order.shippingAddress, address);assert.deepEqual((await profile()).shippingAddress, original);
    checked(await update({ shippingAddress: { ...original, address: 'Địa chỉ mới sau khi đặt đơn' } }), 200);
    assert.deepEqual((await Order.findById(order._id)).toObject().shippingAddress, address);
    assert.equal((await profile()).shippingAddress.address, 'Địa chỉ mới sau khi đặt đơn');
  });

  await t.test('two tabs saving the first address produce one winner and never overwrite the saved default', async () => {
    const account = await ctx.createCustomer(), auth = await ctx.login(account);
    const responses = await Promise.all([original, alternate].map(shippingAddress => update({ shippingAddress, onlyIfAddressMissing: true }, auth)));
    assert.equal(responses.filter(result => result.status === 200).length, 1);
    assert.equal(responses.filter(result => result.status === 409).length, 1);
    const winning = responses.find(result => result.status === 200).body.shippingAddress;
    assert.deepEqual((await profile(auth)).shippingAddress, winning);
    checked(await update({ shippingAddress: { ...winning, address: 'Must not overwrite' }, onlyIfAddressMissing: true }, auth), 409);
    assert.deepEqual((await profile(auth)).shippingAddress, winning);
    assert.deepEqual((await Customer.findById(account._id)).cart.toObject(), []);
  });

  await t.test('legacy accounts without saved address, auth version or document version can save their first address', async () => {
    const account = await ctx.createCustomer();
    await Customer.collection.updateOne({ _id: account._id }, { $unset: { shippingAddress: '', authVersion: '', __v: '' } });
    const auth = await ctx.login(account);
    assert.equal((await profile(auth)).shippingAddress, undefined);
    checked(await update({ shippingAddress: original, onlyIfAddressMissing: true }, auth), 200);
    const stored = await Customer.findById(account._id);
    assert.deepEqual(stored.shippingAddress.toObject(), original);assert.equal(stored.__v, 1);
  });

  await t.test('invalid addresses and unauthenticated writes fail while profile ownership remains tied to the token', async () => {
    const before = (await profile()).shippingAddress, stranger = await ctx.createCustomer();
    for (const shippingAddress of [{ ...original, city: '' }, { ...original, phone: '123' }, { ...original, address: 'x'.repeat(501) }, []]) checked(await update({ shippingAddress }), 400);
    checked(await ctx.request('PUT', '/api/customers/profile', { body: { shippingAddress: alternate } }), 401);
    assert.deepEqual((await profile()).shippingAddress, before);
    checked(await update({ user: stranger._id, shippingAddress: alternate }), 200);
    assert.equal((await Customer.findById(stranger._id)).shippingAddress, undefined);
    assert.deepEqual((await profile()).shippingAddress, alternate);
  });
});

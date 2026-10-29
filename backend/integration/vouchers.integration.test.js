import test from 'node:test';
import assert from 'node:assert/strict';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import Wallet from '../models/voucherWalletModel.js';
import { createPaymentExpirySweep } from '../utils/paymentExpiry.js';
import { setupIntegration } from './setup.js';

const checked = (res, code) => { assert.equal(res.status, code, res.body?.message);return res.body; };
const shippingAddress = { name: 'Voucher Integration', phone: '0901234567', address: '1 Test Street', city: 'Test City' };

test('real MongoDB voucher ownership, limits, release receipts and payment expiry', { timeout: 300000 }, async t => {
  const ctx = await setupIntegration(t), admin = await ctx.createCustomer({ isAdmin: true }), adminToken = await ctx.login(admin);
  const product = await ctx.createProduct({ price: 500000 });
  const campaign = async (code, extra = {}) => checked(await ctx.request('POST', '/api/vouchers/create', { token: adminToken, body: {
    code, description: 'Isolated voucher fixture', type: 'percent', discount: 10, maxDiscount: 30000, minOrder: 200000,
    perCustomerLimit: 1, maxUses: 20, startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 14 * 86400000), ...extra,
  } }), 201);
  const customer = async () => { const user = await ctx.createCustomer();return { user, token: await ctx.login(user) }; };
  const putInCart = async (token, shoe = product) => checked(await ctx.request('POST', '/api/customers/cart', { token, body: { productId: shoe._id, size: 40, color: 'Trắng', quantity: 1 } }), 201);
  const place = async (token, code) => {
    const cart = checked(await ctx.request('GET', '/api/customers/cart', { token }), 200);
    return ctx.request('POST', '/api/orders', { token, body: { shippingAddress, paymentMethod: 'COD', expectedCart: cart, voucherCode: code } });
  };
  const cancel = (token, order) => ctx.request('PUT', `/api/orders/${order._id}/cancel`, { token });

  await t.test('public save does not consume uses and issued programs resist economic rewrites/deletion', async () => {
    const voucher = await campaign('PUBLIC10'), buyer = await customer();
    checked(await ctx.request('POST', `/api/vouchers/${voucher._id}/save`, { token: buyer.token }), 200);
    const persisted = await Voucher.findById(voucher._id);assert.equal(persisted.usedCount, 0);assert.equal(persisted.walletCount, 1);
    assert.equal(await Wallet.countDocuments({ user: buyer.user._id, voucher: voucher._id }), 1);
    checked(await ctx.request('PUT', `/api/vouchers/${voucher._id}`, { token: adminToken, body: { version: persisted.__v, discount: 20 } }), 409);
    checked(await ctx.request('DELETE', `/api/vouchers/${voucher._id}`, { token: adminToken }), 409);
  });

  await t.test('private first-order codes stay invisible and only an eligible grant owner can use them', async () => {
    const voucher = await campaign('PRIVATEFIRST', { visibility: 'private', eligibility: 'first_order' }), owner = await customer(), other = await customer();
    const publicCodes = checked(await ctx.request('GET', '/api/vouchers'), 200);assert(!publicCodes.some(row => row.code === voucher.code));
    checked(await ctx.request('POST', '/api/vouchers/apply', { token: other.token, body: { code: voucher.code, orderTotal: 500000 } }), 403);
    const cards = checked(await ctx.request('POST', '/api/vouchers/mine/refresh', { token: owner.token, body: {} }), 200);
    assert(cards.some(row => row.code === voucher.code));const wallet = await Wallet.findOne({ user: owner.user._id, voucher: voucher._id });
    await ctx.request('POST', '/api/vouchers/mine/refresh', { token: owner.token, body: {} });
    assert.equal((await Wallet.findById(wallet._id)).expiresAt.toISOString(), wallet.expiresAt.toISOString());
    checked(await ctx.request('POST', '/api/vouchers/apply', { token: owner.token, body: { code: voucher.code, orderTotal: 500000 } }), 200);
    await putInCart(owner.token);const order = checked(await place(owner.token, voucher.code), 201);
    assert.equal(order.discountAmount, 30000);assert.equal(order.totalPrice, 500000);assert.equal(order.voucher.reservationToken, undefined);
    assert.equal((await Voucher.findById(voucher._id)).reservations.length, 1);
    await putInCart(owner.token);checked(await place(owner.token, voucher.code), 400);
    checked(await cancel(owner.token, order), 200);checked(await cancel(owner.token, order), 200);
    const released = await Voucher.findById(voucher._id);assert.equal(released.usedCount, 0);assert.equal(released.reservations.length, 0);assert.equal(released.releaseHolds.length, 0);
    checked(await place(owner.token, voucher.code), 201);
  });

  await t.test('per-customer limits and cancellation releases are enforced by real Mongo expressions', async () => {
    const voucher = await campaign('PEROWNER'), buyer = await customer();await putInCart(buyer.token);
    const first = checked(await place(buyer.token, voucher.code), 201);await putInCart(buyer.token);
    checked(await place(buyer.token, voucher.code), 400);
    const cards = checked(await ctx.request('GET', '/api/vouchers/available?orderTotal=500000', { token: buyer.token }), 200);
    const card = cards.find(row => row.code === voucher.code);assert.equal(card.state, 'held');assert.equal(card.eligible, false);assert.equal(card.heldByOrder, first._id);
    checked(await cancel(buyer.token, first), 200);checked(await place(buyer.token, voucher.code), 201);
    assert.equal((await Voucher.findById(voucher._id)).usedCount, 1);
  });

  await t.test('independent checkouts competing for the last code use commit at most one discounted order', async () => {
    const voucher = await campaign('LASTUSE', { maxUses: 1 }), a = await customer(), b = await customer(), secondShoe = await ctx.createProduct({ price: 500000 });
    await putInCart(a.token);await putInCart(b.token, secondShoe);
    const responses = await Promise.all([place(a.token, voucher.code), place(b.token, voucher.code)]);
    assert.equal(responses.filter(res => res.status === 201).length, 1);assert(responses.every(res => [201, 400, 409].includes(res.status)));
    const stored = await Voucher.findById(voucher._id);assert.equal(stored.usedCount, 1);assert.equal(stored.reservations.length, 1);
  });

  await t.test('admin description edits preserve precise times and stale forms cannot revert newer values', async () => {
    const voucher = await campaign('VERSIONS', { startDate: '2026-01-01T05:12:30.123Z', endDate: '2027-01-01T03:10:30.123Z' });
    checked(await ctx.request('PUT', `/api/vouchers/${voucher._id}`, { token: adminToken, body: { version: voucher.__v, discount: 20 } }), 200);
    checked(await ctx.request('PUT', `/api/vouchers/${voucher._id}`, { token: adminToken, body: { version: voucher.__v, description: 'Stale' } }), 409);
    const latest = await Voucher.findById(voucher._id);
    checked(await ctx.request('PUT', `/api/vouchers/${voucher._id}`, { token: adminToken, body: { version: latest.__v, description: 'Only words' } }), 200);
    const stored = await Voucher.findById(voucher._id);assert.equal(stored.discount, 20);assert.equal(stored.startDate.toISOString(), '2026-01-01T05:12:30.123Z');assert.equal(stored.endDate.toISOString(), '2027-01-01T03:10:30.123Z');
  });

  await t.test('a paid delivered order awards a private gift exactly once and exposes no other customer wallet', async () => {
    const voucher = await campaign('AFTERBUY', { visibility: 'private', eligibility: 'after_purchase' }), buyer = await customer();await putInCart(buyer.token);
    const order = checked(await place(buyer.token, null), 201);
    for (const orderStatus of ['Đã xác nhận', 'Đang giao', 'Đã giao']) checked(await ctx.request('PUT', `/api/orders/${order._id}/status`, { token: adminToken, body: { orderStatus } }), 200);
    assert.equal(await Wallet.countDocuments({ user: buyer.user._id, voucher: voucher._id }), 1);
    checked(await ctx.request('POST', '/api/vouchers/mine/refresh', { token: buyer.token, body: {} }), 200);
    assert.equal(await Wallet.countDocuments({ user: buyer.user._id, voucher: voucher._id }), 1);
    const source = await Wallet.findOne({ user: buyer.user._id, voucher: voucher._id });assert.equal(String(source.sourceOrder), order._id);
  });

  await t.test('simultaneous expiry sweeps cancel a never-opened VNPAY order and release stock/code once', async () => {
    const voucher = await campaign('EXPIRE'), buyer = await customer(), shoe = await ctx.createProduct({ price: 500000 });await putInCart(buyer.token, shoe);
    const order = checked(await place(buyer.token, voucher.code), 201);
    await Order.updateOne({ _id: order._id }, { $set: { paymentMethod: 'VNPAY', paymentDeadline: new Date(Date.now() - 1000), vnpayPayments: [] } });
    const sweep = createPaymentExpirySweep({ query: () => { throw Error('No link was issued; must not query gateway'); } });
    await Promise.all([sweep(), sweep()]);
    const stored = await Order.findById(order._id), coupon = await Voucher.findById(voucher._id), inventory = await Product.findById(shoe._id);
    assert.equal(stored.orderStatus, 'Đã hủy');assert(stored.autoCancelledAt);assert.equal(stored.stockRestored, true);
    assert.equal(coupon.usedCount, 0);assert.equal(coupon.reservations.length, 0);assert.equal(inventory.countInStock, shoe.countInStock);
    assert.equal(inventory.cancellationReceipts.length, 1);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { setupIntegration } from './setup.js';

const checked = (response, status) => {
  assert.equal(response.status, status, response.body?.message);
  return response.body;
};
const shippingAddress = { name: 'Delivery Test Buyer', phone: '0901234567', address: '1 Test Street', city: 'Test City' };
const inspection = [{ itemIndex: 0, restockQuantity: 2, damagedQuantity: 1, missingQuantity: 1 }];
const returnBody = { inspection, returnShippingCost: 45000, notes: 'Đã nhận và kiểm tra tại kho' };

test('failed deliveries and inspected physical returns with real HTTP and owned MongoDB', { timeout: 180000 }, async t => {
  const ctx = await setupIntegration(t);
  const admin = await ctx.createCustomer({ isAdmin: true });
  const adminToken = await ctx.login(admin);
  const fixture = async (paymentMethod = 'COD') => {
    const buyer = await ctx.createCustomer();
    const token = await ctx.login(buyer);
    const product = await ctx.createProduct();
    const voucher = await Voucher.create({
      code: `RETURN-${randomUUID()}`, description: 'Isolated delivery test', type: 'fixed', discount: 50000,
      minOrder: 0, maxUses: 10, startDate: new Date(Date.now() - 60000), endDate: new Date(Date.now() + 3600000),
    });
    const cart = checked(await ctx.request('POST', '/api/customers/cart', {
      token, body: { productId: String(product._id), quantity: 4, color: 'Trắng', size: 40 },
    }), 201);
    const order = checked(await ctx.request('POST', '/api/orders', {
      token, body: { expectedCart: cart, shippingAddress, paymentMethod, voucherCode: voucher.code, expectedTotalPrice: 780000 },
    }), 201);
    if (paymentMethod === 'BANK') checked(await ctx.request('PUT', `/api/orders/${order._id}/payment`, {
      token: adminToken, body: { isPaid: true },
    }), 200);
    for (const orderStatus of ['Đã xác nhận', 'Đang giao']) checked(await ctx.request('PUT', `/api/orders/${order._id}/status`, {
      token: adminToken, body: { orderStatus },
    }), 200);
    const fail = () => ctx.request('PUT', `/api/orders/${order._id}/delivery-failure`, {
      token: adminToken, body: { reason: 'Khách từ chối nhận', notes: 'Hàng đang trên đường quay về' },
    });
    const receive = body => ctx.request('PUT', `/api/orders/${order._id}/delivery-return`, {
      token: adminToken, body: body || returnBody,
    });
    return { order, product, voucher, token, fail, receive };
  };

  await t.test('COD refusal does not collect payment; only inspected good pairs return to sellable inventory', async () => {
    const f = await fixture();
    checked(await ctx.request('PUT', `/api/orders/${f.order._id}/delivery-failure`, {
      token: f.token, body: { reason: 'Từ chối' },
    }), 403);
    const failed = checked(await f.fail(), 200);
    assert.equal(failed.orderStatus, 'Giao thất bại');
    assert.equal(failed.isPaid, false);
    assert.equal(failed.isDelivered, false);
    assert.equal((await Product.findById(f.product._id)).countInStock, 16);
    assert.equal((await Voucher.findById(f.voucher._id)).usedCount, 1);
    checked(await ctx.request('PUT', `/api/orders/${f.order._id}/deliver`, { token: adminToken }), 400);
    checked(await ctx.request('PUT', `/api/orders/${f.order._id}/cancel`, { token: adminToken }), 400);
    const returned = checked(await f.receive(), 200);
    assert.equal(returned.orderStatus, 'Đã xử lý hoàn hàng');
    assert.equal(returned.deliveryReturn.refundAmount, 0);
    assert.equal(returned.deliveryReturn.returnShippingCost, 45000);
    assert.equal(returned.deliveryReturn.token, undefined);
    assert.equal(returned.refundStatus, 'not_required');
    assert.equal(returned.stockRestored, false);
    const product = await Product.findById(f.product._id).lean();
    assert.equal(product.countInStock, 18);
    assert.equal(product.variants.find(row => row.color === 'Trắng').quantity, 8);
    assert.equal(product.deliveryReturnReceipts.length, 1);
    const voucher = await Voucher.findById(f.voucher._id).lean();
    assert.equal(voucher.usedCount, 0);
    assert.equal(voucher.deliveryReturnReceipts.length, 1);
    assert.deepEqual(voucher.deliveryReturnHolds, []);
    checked(await f.receive(), 200);
    assert.equal((await Product.findById(f.product._id)).countInStock, 18);
    const mine = checked(await ctx.request('GET', '/api/orders/myorders', { token: f.token }), 200);
    assert.equal(mine[0].deliveryFailure.reason, 'Khách từ chối nhận');
    assert.equal(mine[0].deliveryReturn.inspection[0].damagedQuantity, 1);
  });

  await t.test('paid BANK return refunds only net products after receipt and stays outside sales statistics', async () => {
    const f = await fixture('BANK');
    checked(await f.fail(), 200);
    checked(await ctx.request('PUT', `/api/orders/${f.order._id}/refund`, { token: adminToken }), 400);
    const returned = checked(await f.receive(), 200);
    assert.equal(returned.isPaid, true);
    assert.equal(returned.isDelivered, false);
    assert.equal(returned.deliveryReturn.refundAmount, 750000);
    assert.equal(returned.deliveryReturn.retainedShippingFee, 30000);
    assert.equal(returned.refundStatus, 'pending');
    const refunded = checked(await ctx.request('PUT', `/api/orders/${f.order._id}/refund`, { token: adminToken }), 200);
    assert.equal(refunded.refundStatus, 'refunded');
    checked(await ctx.request('PUT', `/api/orders/${f.order._id}/refund`, { token: adminToken }), 200);
    assert.equal((await Order.findById(f.order._id)).deliveryReturn.refundAmount, 750000);
    const overview = checked(await ctx.request('GET', '/api/orders/stats/overview', { token: adminToken }), 200);
    assert.equal(overview.totalRevenue, 0);
    const best = checked(await ctx.request('GET', '/api/products/stats/best-selling', { token: adminToken }), 200);
    assert.equal(best.some(row => String(row._id) === String(f.product._id)), false);
  });

  await t.test('real partial completion retains receipts and prevents voucher deletion until safe replay', async t => {
    const f = await fixture();
    checked(await f.fail(), 200);
    const original = Order.findOneAndUpdate;
    let injected = false;
    t.mock.method(Order, 'findOneAndUpdate', function (filter, update, ...args) {
      if (!injected && String(filter._id) === f.order._id && update.$set?.['deliveryReturn.state'] === 'completed') {
        injected = true;
        throw new Error('Injected single completion failure');
      }
      return original.call(this, filter, update, ...args);
    });
    checked(await f.receive(), 503);
    assert.equal(injected, true);
    const pending = await Order.findById(f.order._id).lean();
    assert.equal(pending.deliveryReturn.state, 'processing');
    assert.equal(pending.deliveryReturn.recoveryRequired, true);
    assert.equal((await Product.findById(f.product._id)).countInStock, 18);
    assert.equal((await Voucher.findById(f.voucher._id).lean()).deliveryReturnHolds.length, 1);
    checked(await ctx.request('DELETE', `/api/vouchers/${f.voucher._id}`, { token: adminToken }), 409);
    checked(await f.receive({ ...returnBody, returnShippingCost: 50000 }), 409);
    checked(await f.receive(), 200);
    assert.equal((await Product.findById(f.product._id)).countInStock, 18);
    assert.equal((await Voucher.findById(f.voucher._id)).usedCount, 0);
    checked(await ctx.request('DELETE', `/api/vouchers/${f.voucher._id}`, { token: adminToken }), 200);
    checked(await f.receive(), 200);
  });

  await t.test('concurrent real HTTP confirmations restore each SKU and release the voucher once', async () => {
    const f = await fixture();
    checked(await f.fail(), 200);
    const results = await Promise.all([f.receive(), f.receive(), f.receive()]);
    results.forEach(result => checked(result, 200));
    assert.equal((await Product.findById(f.product._id)).countInStock, 18);
    assert.equal((await Product.findById(f.product._id).lean()).deliveryReturnReceipts.length, 1);
    assert.equal((await Voucher.findById(f.voucher._id)).usedCount, 0);
    assert.equal((await Voucher.findById(f.voucher._id).lean()).deliveryReturnReceipts.length, 1);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import { setupIntegration } from './setup.js';

const checked = (response, status) => { assert.equal(response.status, status, response.body?.message); return response.body; };
const shippingAddress = { name: 'Discount Test', phone: '0901234567', address: '1 Test Street', city: 'Test City' };

test('real MongoDB product sales, cart prices, voucher stacking and price snapshots', { timeout: 180000 }, async t => {
  const ctx = await setupIntegration(t);
  const admin = await ctx.createCustomer({ isAdmin: true }), adminToken = await ctx.login(admin);
  const buyer = await ctx.createCustomer(), buyerToken = await ctx.login(buyer);
  const cart = () => ctx.request('GET', '/api/customers/cart', { token: buyerToken });
  const add = async (product, quantity = 1) => checked(await ctx.request('POST', '/api/customers/cart', { token: buyerToken, body: { productId: product._id, color: 'Trắng', size: 40, quantity } }), 201);
  const place = async extra => ctx.request('POST', '/api/orders', { token: buyerToken, body: { shippingAddress, paymentMethod: 'COD', expectedCart: checked(await cart(), 200), ...extra } });
  let product, order;

  await t.test('admin creates a sale and both public product and populated cart retain the right prices', async () => {
    product = checked(await ctx.request('POST', '/api/products', { token: adminToken, body: {
      name: 'Discount integration shoe', brand: 'Nike', category: 'Sneaker', description: 'Isolated fixture',
      image: '/shoe.svg', price: 1000000, discountPercent: 20,
      variants: [{ color: 'Trắng', size: 40, quantity: 10 }],
    } }), 201);
    assert.equal((await Product.findById(product._id)).discountPercent, 20);
    const detail = checked(await ctx.request('GET', `/api/products/${product._id}`), 200);
    assert.equal(detail.price, 1000000); assert.equal(detail.discountPercent, 20);
    const items = await add(product, 2);
    assert.equal(items[0].price, 800000);
    assert.equal(items[0].product.price, 1000000);
    assert.equal(items[0].product.discountPercent, 20);
    const updated = checked(await ctx.request('PUT', '/api/customers/cart', { token: buyerToken, body: { cartItemId: items[0]._id, quantity: 3 } }), 200);
    assert.equal(updated[0].price, 800000);
    checked(await ctx.request('PUT', '/api/customers/cart', { token: buyerToken, body: { cartItemId: items[0]._id, quantity: 2 } }), 200);
    checked(await ctx.request('PUT', `/api/products/${product._id}`, { token: buyerToken, body: { discountPercent: 100 } }), 403);
  });

  await t.test('voucher minimums and percentage savings use the already discounted merchandise subtotal', async () => {
    const voucherBody = { description: 'Discount fixture voucher', type: 'percent', discount: 10, perCustomerLimit: 1, maxUses: 10, startDate: new Date(Date.now() - 60000), endDate: new Date(Date.now() + 86400000) };
    const minimumVoucher = checked(await ctx.request('POST', '/api/vouchers/create', { token: adminToken, body: { ...voucherBody, code: 'TOOHIGH', minOrder: 1700000 } }), 201);
    checked(await ctx.request('POST', `/api/vouchers/${minimumVoucher._id}/save`, { token: buyerToken }), 200);
    checked(await place({ voucherCode: 'TOOHIGH', expectedTotalPrice: 1470000 }), 400);
    assert.equal((await Product.findById(product._id)).countInStock, 10);
    const saleVoucher = checked(await ctx.request('POST', '/api/vouchers/create', { token: adminToken, body: { ...voucherBody, code: 'SALE10', minOrder: 1000000 } }), 201);
    checked(await ctx.request('POST', `/api/vouchers/${saleVoucher._id}/save`, { token: buyerToken }), 200);
    order = checked(await place({ voucherCode: 'SALE10', expectedTotalPrice: 1470000, discountPercent: 100, price: 1 }), 201);
    assert.equal(order.itemsPrice, 1600000);
    assert.equal(order.discountAmount, 160000);
    assert.equal(order.totalPrice, 1470000);
    assert.equal(order.orderItems[0].price, 800000);
    assert.equal(order.orderItems[0].originalPrice, 1000000);
    assert.equal(order.orderItems[0].discountPercent, 20);
    assert.equal((await Product.findById(product._id)).countInStock, 8);
  });

  await t.test('a later sale edit does not change historical order totals and stale edits are rejected', async () => {
    const latest = await Product.findById(product._id);
    const edited = checked(await ctx.request('PUT', `/api/products/${product._id}`, { token: adminToken, body: { version: latest.__v, discountPercent: 30 } }), 200);
    checked(await ctx.request('PUT', `/api/products/${product._id}`, { token: adminToken, body: { version: latest.__v, discountPercent: 0 } }), 409);
    checked(await ctx.request('POST', `/api/products/${product._id}/validate-update`, { token: adminToken, body: { version: edited.__v, discountPercent: 101 } }), 400);
    const historical = await Order.findById(order._id);
    assert.equal(historical.orderItems[0].price, 800000); assert.equal(historical.totalPrice, 1470000);
    await add(product);
    assert.equal(checked(await cart(), 200)[0].price, 700000);
    checked(await place({ expectedTotalPrice: 830000 }), 409);
    assert.equal((await Product.findById(product._id)).countInStock, 8);
    const cleared = checked(await ctx.request('PUT', `/api/products/${product._id}`, { token: adminToken, body: { version: edited.__v, discountPercent: 0 } }), 200);
    assert.equal(cleared.price, 1000000);
    assert.equal(checked(await cart(), 200)[0].price, 1000000);
    checked(await ctx.request('DELETE', '/api/customers/cart', { token: buyerToken }), 200);
  });

  await t.test('legacy MongoDB products missing the discount and version still checkout at their original price', async () => {
    const legacy = await ctx.createProduct();
    await Product.collection.updateOne({ _id: legacy._id }, { $unset: { discountPercent: '', __v: '' } });
    await add(legacy);
    const result = checked(await place({ expectedTotalPrice: 230000 }), 201);
    assert.equal(result.orderItems[0].price, 200000);
    assert.equal(result.totalPrice, 230000);
  });

  await t.test('a discount change between price read and stock reservation rejects even a legacy SKU without a version', async subtest => {
    const legacy = await ctx.createProduct({ discountPercent: 20 });
    await Product.collection.updateOne({ _id: legacy._id }, { $unset: { __v: '' } });
    await add(legacy);
    const original = Product.findOneAndUpdate;
    let raced = false;
    subtest.mock.method(Product, 'findOneAndUpdate', async function (filter, update, options) {
      if (!raced && String(filter._id) === String(legacy._id) && update.$addToSet?.checkoutReservations) {
        raced = true;
        await Product.collection.updateOne({ _id: legacy._id }, { $set: { discountPercent: 40 } });
      }
      return original.call(this, filter, update, options);
    });
    checked(await place({ expectedTotalPrice: 190000 }), 409);
    assert.equal(raced, true);
    assert.equal((await Product.findById(legacy._id)).countInStock, 20);
    assert.equal(await Order.countDocuments({ 'orderItems.product': legacy._id }), 0);
    assert.equal(checked(await cart(), 200)[0].price, 120000);
  });
});

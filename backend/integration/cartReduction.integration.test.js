import assert from 'node:assert/strict';
import test from 'node:test';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import { setupIntegration } from './setup.js';

const expectStatus = (response, status) => {
  assert.equal(response.status, status, response.body?.message);
  return response.body;
};
const shippingAddress = {
  name: 'Cart Reduction Buyer', phone: '0901234567',
  address: '1 Integration Street', city: 'Test City', district: 'Test District', ward: 'Test Ward',
};

test('real MongoDB allows cart reductions after stock decreases without weakening checkout stock checks', { timeout: 120000 }, async (t) => {
  const ctx = await setupIntegration(t);

  await t.test('variant cart quantity persists from 20 down to 10 after stock falls to 10', async () => {
    const buyer = await ctx.createCustomer();
    const token = await ctx.login(buyer);
    const product = await ctx.createProduct({ variants: [{ color: 'Trắng', size: 40, quantity: 20 }] });
    const cart = expectStatus(await ctx.request('POST', '/api/customers/cart', {
      token, body: { productId: String(product._id), color: 'Trắng', size: 40, quantity: 20 },
    }), 201);

    // Simulate stock changing after the customer added the product to the cart.
    product.variants[0].quantity = 10;
    product.countInStock = 10;
    await product.save();
    const reduced = expectStatus(await ctx.request('PUT', '/api/customers/cart', {
      token, body: { cartItemId: cart[0]._id, quantity: 10, price: 1 },
    }), 200);
    assert.equal(reduced[0].quantity, 10);
    assert.equal(reduced[0].price, product.price);
    assert.equal((await Customer.findById(buyer._id)).cart[0].quantity, 10);
    const storedProduct = await Product.findById(product._id);
    assert.equal(storedProduct.countInStock, 10);
    assert.equal(storedProduct.variants[0].quantity, 10, 'Cart reductions do not reserve or restore stock');

    expectStatus(await ctx.request('PUT', '/api/customers/cart', {
      token, body: { cartItemId: cart[0]._id, quantity: 11 },
    }), 400);
    assert.equal((await Customer.findById(buyer._id)).cart[0].quantity, 10);
  });

  await t.test('legacy shared-stock rows can be fixed one at a time and checkout rejects the unfinished correction', async () => {
    const buyer = await ctx.createCustomer();
    const token = await ctx.login(buyer);
    const product = await ctx.createProduct({ variants: [], sizes: [40, 41], color: '', countInStock: 40 });
    let cart;
    for (const size of [40, 41]) {
      cart = expectStatus(await ctx.request('POST', '/api/customers/cart', {
        token, body: { productId: String(product._id), size, quantity: 20 },
      }), 201);
    }
    product.countInStock = 10;
    await product.save();
    cart = expectStatus(await ctx.request('PUT', '/api/customers/cart', {
      token, body: { cartItemId: cart.find((row) => row.size === 40)._id, quantity: 1 },
    }), 200);
    assert.deepEqual(cart.map((row) => row.quantity), [1, 20]);
    assert.deepEqual((await Customer.findById(buyer._id)).cart.map((row) => row.quantity), [1, 20]);

    expectStatus(await ctx.request('POST', '/api/orders', {
      token, body: { shippingAddress, paymentMethod: 'COD', expectedCart: cart },
    }), 409);
    assert.equal((await Product.findById(product._id)).countInStock, 10);
    assert.equal(await Order.countDocuments({ user: buyer._id }), 0);
    assert.equal((await Customer.findById(buyer._id)).checkoutLock, null);

    cart = expectStatus(await ctx.request('PUT', '/api/customers/cart', {
      token, body: { cartItemId: cart.find((row) => row.size === 41)._id, quantity: 9 },
    }), 200);
    assert.deepEqual(cart.map((row) => row.quantity), [1, 9]);
    const order = expectStatus(await ctx.request('POST', '/api/orders', {
      token, body: { shippingAddress, paymentMethod: 'COD', expectedCart: cart },
    }), 201);
    assert.deepEqual(order.orderItems.map((row) => [row.size, row.quantity]), [[40, 1], [41, 9]]);
    assert.equal((await Product.findById(product._id)).countInStock, 0);
    assert.equal((await Customer.findById(buyer._id)).cart.length, 0);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import { setupIntegration } from './setup.js';

// Real local HTTP + an owned MongoDB test database. The hooks only pause an
// actual write or inject one failure; successful writes still reach MongoDB.
const shippingAddress = { name: 'P1 Buyer', phone: '0901234567', address: '1 Test Street', city: 'Test City' };
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const waitFor = async (promise) => {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Checkout did not reach the expected test pause')), 10000);
    })]);
  } finally { clearTimeout(timeout); }
};
const assertStatus = (response, status) => {
  assert.equal(response.status, status, response.body?.message);
  return response.body;
};
const fixture = async (ctx, { legacy = false } = {}) => {
  const buyer = await ctx.createCustomer();
  const token = await ctx.login(buyer);
  const product = await ctx.createProduct(legacy
    ? { variants: [], color: '', sizes: [40], countInStock: 1 }
    : { variants: [{ color: 'Trắng', size: 40, quantity: 1 }, { color: 'Đen', size: 40, quantity: 1 }] });
  const cart = assertStatus(await ctx.request('POST', '/api/customers/cart', {
    token, body: { productId: String(product._id), quantity: 1, size: 40, ...(legacy ? {} : { color: 'Trắng' }) },
  }), 201);
  const place = () => ctx.request('POST', '/api/orders', {
    token, body: { expectedCart: cart, shippingAddress, paymentMethod: 'COD', expectedTotalPrice: product.price + 30000 },
  });
  return { buyer, token, product, cart, place };
};

test('P1 checkout publication, compensation and inventory shape with real MongoDB', { timeout: 180000 }, async (t) => {
  const ctx = await setupIntegration(t);
  const admin = await ctx.createCustomer({ isAdmin: true });
  const adminToken = await ctx.login(admin);

  await t.test('pending checkout is hidden and cannot be paid, cancelled or fulfilled before commit', async (t) => {
    const f = await fixture(ctx);
    const reached = deferred();
    const release = deferred();
    const save = Order.prototype.save;
    let orderId;
    t.mock.method(Order.prototype, 'save', async function (...args) {
      const result = await save.apply(this, args);
      if (String(this.user) === String(f.buyer._id)) {
        orderId = String(this._id);
        reached.resolve();
        await release.promise;
      }
      return result;
    });
    const checkout = f.place();
    // Attach a handler immediately, then settle before restoring test mocks even
    // if an assertion or the expected-pause timeout fails.
    const settledCheckout = checkout.catch(() => {});
    try {
      await waitFor(reached.promise);
      assert.equal((await Order.findById(orderId).lean()).checkoutState, 'pending');
      assert.deepEqual(assertStatus(await ctx.request('GET', '/api/orders/myorders', { token: f.token }), 200), []);
      const adminOrders = assertStatus(await ctx.request('GET', '/api/orders', { token: adminToken }), 200);
      assert.equal(adminOrders.some(order => order._id === orderId), false);
      assertStatus(await ctx.request('GET', `/api/orders/${orderId}`, { token: f.token }), 409);
      const operations = [
        ['PUT', 'payment', { isPaid: true }], ['PUT', 'cancel'],
        ['PUT', 'status', { orderStatus: 'Đã xác nhận' }], ['PUT', 'deliver'], ['PUT', 'refund'],
      ];
      for (const [method, path, body] of operations) {
        assertStatus(await ctx.request(method, `/api/orders/${orderId}/${path}`, { token: adminToken, body }), 409);
      }
      assertStatus(await ctx.request('DELETE', `/api/orders/${orderId}`, { token: adminToken }), 409);
    } finally {
      release.resolve();
      await settledCheckout;
    }
    const order = assertStatus(await checkout, 201);
    const stored = await Order.findById(order._id).lean();
    assert.equal(stored.checkoutState, 'committed');
    assert.equal(stored.isPaid, false);
    assert.equal(Object.hasOwn(order, 'checkoutToken'), false);
    assert.deepEqual((await Product.findById(f.product._id).lean()).checkoutReservations, []);
    const customer = await Customer.findById(f.buyer._id).lean();
    assert.deepEqual(customer.cart, []);
    assert.equal(customer.checkoutLock, null);
    assertStatus(await ctx.request('PUT', `/api/orders/${order._id}/payment`, { token: adminToken, body: { isPaid: true } }), 200);
    assertStatus(await ctx.request('PUT', `/api/orders/${order._id}/cancel`, { token: adminToken }), 200);
    assert.equal((await Product.findById(f.product._id)).countInStock, f.product.countInStock);
  });

  await t.test('one cart-finalization failure cannot accept payment/cancellation or restore stock twice', async (t) => {
    const f = await fixture(ctx);
    const original = Customer.updateOne;
    let faultInjected = false;
    const blocked = [];
    t.mock.method(Customer, 'updateOne', async function (filter, update, ...args) {
      if (!faultInjected && String(filter._id) === String(f.buyer._id) && Array.isArray(update.$set?.cart) && update.$set.cart.length === 0) {
        faultInjected = true;
        const pending = await Order.findOne({ user: f.buyer._id }).lean();
        assert.equal(pending.checkoutState, 'pending');
        blocked.push((await ctx.request('PUT', `/api/orders/${pending._id}/payment`, { token: adminToken, body: { isPaid: true } })).status);
        blocked.push((await ctx.request('PUT', `/api/orders/${pending._id}/cancel`, { token: f.token })).status);
        throw new Error('Injected single cart-finalization failure');
      }
      return original.call(this, filter, update, ...args);
    });
    assertStatus(await f.place(), 500);
    assert.equal(faultInjected, true);
    assert.deepEqual(blocked, [409, 409]);
    assert.equal(await Order.countDocuments({ user: f.buyer._id }), 0);
    const product = await Product.findById(f.product._id).lean();
    assert.equal(product.countInStock, f.product.countInStock);
    assert.deepEqual(product.checkoutReservations, []);
    const customer = await Customer.findById(f.buyer._id).lean();
    assert.equal(customer.cart.length, f.cart.length);
    assert.equal(customer.checkoutLock, null);
    const retried = assertStatus(await f.place(), 201);
    assertStatus(await ctx.request('PUT', `/api/orders/${retried._id}/cancel`, { token: f.token }), 200);
    assert.equal((await Product.findById(f.product._id)).countInStock, f.product.countInStock);
  });

  for (const legacy of [false, true]) {
    await t.test(`${legacy ? 'legacy conversion' : 'variant removal'} cannot pass between reservation and order persistence`, async (t) => {
      const f = await fixture(ctx, { legacy });
      const reached = deferred();
      const release = deferred();
      const cartCleared = deferred();
      const releaseAfterCartClear = deferred();
      const save = Order.prototype.save;
      const updateCustomer = Customer.updateOne;
      let shapeOrderLookups = 0;
      let cartClearWrites = 0;
      t.mock.method(Order.prototype, 'save', async function (...args) {
        if (String(this.user) === String(f.buyer._id)) {
          reached.resolve();
          await release.promise;
        }
        return save.apply(this, args);
      });
      t.mock.method(Customer, 'updateOne', async function (filter, update, ...args) {
        const result = await updateCustomer.call(this, filter, update, ...args);
        if (String(filter._id) === String(f.buyer._id)
          && Array.isArray(update.$set?.cart) && update.$set.cart.length === 0
          && result.matchedCount === 1) {
          // The actual cart write has completed, but checkout cannot commit or
          // release its Product hold (and bump __v) until this gate opens.
          cartClearWrites += 1;
          cartCleared.resolve();
          await releaseAfterCartClear.promise;
        }
        return result;
      });
      const checkout = f.place();
      const settledCheckout = checkout.catch(() => {});
      try {
        await waitFor(reached.promise);
        assert.equal(await Order.countDocuments({ user: f.buyer._id }), 0);
        const reserved = await Product.findById(f.product._id).lean();
        assert.equal(reserved.checkoutReservations.length, 1);
        const exists = Order.exists;
        t.mock.method(Order, 'exists', async function (...args) {
          const snapshot = await exists.apply(this, args);
          // Reproduce the original gap if the hold guard is absent: persist
          // the order and clear its cart between Order.exists and Customer.exists,
          // without letting hold release increase the product version first.
          shapeOrderLookups += 1;
          if (!snapshot) {
            release.resolve();
            await waitFor(cartCleared.promise);
          }
          return snapshot;
        });
        assertStatus(await ctx.request('PUT', `/api/products/${f.product._id}`, {
          token: adminToken, body: { version: reserved.__v, variants: [{ color: 'Đen', size: 40, quantity: legacy ? 0 : 1 }] },
        }), 409);
        assert.equal(shapeOrderLookups, 0, 'The durable hold must reject the edit before cross-collection lookups');
        assert.equal(cartClearWrites, 0, 'The rejected edit must leave checkout paused before its Order write');
        const protectedProduct = await Product.findById(f.product._id).lean();
        assert.equal(protectedProduct.__v, reserved.__v, 'The rejection must not rely on hold-release version changes');
        assert.deepEqual(protectedProduct.checkoutReservations, reserved.checkoutReservations);
        assertStatus(await ctx.request('PUT', `/api/products/${f.product._id}`, {
          token: adminToken, body: { name: 'Metadata edit while checkout is pending' },
        }), 200);
      } finally {
        release.resolve();
        releaseAfterCartClear.resolve();
        await settledCheckout;
      }
      const order = assertStatus(await checkout, 201);
      assert.equal(cartClearWrites, 1);
      assertStatus(await ctx.request('PUT', `/api/orders/${order._id}/cancel`, { token: f.token }), 200);
      assert.equal((await Product.findById(f.product._id)).countInStock, f.product.countInStock);
    });
  }

  await t.test('a lost commit acknowledgement is read back without deleting the committed order or returning its stock', async (t) => {
    const f = await fixture(ctx);
    const original = Order.findOneAndUpdate;
    let faultInjected = false;
    t.mock.method(Order, 'findOneAndUpdate', async function (filter, update, ...args) {
      const result = await original.call(this, filter, update, ...args);
      if (!faultInjected && update.$set?.checkoutState === 'committed' && result) {
        faultInjected = true;
        throw new Error('Injected lost commit acknowledgement');
      }
      return result;
    });
    const order = assertStatus(await f.place(), 201);
    assert.equal(faultInjected, true);
    assert.equal((await Order.findById(order._id).lean()).checkoutState, 'committed');
    assert.equal(await Order.countDocuments({ user: f.buyer._id }), 1);
    assert.equal((await Product.findById(f.product._id)).countInStock, f.product.countInStock - 1);
    assertStatus(await ctx.request('PUT', `/api/orders/${order._id}/cancel`, { token: f.token }), 200);
    assert.equal((await Product.findById(f.product._id)).countInStock, f.product.countInStock);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import Voucher from '../models/voucherModel.js';
import { setupIntegration } from './setup.js';

// These cases use the actual HTTP routes and MongoDB collections created by the
// harness. No application models, controllers or inventory writes are mocked.
const shippingAddress = {
  name: 'Integration Buyer', address: '1 Integration Street', city: 'Test City',
  phone: '0901234567', district: 'Test District', ward: 'Test Ward',
};

const assertStatus = (response, expected) => {
  assert.equal(response.status, expected, response.body?.message || `Expected HTTP ${expected}`);
  return response.body;
};

const addToCart = async (ctx, token, product, selection = {}) => assertStatus(await ctx.request(
  'POST', '/api/customers/cart', {
    token, body: { productId: String(product._id), color: 'Trắng', size: 40, quantity: 1, ...selection },
  },
), 201);

const readCart = async (ctx, token) => assertStatus(await ctx.request('GET', '/api/customers/cart', { token }), 200);
const clearCart = async (ctx, token) => assertStatus(await ctx.request('DELETE', '/api/customers/cart', { token }), 200);
const placeOrder = async (ctx, token, extra = {}) => {
  const expectedCart = extra.expectedCart ?? await readCart(ctx, token);
  return ctx.request('POST', '/api/orders', {
    token, body: { shippingAddress, paymentMethod: 'COD', expectedCart, ...extra },
  });
};
const placeLegacyBankOrder = async (ctx, token) => {
  const order = assertStatus(await placeOrder(ctx, token), 201);
  // Only isolated fixtures use BANK to cover orders created before its removal from checkout.
  const updated = await Order.updateOne({ _id: order._id }, { $set: { paymentMethod: 'BANK' } });
  assert.equal(updated.matchedCount, 1);
  return order;
};
const cancelOrder = (ctx, token, id) => ctx.request('PUT', `/api/orders/${id}/cancel`, { token });
const stockOf = (product) => product.variants.map(({ color, size, quantity }) => ({ color, size, quantity }));
const ordersFor = (product) => Order.find({ 'orderItems.product': product._id });
const createBuyer = async (ctx) => {
  const buyer = await ctx.createCustomer();
  return { buyer, buyerToken: await ctx.login(buyer) };
};
const assertUnlocked = async (customer) => {
  const latest = await Customer.findById(customer._id);
  assert.equal(latest.checkoutLock, null, 'A completed/rejected checkout must release its customer claim');
};

test('real MongoDB checkout, cancellation, payment and archived inventory', { timeout: 180000 }, async (t) => {
  const ctx = await setupIntegration(t);
  const admin = await ctx.createCustomer({ isAdmin: true });
  const adminToken = await ctx.login(admin);

  await t.test('an equal-price color change requires fresh confirmation before reserving inventory', async () => {
    const { buyer, buyerToken } = await createBuyer(ctx);
    const product = await ctx.createProduct();
    const originalStock = stockOf(product);
    await addToCart(ctx, buyerToken, product);
    const confirmedCart = await readCart(ctx, buyerToken);
    await clearCart(ctx, buyerToken);
    await addToCart(ctx, buyerToken, product, { color: 'Đen' });

    assertStatus(await placeOrder(ctx, buyerToken, {
      expectedCart: confirmedCart, expectedTotalPrice: product.price + 30000,
    }), 409);

    const latestProduct = await Product.findById(product._id);
    assert.deepEqual(stockOf(latestProduct), originalStock);
    assert.equal(latestProduct.countInStock, product.countInStock);
    assert.equal((await ordersFor(product)).length, 0);
    const latestCart = await readCart(ctx, buyerToken);
    assert.equal(latestCart.length, 1);
    assert.equal(latestCart[0].color, 'Đen');
    await assertUnlocked(buyer);
    await clearCart(ctx, buyerToken);
  });

  await t.test('an exact multi-variant snapshot uses current server prices and clears its cart', async () => {
    const { buyer, buyerToken } = await createBuyer(ctx);
    const product = await ctx.createProduct();
    await addToCart(ctx, buyerToken, product, { quantity: 2 });
    await addToCart(ctx, buyerToken, product, { color: 'Đen', quantity: 1 });
    assertStatus(await ctx.request('PUT', `/api/products/${product._id}`, {
      token: adminToken, body: { price: 245000 },
    }), 200);
    const confirmedCart = await readCart(ctx, buyerToken);
    assert.equal(confirmedCart.length, 2);
    assert.ok(confirmedCart.every((line) => line.price === 245000));

    const order = assertStatus(await placeOrder(ctx, buyerToken, {
      expectedCart: confirmedCart.reverse(), expectedTotalPrice: 765000,
      totalPrice: 1, itemsPrice: 1, discountAmount: 999999,
    }), 201);

    assert.equal(order.itemsPrice, 735000);
    assert.equal(order.shippingPrice, 30000);
    assert.equal(order.discountAmount, 0);
    assert.equal(order.totalPrice, 765000);
    assert.ok(order.orderItems.every((line) => line.price === 245000 && line.inventoryVariant));
    const latestProduct = await Product.findById(product._id);
    assert.equal(latestProduct.countInStock, 17);
    assert.deepEqual(stockOf(latestProduct), [
      { color: 'Trắng', size: 40, quantity: 8 }, { color: 'Đen', size: 40, quantity: 9 },
    ]);
    assert.deepEqual(await readCart(ctx, buyerToken), []);
    await assertUnlocked(buyer);
    assert.equal((await ordersFor(product)).length, 1);
  });

  await t.test('checkout requires a confirmed cart even when a valid total is submitted', async () => {
    const { buyer, buyerToken } = await createBuyer(ctx);
    const product = await ctx.createProduct();
    await addToCart(ctx, buyerToken, product);
    assertStatus(await ctx.request('POST', '/api/orders', {
      token: buyerToken,
      body: { shippingAddress, paymentMethod: 'COD', expectedTotalPrice: product.price + 30000 },
    }), 400);
    assert.equal((await Product.findById(product._id)).countInStock, product.countInStock);
    assert.equal((await ordersFor(product)).length, 0);
    await assertUnlocked(buyer);
    await clearCart(ctx, buyerToken);
  });

  await t.test('two buyers competing for the last pair create only one order', async () => {
    const product = await ctx.createProduct({ variants: [{ color: 'Trắng', size: 40, quantity: 1 }] });
    const customers = await Promise.all([ctx.createCustomer(), ctx.createCustomer()]);
    const tokens = await Promise.all(customers.map((customer) => ctx.login(customer)));
    await Promise.all(tokens.map((token) => addToCart(ctx, token, product)));
    const snapshots = await Promise.all(tokens.map((token) => readCart(ctx, token)));
    const results = await Promise.all(tokens.map((token, index) => placeOrder(ctx, token, {
      expectedCart: snapshots[index], expectedTotalPrice: product.price + 30000,
    })));

    assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
    assert.equal((await ordersFor(product)).length, 1);
    const latestProduct = await Product.findById(product._id);
    assert.equal(latestProduct.countInStock, 0);
    assert.deepEqual(stockOf(latestProduct), [{ color: 'Trắng', size: 40, quantity: 0 }]);
    for (let index = 0; index < customers.length; index += 1) {
      await assertUnlocked(customers[index]);
      assert.equal((await readCart(ctx, tokens[index])).length, results[index].status === 201 ? 0 : 1);
    }
  });

  await t.test('concurrent BANK payment and cancellation always preserve refund eligibility', async () => {
    const { buyerToken } = await createBuyer(ctx);
    // Independent fixtures exercise whichever operation wins each real MongoDB
    // race. A CAS conflict is retried only after both original requests settle.
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const product = await ctx.createProduct({ variants: [{ color: 'Trắng', size: 40, quantity: 1 }] });
      await addToCart(ctx, buyerToken, product);
      const placed = await placeLegacyBankOrder(ctx, buyerToken);
      const [payment, cancellation] = await Promise.all([
        ctx.request('PUT', `/api/orders/${placed._id}/payment`, { token: adminToken, body: { isPaid: true } }),
        cancelOrder(ctx, buyerToken, placed._id),
      ]);
      assert.ok([200, 400, 409].includes(payment.status), `Unexpected payment status ${payment.status}`);
      assert.ok([200, 409].includes(cancellation.status), `Unexpected cancellation status ${cancellation.status}`);
      if (cancellation.status === 409) assertStatus(await cancelOrder(ctx, buyerToken, placed._id), 200);

      const persisted = await Order.findById(placed._id);
      assert.equal(persisted.orderStatus, 'Đã hủy');
      assert.equal(persisted.stockRestored, true);
      assert.equal(persisted.cancellationLock, null);
      assert.equal(persisted.refundStatus, persisted.isPaid ? 'pending' : 'not_required');
      if (payment.status === 200) assert.equal(persisted.isPaid, true);
      assert.deepEqual(stockOf(await Product.findById(product._id)), [{ color: 'Trắng', size: 40, quantity: 1 }]);
    }

    // Also guarantee the paid branch is checked regardless of race scheduling.
    const paidProduct = await ctx.createProduct({ variants: [{ color: 'Trắng', size: 40, quantity: 1 }] });
    await addToCart(ctx, buyerToken, paidProduct);
    const paidOrder = await placeLegacyBankOrder(ctx, buyerToken);
    assertStatus(await ctx.request('PUT', `/api/orders/${paidOrder._id}/payment`, {
      token: adminToken, body: { isPaid: true },
    }), 200);
    const canceled = assertStatus(await cancelOrder(ctx, buyerToken, paidOrder._id), 200);
    assert.equal(canceled.order.refundStatus, 'pending');
    assertStatus(await ctx.request('PUT', `/api/orders/${paidOrder._id}/refund`, { token: buyerToken }), 403);
    const refunded = assertStatus(await ctx.request('PUT', `/api/orders/${paidOrder._id}/refund`, { token: adminToken }), 200);
    assert.equal(refunded.refundStatus, 'refunded');
    const repeated = assertStatus(await ctx.request('PUT', `/api/orders/${paidOrder._id}/refund`, { token: adminToken }), 200);
    assert.equal(repeated.refundedAt, refunded.refundedAt);
    assert.equal((await Product.findById(paidProduct._id)).countInStock, 1);
  });

  await t.test('concurrent cancellation and retries restore each variant and voucher only once', async () => {
    const { buyerToken } = await createBuyer(ctx);
    const product = await ctx.createProduct({ variants: [
      { color: 'Trắng', size: 40, quantity: 5 }, { color: 'Đen', size: 41, quantity: 7 },
    ] });
    const voucher = await Voucher.create({
      code: `INTEGRATION${product._id}`, description: 'Integration-only voucher',
      type: 'fixed', discount: 10000, minOrder: 0, maxUses: 1,
      startDate: new Date(Date.now() - 60000), endDate: new Date(Date.now() + 3600000),
    });
    await addToCart(ctx, buyerToken, product, { quantity: 2 });
    await addToCart(ctx, buyerToken, product, { color: 'Đen', size: 41, quantity: 3 });
    const placed = assertStatus(await placeOrder(ctx, buyerToken, {
      voucherCode: voucher.code, expectedTotalPrice: product.price * 5 + 20000,
    }), 201);
    assert.equal((await Voucher.findById(voucher._id)).usedCount, 1);
    assert.equal((await Product.findById(product._id)).countInStock, 7);

    const cancellations = await Promise.all(Array.from({ length: 3 }, () => cancelOrder(ctx, buyerToken, placed._id)));
    assert.ok(cancellations.some((response) => response.status === 200));
    assert.ok(cancellations.every((response) => [200, 409].includes(response.status)));
    assertStatus(await cancelOrder(ctx, buyerToken, placed._id), 200);
    assertStatus(await cancelOrder(ctx, adminToken, placed._id), 200);

    const persisted = await Order.findById(placed._id);
    assert.equal(persisted.stockRestored, true);
    assert.equal(persisted.voucherReleased, true);
    assert.equal(persisted.cancellationLock, null);
    assert.equal((await Voucher.findById(voucher._id)).usedCount, 0);
    const restored = await Product.findById(product._id);
    assert.equal(restored.countInStock, 12);
    assert.deepEqual(stockOf(restored), stockOf(product));
  });

  await t.test('archiving a purchased SKU preserves exact variant restoration and order history', async () => {
    const { buyerToken } = await createBuyer(ctx);
    const product = await ctx.createProduct({ variants: [
      { color: 'Trắng', size: 40, quantity: 2 }, { color: 'Đen', size: 41, quantity: 3 },
    ] });
    await addToCart(ctx, buyerToken, product, { color: 'Đen', size: 41, quantity: 3 });
    const placed = assertStatus(await placeOrder(ctx, buyerToken), 201);
    assertStatus(await ctx.request('DELETE', `/api/products/${product._id}`, { token: adminToken }), 200);
    const archived = await Product.findById(product._id);
    assert.ok(archived, 'The SKU must remain in MongoDB after DELETE');
    assert.equal(archived.isArchived, true);
    assert.equal(archived.isHidden, true);
    assertStatus(await ctx.request('GET', `/api/products/${product._id}`), 404);
    assertStatus(await ctx.request('POST', '/api/customers/cart', {
      token: buyerToken, body: { productId: String(product._id), color: 'Trắng', size: 40, quantity: 1 },
    }), 404);
    assertStatus(await ctx.request('PUT', `/api/products/${product._id}`, {
      token: adminToken, body: { price: 1 },
    }), 409);
    assertStatus(await ctx.request('DELETE', `/api/products/${product._id}`, { token: adminToken }), 200);
    const history = assertStatus(await ctx.request('GET', `/api/orders/${placed._id}`, { token: buyerToken }), 200);
    assert.equal(history.orderItems[0].product, String(product._id));
    assert.equal(history.orderItems[0].color, 'Đen');
    assert.equal(history.orderItems[0].size, 41);

    assertStatus(await cancelOrder(ctx, buyerToken, placed._id), 200);
    const restored = await Product.findById(product._id);
    assert.equal(restored.isArchived, true);
    assert.equal(restored.countInStock, 5);
    assert.deepEqual(stockOf(restored), stockOf(product));
  });

  await t.test('archiving concurrently with checkout never deletes inventory needed by rollback or cancellation', async () => {
    const { buyer, buyerToken } = await createBuyer(ctx);
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const product = await ctx.createProduct({ variants: [{ color: 'Trắng', size: 40, quantity: 1 }] });
      await addToCart(ctx, buyerToken, product);
      const snapshot = await readCart(ctx, buyerToken);
      const [checkout, archive] = await Promise.all([
        placeOrder(ctx, buyerToken, { expectedCart: snapshot }),
        ctx.request('DELETE', `/api/products/${product._id}`, { token: adminToken }),
      ]);
      assertStatus(archive, 200);
      assert.ok([201, 400, 409].includes(checkout.status), `Unexpected checkout status ${checkout.status}`);
      const persisted = await Product.findById(product._id);
      assert.ok(persisted, 'Archive must retain the product during an in-flight checkout');
      assert.equal(persisted.isArchived, true);
      const productOrders = await ordersFor(product);
      assert.equal(productOrders.length, checkout.status === 201 ? 1 : 0);
      if (checkout.status === 201) {
        assertStatus(await cancelOrder(ctx, buyerToken, checkout.body._id), 200);
      } else {
        await clearCart(ctx, buyerToken);
      }
      const restored = await Product.findById(product._id);
      assert.equal(restored.countInStock, 1);
      assert.deepEqual(stockOf(restored), [{ color: 'Trắng', size: 40, quantity: 1 }]);
      await assertUnlocked(buyer);
    }
  });

  await t.test('COD is paid on successful delivery and only then permits a purchase review', async () => {
    const { buyerToken } = await createBuyer(ctx);
    const product = await ctx.createProduct();
    await addToCart(ctx, buyerToken, product);
    const placed = assertStatus(await placeOrder(ctx, buyerToken), 201);
    assert.equal(placed.isPaid, false);
    const reviewBody = { rating: 5, comment: 'Integration review after verified delivery' };
    assertStatus(await ctx.request('POST', `/api/products/${product._id}/reviews`, {
      token: buyerToken, body: reviewBody,
    }), 403);
    assertStatus(await ctx.request('PUT', `/api/orders/${placed._id}/status`, {
      token: buyerToken, body: { orderStatus: 'Đã xác nhận' },
    }), 403);
    for (const orderStatus of ['Đã xác nhận', 'Đang giao', 'Đã giao']) {
      const updated = assertStatus(await ctx.request('PUT', `/api/orders/${placed._id}/status`, {
        token: adminToken, body: { orderStatus },
      }), 200);
      assert.equal(updated.isPaid, orderStatus === 'Đã giao');
    }
    const delivered = await Order.findById(placed._id);
    assert.equal(delivered.isDelivered, true);
    assert.ok(delivered.paidAt);
    assert.ok(delivered.deliveredAt);
    const review = assertStatus(await ctx.request('POST', `/api/products/${product._id}/reviews`, {
      token: buyerToken, body: reviewBody,
    }), 201);
    assert.equal(review.numReviews, 1);
    assert.equal(review.rating, 5);
    assertStatus(await ctx.request('POST', `/api/products/${product._id}/reviews`, {
      token: buyerToken, body: reviewBody,
    }), 409);
    assertStatus(await cancelOrder(ctx, buyerToken, placed._id), 400);
    assertStatus(await ctx.request('PUT', `/api/orders/${placed._id}/payment`, {
      token: adminToken, body: { isPaid: false },
    }), 400);
    assert.equal((await Product.findById(product._id)).countInStock, product.countInStock - 1);
  });
});

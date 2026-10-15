import test from 'node:test';
import assert from 'node:assert/strict';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import { updateCartItemQuantity } from '../controllers/customerController.js';

const customerId = '000000000000000000000001';
const productId = '000000000000000000000002';

// Exercise the real mutation controller without connecting to MongoDB.
const fixture = (t, { product: productOverrides = {}, rows, checkoutLock } = {}) => {
  const product = {
    _id: productId, name: 'Current shoe', image: '/current-shoe.png', price: 200000,
    countInStock: 10, sizes: [40, 41], variants: [], ...productOverrides,
  };
  const customer = {
    _id: customerId, checkoutLock,
    cart: (rows || [{ _id: 'line-40', size: 40, quantity: 20 }]).map((row) => ({
      product: productId, color: '', name: 'Old shoe', image: '/old-shoe.png', price: 1, ...row,
      toObject() { return { ...this, toObject: undefined }; },
    })),
    async save() { return this; },
    async populate() {
      this.cart.forEach((row) => { row.product = product; });
      return this;
    },
  };
  const customerLookup = t.mock.method(Customer, 'findById', async () => customer);
  const productLookup = t.mock.method(Product, 'findById', async () => product);
  const save = t.mock.method(customer, 'save');
  const response = {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const update = async (quantity, cartItemId = 'line-40') => {
    await updateCartItemQuantity({ user: { _id: customerId }, body: { cartItemId, quantity, price: 1 } }, response);
    return response;
  };
  return { product, customer, response, update, save, productLookup, customerLookup };
};

test('an overstocked cart can reduce directly from 20 to current stock 10 and refreshes server snapshots', async (t) => {
  const ctx = fixture(t);
  const response = await ctx.update(10);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body[0].quantity, 10);
  assert.equal(response.body[0].price, ctx.product.price);
  assert.equal(response.body[0].name, ctx.product.name);
  assert.equal(response.body[0].image, ctx.product.image);
  assert.equal(ctx.product.countInStock, 10, 'Changing a cart must not reserve stock');
  assert.equal(ctx.save.mock.callCount(), 1);
});

test('legacy shared-stock lines can be reduced one at a time while their aggregate is still over stock', async (t) => {
  const ctx = fixture(t, { rows: [
    { _id: 'line-40', size: 40, quantity: 20 },
    { _id: 'line-41', size: 41, quantity: 20 },
  ] });
  await ctx.update(1);
  assert.deepEqual(ctx.customer.cart.map((row) => row.quantity), [1, 20]);
  await ctx.update(9, 'line-41');
  assert.deepEqual(ctx.customer.cart.map((row) => row.quantity), [1, 9]);
  assert.equal(ctx.save.mock.callCount(), 2);
  assert.equal(ctx.product.countInStock, 10);
});

test('valid variant reductions remain possible even if the selected variant is sold out', async (t) => {
  const ctx = fixture(t, {
    product: { sizes: [40], variants: [{ color: 'Trắng', size: 40, quantity: 0 }], countInStock: 0 },
    rows: [{ _id: 'line-40', color: 'Trắng', size: 40, quantity: 20 }],
  });
  await ctx.update(1);
  assert.equal(ctx.customer.cart[0].quantity, 1);
  assert.equal(ctx.product.variants[0].quantity, 0);
});

test('unchanged or increased quantities still require sufficient aggregate stock', async (t) => {
  const ctx = fixture(t);
  for (const quantity of [20, 21]) {
    await assert.rejects(ctx.update(quantity), (error) => error.status === 400);
    assert.equal(ctx.customer.cart[0].quantity, 20);
  }
  assert.equal(ctx.save.mock.callCount(), 0);
});

test('an increase cannot consume stock assigned to another legacy size in the same cart', async (t) => {
  const ctx = fixture(t, { rows: [
    { _id: 'line-40', size: 40, quantity: 2 },
    { _id: 'line-41', size: 41, quantity: 8 },
  ] });
  await assert.rejects(ctx.update(3), (error) => error.status === 400);
  assert.equal(ctx.customer.cart[0].quantity, 2);
  assert.equal(ctx.save.mock.callCount(), 0);
});

test('invalid reduced quantities are rejected before customer/product lookups', async (t) => {
  const ctx = fixture(t);
  for (const quantity of [0, -1, 1.5, '', true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(ctx.update(quantity), (error) => error.status === 400);
  }
  assert.equal(ctx.customerLookup.mock.callCount(), 0);
  assert.equal(ctx.productLookup.mock.callCount(), 0);
  assert.equal(ctx.save.mock.callCount(), 0);
});

test('reductions still reject missing colors and removed size/color combinations', async (t) => {
  for (const [color, expectedStatus] of [['', 400], ['Đen', 409]]) {
    await t.test(`invalid color ${color || '(missing)'}`, async (subtest) => {
      const ctx = fixture(subtest, {
        product: { sizes: [40], variants: [{ color: 'Trắng', size: 40, quantity: 10 }] },
        rows: [{ _id: 'line-40', color, size: 40, quantity: 20 }],
      });
      await assert.rejects(ctx.update(10), (error) => error.status === expectedStatus);
      assert.equal(ctx.customer.cart[0].quantity, 20);
      assert.equal(ctx.save.mock.callCount(), 0);
    });
  }
});

test('reductions still reject a size no longer offered by the product', async (t) => {
  const ctx = fixture(t, { product: { sizes: [41] } });
  await assert.rejects(ctx.update(10), (error) => error.status === 400);
  assert.equal(ctx.save.mock.callCount(), 0);
});

test('hidden, archived and deleted products remain remove-only even during reductions', async (t) => {
  for (const state of ['hidden', 'archived', 'deleted']) {
    await t.test(state, async (subtest) => {
      const ctx = fixture(subtest, { product: { isHidden: state === 'hidden', isArchived: state === 'archived' } });
      if (state === 'deleted') subtest.mock.method(Product, 'findById', async () => null);
      await assert.rejects(ctx.update(10), (error) => error.status === 404);
      assert.equal(ctx.save.mock.callCount(), 0);
    });
  }
});

test('active checkout and recovery locks block reductions before reading product inventory', async (t) => {
  for (const checkoutLock of [
    { token: 'active-checkout', expiresAt: new Date(Date.now() + 60000) },
    { token: 'recovery', expiresAt: new Date(0), recoveryRequired: true },
  ]) {
    await t.test(checkoutLock.token, async (subtest) => {
      const ctx = fixture(subtest, { checkoutLock });
      await assert.rejects(ctx.update(10), (error) => error.status === 409);
      assert.equal(ctx.productLookup.mock.callCount(), 0);
      assert.equal(ctx.save.mock.callCount(), 0);
    });
  }
});

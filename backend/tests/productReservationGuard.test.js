import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Product from '../models/productModel.js';
import Customer from '../models/customerModel.js';
import Order from '../models/orderModel.js';
import {
  createProduct, updateProduct, updateProductStock, validateProductUpdate,
} from '../controllers/productController.js';
import { releaseCheckoutReservations } from '../utils/checkoutReservations.js';

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const fields = (legacy = false) => ({
  _id: new mongoose.Types.ObjectId(), __v: 1,
  name: 'Reserved shoe', brand: 'Nike', category: 'Sneaker',
  description: 'Product reservation fixture', image: '/shoe.svg', price: 200000,
  countInStock: 0, sizes: [40], color: legacy ? '' : 'White, Black',
  variants: legacy ? [] : [
    { color: 'White', size: 40, quantity: 0 },
    { color: 'Black', size: 40, quantity: 0 },
  ],
  checkoutReservations: ['pending-checkout'], isHidden: false, isArchived: false,
});
const install = (t, store) => {
  const lookup = t.mock.method(Product, 'findById', async () => Product.hydrate(store));
  const orders = t.mock.method(Order, 'exists', async () => null);
  const carts = t.mock.method(Customer, 'exists', async () => null);
  const saves = t.mock.method(Product.collection, 'updateOne', async (filter, update) => {
    if (filter.__v !== store.__v) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(store, update.$set);
    store.__v += update.$inc?.__v || 0;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  return { lookup, orders, carts, saves };
};
const removal = { variants: [{ color: 'Black', size: 40, quantity: 0 }], version: 1 };

for (const legacy of [false, true]) {
  for (const [name, controller] of [
    ['product update', updateProduct],
    ['stock endpoint', updateProductStock],
    ['upload preflight', validateProductUpdate],
  ]) {
    test(`${name} blocks ${legacy ? 'legacy conversion' : 'reserved variant removal'} even when neither Order nor cart query can see a reference`, async (t) => {
      const store = fields(legacy);
      const io = install(t, store);
      await assert.rejects(controller({ params: { id: String(store._id) }, body: removal }, response()), (error) => error.status === 409);
      assert.equal(io.orders.mock.callCount(), 0);
      assert.equal(io.carts.mock.callCount(), 0);
      assert.equal(io.saves.mock.callCount(), 0);
      assert.deepEqual(store.checkoutReservations, ['pending-checkout']);
      assert.equal(store.countInStock, 0);
      assert.equal(store.variants.length, legacy ? 0 : 2);
    });
  }
}

for (const legacy of [false, true]) {
  test(`an administrator read before a ${legacy ? 'legacy' : 'variant'} stock reservation cannot save a stale inventory shape`, async (t) => {
    const store = fields(legacy);
    store.__v = 0;
    store.checkoutReservations = [];
    const stale = Product.hydrate(store);
    const io = install(t, store);
    t.mock.method(Product, 'findById', async () => {
      // The stock reservation atomically inserts its hold and bumps __v while
      // the older product read is in flight. Its Order has not been saved.
      store.checkoutReservations = ['new-checkout'];
      store.__v = 1;
      return stale;
    });
    await assert.rejects(updateProduct({
      params: { id: String(store._id) }, body: { ...removal, version: 0 },
    }, response()), (error) => error.name === 'VersionError');
    assert.equal(io.saves.mock.callCount(), 1, 'Real Mongoose save must issue its version-conditional write');
    assert.deepEqual(store.checkoutReservations, ['new-checkout']);
    assert.equal(store.variants.length, legacy ? 0 : 2);
  });
}

test('metadata changes are allowed while inventory is reserved and cannot clear internal holds through the body', async (t) => {
  const store = fields();
  const io = install(t, store);
  const res = response();
  await updateProduct({
    params: { id: String(store._id) },
    body: { name: 'Renamed shoe', version: 1, checkoutReservations: [] },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.name, 'Renamed shoe');
  assert.deepEqual(store.checkoutReservations, ['pending-checkout']);
  assert.equal(io.orders.mock.callCount(), 0);
  assert.equal(io.carts.mock.callCount(), 0);
  assert.equal(io.saves.mock.callCount(), 1);
});

test('quantity edits retaining existing variants and new variant additions preserve checkout holds', async (t) => {
  const store = fields();
  const io = install(t, store);
  const res = response();
  await updateProduct({ params: { id: String(store._id) }, body: {
    version: 1, variants: [
      { color: 'White', size: 40, quantity: 5 },
      { color: 'Black', size: 40, quantity: 0 },
      { color: 'White', size: 41, quantity: 2 },
    ], checkoutReservations: [],
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.countInStock, 7);
  assert.deepEqual(store.checkoutReservations, ['pending-checkout']);
  assert.equal(store.variants.length, 3);
  assert.equal(io.orders.mock.callCount(), 0);
  assert.equal(io.carts.mock.callCount(), 0);
});

test('structural changes remain blocked until every outstanding checkout releases its own hold', async (t) => {
  const store = fields();
  store.checkoutReservations.push('another-checkout');
  install(t, store);
  t.mock.method(Product, 'updateOne', async (_filter, update) => {
    store.checkoutReservations = store.checkoutReservations.filter((token) => token !== update.$pull.checkoutReservations);
    store.__v += update.$inc.__v;
    return { matchedCount: 1 };
  });
  await releaseCheckoutReservations([{ product: store._id }], 'pending-checkout');
  await assert.rejects(updateProduct({
    params: { id: String(store._id) }, body: { ...removal, version: store.__v },
  }, response()), (error) => error.status === 409);
  assert.deepEqual(store.checkoutReservations, ['another-checkout']);

  await releaseCheckoutReservations([{ product: store._id }], 'another-checkout');
  const res = response();
  await updateProduct({ params: { id: String(store._id) }, body: { ...removal, version: store.__v } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.checkoutReservations, []);
  assert.deepEqual(store.variants.map((row) => row.color), ['Black']);
});

test('committed order and legacy cart guards still prevent shape changes after reservation holds are released', async (t) => {
  const store = fields(true);
  store.checkoutReservations = [];
  const io = install(t, store);
  t.mock.method(Order, 'exists', async () => ({ _id: new mongoose.Types.ObjectId() }));
  await assert.rejects(updateProduct({ params: { id: String(store._id) }, body: removal }, response()), (error) => error.status === 409);
  t.mock.method(Order, 'exists', async () => null);
  t.mock.method(Customer, 'exists', async () => ({ _id: new mongoose.Types.ObjectId() }));
  await assert.rejects(updateProduct({ params: { id: String(store._id) }, body: removal }, response()), (error) => error.status === 409);
  assert.equal(io.saves.mock.callCount(), 0);
});

test('product JSON/object output hides internal reservation tokens while internal documents retain them', () => {
  const product = Product.hydrate(fields());
  assert.deepEqual([...product.checkoutReservations], ['pending-checkout']);
  assert.equal(product.toJSON().checkoutReservations, undefined);
  assert.equal(product.toObject().checkoutReservations, undefined);
  assert.equal(JSON.parse(JSON.stringify({ product })).product.checkoutReservations, undefined);
  assert.deepEqual(product.toObject({ transform: false }).checkoutReservations, ['pending-checkout']);

  const customer = new Customer({
    email: 'reservation@example.test', password: 'test-password', name: 'Cart customer', phone: '0901234567',
    cart: [{ product: product._id, name: product.name, image: product.image, price: product.price, quantity: 1, color: 'White', size: 40 }],
  });
  customer.cart[0].product = product;
  const cartOutput = customer.cart[0].toObject();
  assert.equal(cartOutput.product.name, product.name, 'Fixture must use a populated product');
  assert.equal(cartOutput.product.checkoutReservations, undefined, 'Cart snapshot conversion must not expose internal tokens');
});

test('create product ignores checkout reservation tokens supplied by clients', async (t) => {
  let saved;
  t.mock.method(Product.prototype, 'save', async function () {
    await this.validate();
    saved = this;
    return this;
  });
  const productFields = fields();
  const res = response();
  await createProduct({ body: { ...productFields, checkoutReservations: ['forged-token'] } }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual([...saved.checkoutReservations], []);
});

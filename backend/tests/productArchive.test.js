import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Product from '../models/productModel.js';
import Customer from '../models/customerModel.js';
import Order from '../models/orderModel.js';
import {
  deleteProduct, toggleProductVisibility, updateProduct, updateProductStock,
} from '../controllers/productController.js';
import { addOrderItems, cancelOrder } from '../controllers/orderController.js';

const id = () => new mongoose.Types.ObjectId();
const response = () => ({
  statusCode: 200,
  status(value) { this.statusCode = value; return this; },
  json(value) { this.body = value; return this; },
});
const shoe = () => ({
  _id: id(), __v: 0, name: 'Giày lưu trữ', brand: 'Nike', category: 'Sneaker',
  description: 'Giày thử nghiệp vụ lưu trữ', image: '/shoe.jpg', price: 200000,
  color: 'Trắng', sizes: [40], countInStock: 1,
  variants: [{ color: 'Trắng', size: 40, quantity: 1 }],
  isHidden: false, isArchived: false,
});
const archiveMock = (t, store) => t.mock.method(Product, 'findOneAndUpdate', async (filter, update) => {
  assert.equal(String(filter._id), String(store._id));
  assert.deepEqual(filter.isArchived, { $ne: true });
  if (store.isArchived) return null;
  Object.assign(store, update.$set);
  store.__v += update.$inc.__v;
  return Product.hydrate(store);
});

for (const [name, controller, body] of [
  ['metadata edit', updateProduct, { name: 'Tên đã sửa', isHidden: false }],
  ['stock edit', updateProductStock, { version: 0, variants: [{ color: 'Trắng', size: 40, quantity: 2 }] }],
  ['visibility toggle', toggleProductVisibility, {}],
]) {
  test(`archive invalidates a ${name} that loaded before the archive, using the real Mongoose save version check`, async (t) => {
    const store = shoe();
    const stale = Product.hydrate(store);
    archiveMock(t, store);
    t.mock.method(Product, 'findById', async () => {
      // The response represents a read already in flight when archival won.
      await deleteProduct({ params: { id: String(store._id) } }, response());
      return stale;
    });
    let persistenceCalls = 0;
    t.mock.method(Product.collection, 'updateOne', async (filter) => {
      persistenceCalls += 1;
      assert.equal(filter.__v, 0);
      assert.equal(store.__v, 1);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    });
    await assert.rejects(
      controller({ params: { id: String(store._id) }, body }, response()),
      (error) => error.name === 'VersionError',
    );
    assert.equal(persistenceCalls, 1);
    assert.equal(store.isArchived, true);
    assert.equal(store.isHidden, true);
    assert.equal(store.countInStock, 1);
    assert.equal(store.name, 'Giày lưu trữ');
  });
}

test('archive returns not found for an unknown SKU without issuing a physical delete', async (t) => {
  t.mock.method(Product, 'findOneAndUpdate', async () => null);
  t.mock.method(Product, 'findById', async () => null);
  const deletion = t.mock.method(Product, 'deleteOne', async () => { throw new Error('No physical deletion'); });
  await assert.rejects(deleteProduct({ params: { id: String(id()) } }, response()), (error) => error.status === 404);
  assert.equal(deletion.mock.callCount(), 0);
});

for (const failSave of [false, true]) {
  test(`archiving the last reserved pair before order save preserves its SKU for ${failSave ? 'checkout rollback' : 'subsequent cancellation'}`, async (t) => {
    const store = shoe();
    const customerId = id();
    const cart = [{ product: store._id, name: store.name, image: store.image, price: store.price, color: 'Trắng', size: 40, quantity: 1 }];
    const customer = { _id: customerId, name: 'Khách thử', authVersion: 0, checkoutLock: null, cart };
    let orderStore;
    let restores = 0;
    let archivedBeforeSave = false;
    const productSnapshot = () => Product.hydrate(store);
    const deletion = t.mock.method(Product, 'deleteOne', async () => { throw new Error('Must retain the reserved SKU'); });
    t.mock.method(Product, 'findById', async () => productSnapshot());
    t.mock.method(Product, 'find', async () => [productSnapshot()]);
    t.mock.method(Product, 'exists', async () => true);
    const changeStock = (filter, update) => {
      if (update.$pull?.checkoutReservations) {
        store.checkoutReservations = (store.checkoutReservations || []).filter(token => token !== update.$pull.checkoutReservations);
        store.__v += update.$inc.__v;
        return true;
      }
      const variant = store.variants.find(row => row.color === filter.variants.$elemMatch.color && row.size === filter.variants.$elemMatch.size);
      if (!variant) return false;
      if (filter.countInStock.$gte != null && store.countInStock < filter.countInStock.$gte) return false;
      if (filter.countInStock.$lte != null && store.countInStock > filter.countInStock.$lte) return false;
      if (filter.variants.$elemMatch.quantity.$gte != null && variant.quantity < filter.variants.$elemMatch.quantity.$gte) return false;
      if (filter.variants.$elemMatch.quantity.$lte != null && variant.quantity > filter.variants.$elemMatch.quantity.$lte) return false;
      store.countInStock += update.$inc.countInStock;
      variant.quantity += update.$inc['variants.$.quantity'];
      store.__v += update.$inc.__v;
      if (update.$addToSet?.checkoutReservations) store.checkoutReservations = [...new Set([...(store.checkoutReservations || []), update.$addToSet.checkoutReservations])];
      return true;
    };
    t.mock.method(Product, 'findOneAndUpdate', async (filter, update) => {
      if (update.$set?.isArchived) {
        assert.equal(store.countInStock, 0, 'The final pair has already been reserved');
        assert.equal(orderStore, undefined, 'The Order has not been persisted yet');
        if (store.isArchived) return null;
        Object.assign(store, update.$set);
        store.__v += update.$inc.__v;
        return productSnapshot();
      }
      if (store.isHidden || store.isArchived || (filter.__v != null && filter.__v !== store.__v)) return null;
      return changeStock(filter, update) ? productSnapshot() : null;
    });
    t.mock.method(Product, 'updateOne', async (filter, update) => {
      // Returning stock is deliberately allowed for hidden/archived products.
      assert.equal(filter.isHidden, undefined);
      assert.equal(filter.isArchived, undefined);
      const matched = changeStock(filter, update);
      if (matched && update.$inc.countInStock > 0) restores += 1;
      return { matchedCount: Number(matched) };
    });
    t.mock.method(Customer, 'findOneAndUpdate', async (_filter, update) => {
      customer.checkoutLock = update.$set.checkoutLock;
      return customer;
    });
    t.mock.method(Customer, 'updateOne', async (filter, update) => {
      if (filter['checkoutLock.token'] !== customer.checkoutLock?.token) return { matchedCount: 0 };
      if (update.$set.cart) customer.cart = update.$set.cart;
      if (update.$set['checkoutLock.expiresAt']) customer.checkoutLock.expiresAt = update.$set['checkoutLock.expiresAt'];
      if (Object.hasOwn(update.$set, 'checkoutLock')) customer.checkoutLock = update.$set.checkoutLock;
      return { matchedCount: 1 };
    });
    t.mock.method(Order.prototype, 'save', async function () {
      const archived = response();
      await deleteProduct({ params: { id: String(store._id) } }, archived);
      assert.equal(archived.statusCode, 200);
      assert.equal(archived.body.message, 'Đã lưu trữ sản phẩm');
      assert.equal(store.isArchived, true);
      assert.equal(store.isHidden, true);
      archivedBeforeSave = true;
      this.isNew = false;
      orderStore = this.toObject();
      if (failSave) throw new Error('Simulated save acknowledgement failure after archival');
      return this;
    });
    t.mock.method(Order, 'findById', async () => orderStore ? new Order(orderStore) : null);
    const matchesOrder = filter => orderStore && Object.entries(filter).every(([key, value]) => {
      const actual = key.split('.').reduce((current, field) => current?.[field], orderStore);
      if (value && typeof value === 'object') {
        if ('$ne' in value) return actual !== value.$ne;
        if ('$exists' in value) return (actual !== undefined) === value.$exists;
      }
      return String(actual ?? null) === String(value);
    });
    t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
      if (!matchesOrder(filter)) return null;
      Object.assign(orderStore, update.$set);
      orderStore.__v = (orderStore.__v || 0) + (update.$inc?.__v || 0);
      return new Order(orderStore);
    });
    t.mock.method(Order, 'deleteOne', async filter => {
      if (!matchesOrder(filter)) return { deletedCount: 0 };
      orderStore = undefined;
      return { deletedCount: 1 };
    });
    const checkout = response();
    await addOrderItems({ user: { _id: customerId, authVersion: 0 }, body: {
      paymentMethod: 'COD', expectedTotalPrice: 230000,
      expectedCart: cart.map(({ product, color, size, quantity }) => ({ product: String(product), color, size, quantity })),
      shippingAddress: { name: 'Khách thử', phone: '0901234567', address: '10 Nguyễn Huệ', city: 'TP. Hồ Chí Minh' },
    } }, checkout);
    assert.equal(archivedBeforeSave, true);
    assert.equal(checkout.statusCode, failSave ? 500 : 201);
    if (!failSave) {
      const req = { params: { id: String(orderStore._id) }, user: { _id: customerId, isAdmin: false } };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const cancelled = response();
        await cancelOrder(req, cancelled);
        assert.equal(cancelled.statusCode, 200);
        assert.equal(cancelled.body.order.stockRestored, true);
      }
    }
    assert.equal(restores, 1);
    assert.equal(store.countInStock, 1);
    assert.deepEqual(store.variants, [{ color: 'Trắng', size: 40, quantity: 1 }]);
    assert.equal(store.isArchived, true);
    assert.equal(store.isHidden, true);
    assert.equal(deletion.mock.callCount(), 0);
  });
}

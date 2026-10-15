import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Customer from '../models/customerModel.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { getBestSellingProducts, updateProduct } from '../controllers/productController.js';
import { deleteVoucher } from '../controllers/voucherController.js';

const response = () => ({ json(body) { this.body = body; return this; } });
const valueAt = (document, path) => path.split('.').reduce((value, key) => value?.[key], document);
const matches = (document, filter) => Object.entries(filter).every(([key, condition]) => {
  if (key === '$or') return condition.some(branch => matches(document, branch));
  const value = valueAt(document, key);
  if (condition == null || typeof condition !== 'object') return value === condition;
  return Object.entries(condition).every(([operator, expected]) => {
    if (operator === '$ne') return value !== expected;
    if (operator === '$nin') return !expected.includes(value);
    if (operator === '$lte') return value !== undefined && value <= expected;
    if (operator === '$exists') return (value !== undefined) === expected;
    throw new Error(`Unsupported test query operator ${operator}`);
  });
});

test('best-selling products exclude paid failed deliveries, completed returns, cancellations and pending checkouts', async (t) => {
  const orders = [
    { isPaid: true, orderStatus: 'Đã giao', orderItems: [{ product: 'shoe-a', quantity: 2, price: 100000 }] },
    { checkoutState: 'committed', isPaid: true, orderStatus: 'Đang giao', orderItems: [{ product: 'shoe-a', quantity: 1, price: 120000 }] },
    { checkoutState: 'committed', isPaid: true, orderStatus: 'Giao thất bại', orderItems: [{ product: 'shoe-a', quantity: 20, price: 100000 }] },
    { checkoutState: 'committed', isPaid: true, orderStatus: 'Đã xử lý hoàn hàng', orderItems: [{ product: 'shoe-a', quantity: 30, price: 100000 }] },
    { checkoutState: 'committed', isPaid: true, orderStatus: 'Đã hủy', orderItems: [{ product: 'shoe-a', quantity: 40, price: 100000 }] },
    { checkoutState: 'pending', isPaid: true, orderStatus: 'Đang xử lý', orderItems: [{ product: 'shoe-a', quantity: 50, price: 100000 }] },
    { checkoutState: 'committed', isPaid: false, orderStatus: 'Đang xử lý', orderItems: [{ product: 'shoe-a', quantity: 60, price: 100000 }] },
  ];
  t.mock.method(Order, 'aggregate', async (pipeline) => {
    const visible = orders.filter(order => matches(order, pipeline[0].$match));
    const totals = new Map();
    for (const order of visible) for (const item of order.orderItems) {
      const total = totals.get(item.product) || { _id: item.product, totalSold: 0, totalRevenue: 0 };
      total.totalSold += item.quantity;
      total.totalRevenue += item.quantity * item.price;
      totals.set(item.product, total);
    }
    return [...totals.values()];
  });
  const res = response();
  await getBestSellingProducts({}, res);
  assert.deepEqual(res.body, [{ _id: 'shoe-a', totalSold: 3, totalRevenue: 320000 }]);
});

const legacyProduct = () => new Product({
  _id: new mongoose.Types.ObjectId(), __v: 0, name: 'Legacy shoe', brand: 'Test', category: 'Sneaker',
  description: 'Shared inventory', image: '/shoe.svg', price: 100000, countInStock: 3, sizes: [40], color: 'Trắng',
});
for (const [status, stockRestored, blocked] of [
  ['Giao thất bại', false, true],
  ['Đã xử lý hoàn hàng', false, false],
  ['Đã hủy', false, true],
  ['Đã hủy', true, false],
  ['Đã giao', false, false],
]) {
  test(`legacy conversion ${blocked ? 'waits' : 'is allowed'} for ${status}, stockRestored=${stockRestored}`, async (t) => {
    const product = legacyProduct();
    t.mock.method(Product, 'findById', async () => product);
    t.mock.method(Customer, 'exists', async () => null);
    t.mock.method(Order, 'exists', async (filter) => {
      assert.equal(String(filter['orderItems.product']), String(product._id));
      // The product reference is known to match. Evaluate the actual lifecycle
      // condition, including the older cancellation restoration safeguard.
      return matches({ orderStatus: status, stockRestored }, { $or: filter.$or }) ? { _id: 'order' } : null;
    });
    const save = t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
    const req = { params: { id: String(product._id) }, body: { version: 0, variants: [{ color: 'Trắng', size: 40, quantity: 3 }] } };
    if (blocked) {
      await assert.rejects(updateProduct(req, response()), error => error.status === 409);
      assert.equal(save.mock.callCount(), 0);
    } else {
      await updateProduct(req, response());
      assert.equal(save.mock.callCount(), 1);
      assert.equal(product.countInStock, 3);
    }
  });
}

test('completed failed-delivery orders still protect historical variant rows from removal', async (t) => {
  const product = legacyProduct();
  product.variants = [{ color: 'Trắng', size: 40, quantity: 3 }, { color: 'Đen', size: 40, quantity: 0 }];
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(Customer, 'exists', async () => null);
  t.mock.method(Order, 'exists', async (filter) => {
    assert.equal(filter.orderStatus, undefined, 'A historical variant reference must not be filtered out by lifecycle');
    assert.equal(filter.orderItems.$elemMatch.color, 'Trắng');
    return { _id: 'completed-return-order', orderStatus: 'Đã xử lý hoàn hàng' };
  });
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('Referenced variants must not be removed'); });
  await assert.rejects(updateProduct({
    params: { id: String(product._id) }, body: { version: 0, variants: [{ color: 'Đen', size: 40, quantity: 0 }] },
  }, response()), error => error.status === 409);
  assert.equal(save.mock.callCount(), 0);
});

for (const [name, fields] of [
  ['used voucher', { usedCount: 1, deliveryReturnHolds: [] }],
  ['return release not yet committed', { usedCount: 0, deliveryReturnHolds: ['return-order-token'] }],
]) {
  test(`voucher deletion rejects ${name} before issuing a delete`, async (t) => {
    t.mock.method(Voucher, 'findById', async () => ({ _id: 'voucher', __v: 1, ...fields }));
    const remove = t.mock.method(Voucher, 'deleteOne', async () => { throw new Error('Protected vouchers must not be deleted'); });
    await assert.rejects(deleteVoucher({ params: { id: 'voucher' } }, response()), error => error.status === 409);
    assert.equal(remove.mock.callCount(), 0);
  });
}

for (const [name, change] of [
  ['a return hold appears', store => { store.deliveryReturnHolds.push('return-order-token'); }],
  ['checkout consumes a usage', store => { store.usedCount = 1; }],
  ['an administrator edits the voucher', store => { store.__v += 1; }],
]) {
  test(`voucher deletion fails atomically when ${name} after its initial read`, async (t) => {
    const store = { _id: 'voucher', __v: 2, usedCount: 0, deliveryReturnHolds: [] };
    let exists = true;
    t.mock.method(Voucher, 'findById', async () => {
      const snapshot = structuredClone(store);
      change(store);
      return snapshot;
    });
    const remove = t.mock.method(Voucher, 'deleteOne', async (filter) => {
      if (!matches(store, filter)) return { deletedCount: 0 };
      exists = false;
      return { deletedCount: 1 };
    });
    await assert.rejects(deleteVoucher({ params: { id: 'voucher' } }, response()), error => error.status === 409);
    assert.equal(remove.mock.callCount(), 1);
    assert.equal(exists, true);
  });
}

for (const [name, fields] of [
  ['unused voucher', { usedCount: 0, deliveryReturnHolds: [] }],
  ['completed return with historical receipt', { usedCount: 0, deliveryReturnHolds: [], deliveryReturnReceipts: ['finished-order-token'] }],
  ['legacy unused voucher without return fields', {}],
]) {
  test(`voucher deletion allows ${name} when no pending return or active usage remains`, async (t) => {
    const store = { _id: 'voucher', __v: 2, ...fields };
    t.mock.method(Voucher, 'findById', async () => structuredClone(store));
    let deleted = false;
    t.mock.method(Voucher, 'deleteOne', async (filter) => {
      if (!matches(store, filter)) return { deletedCount: 0 };
      deleted = true;
      return { deletedCount: 1 };
    });
    const res = response();
    await deleteVoucher({ params: { id: 'voucher' } }, res);
    assert.equal(deleted, true);
    assert.deepEqual(res.body, { message: 'Đã xóa voucher' });
  });
}

test('voucher deletion still returns not-found for an unknown voucher', async (t) => {
  t.mock.method(Voucher, 'findById', async () => null);
  const remove = t.mock.method(Voucher, 'deleteOne', async () => { throw new Error('Cannot delete an unknown voucher'); });
  await assert.rejects(deleteVoucher({ params: { id: 'missing' } }, response()), error => error.status === 404);
  assert.equal(remove.mock.callCount(), 0);
});

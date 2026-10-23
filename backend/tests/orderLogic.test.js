import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import Voucher from '../models/voucherModel.js';
import { addOrderItems, cancelOrder, confirmOrderRefund, deleteOrder, getOrders, updatePaymentStatus } from '../controllers/orderController.js';
import { calculateOrderPricing, validateVoucherEligibility, validateOrderTransition } from '../utils/orderPricing.js';
import { checkoutCartKey } from '../utils/checkoutCart.js';

const id = () => new mongoose.Types.ObjectId();
const shipping = { name: 'Nguyễn An', phone: '0901234567', address: '10 Nguyễn Huệ', city: 'TP. Hồ Chí Minh', district: 'Quận 1', ward: 'Bến Nghé', notes: 'Gọi trước khi giao' };
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});
const product = (overrides = {}) => ({ _id: id(), name: 'Giày thử nghiệm', image: '/shoe.jpg', price: 200000, countInStock: 5, sizes: [38, 38.5, 39], isHidden: false, ...overrides });
const cartItem = (item, overrides = {}) => ({ product: item._id, name: 'Giá lưu trong giỏ đã cũ', price: 1, image: '/old.jpg', quantity: 1, size: 38, ...overrides });
const checkoutCarts = new Map();

const matchingVariant = (item, filter) => item?.variants?.find((row) => row.color === filter.variants?.$elemMatch.color && row.size === filter.variants?.$elemMatch.size);
const stockMatches = (item, filter) => {
  if (!item) return false;
  if (filter.__v != null && item.__v !== filter.__v) return false;
  if (filter.countInStock?.$gte != null && item.countInStock < filter.countInStock.$gte) return false;
  if (filter.countInStock?.$lte != null && item.countInStock > filter.countInStock.$lte) return false;
  if (filter.$or && item.variants?.length) return false;
  if (filter.variants) {
    const row = matchingVariant(item, filter);
    if (!row) return false;
    if (filter.variants.$elemMatch.quantity.$gte != null && row.quantity < filter.variants.$elemMatch.quantity.$gte) return false;
    if (filter.variants.$elemMatch.quantity.$lte != null && row.quantity > filter.variants.$elemMatch.quantity.$lte) return false;
  }
  return true;
};
const applyStockUpdate = (item, filter, update) => {
  if (update.$inc.countInStock !== undefined) item.countInStock += update.$inc.countInStock;
  if (update.$inc['variants.$.quantity'] != null) matchingVariant(item, filter).quantity += update.$inc['variants.$.quantity'];
  if (update.$addToSet?.checkoutReservations) item.checkoutReservations = [...new Set([...(item.checkoutReservations || []), update.$addToSet.checkoutReservations])];
  if (update.$pull?.checkoutReservations) item.checkoutReservations = (item.checkoutReservations || []).filter(token => token !== update.$pull.checkoutReservations);
  if (item.__v != null) item.__v += update.$inc.__v || 0;
};

const mockCheckout = (t, products, carts, options = {}) => {
  const customers = new Map(carts.map((cart) => [String(cart._id), { name: 'Khách hàng', authVersion: 0, checkoutLock: null, ...cart }]));
  for (const [customerId, customer] of customers) checkoutCarts.set(customerId, customer);
  const saved = [];
  const orders = new Map();
  const stockCalls = [];
  const voucher = options.voucher;
  t.mock.method(Customer, 'findOneAndUpdate', async (filter, update) => {
    const customer = customers.get(String(filter._id));
    if (!customer || customer.checkoutLock?.recoveryRequired || customer.checkoutLock?.expiresAt > new Date()) return null;
    customer.checkoutLock = update.$set.checkoutLock;
    return customer;
  });
  t.mock.method(Customer, 'updateOne', async (filter, update) => {
    const customer = customers.get(String(filter._id));
    if (!customer || customer.checkoutLock?.token !== filter['checkoutLock.token']) return { matchedCount: 0 };
    if (update.$set?.cart) customer.cart = update.$set.cart;
    if (Object.hasOwn(update.$set || {}, 'checkoutLock')) customer.checkoutLock = update.$set.checkoutLock;
    if (update.$set?.['checkoutLock.expiresAt']) customer.checkoutLock.expiresAt = update.$set['checkoutLock.expiresAt'];
    if (update.$set?.['checkoutLock.recoveryRequired']) customer.checkoutLock.recoveryRequired = true;
    return { matchedCount: 1 };
  });
  t.mock.method(Product, 'find', async () => products);
  t.mock.method(Product, 'findOneAndUpdate', async (filter, update) => {
    const item = products.find((entry) => String(entry._id) === String(filter._id));
    stockCalls.push({ filter, update });
    if (!stockMatches(item, filter) || String(item._id) === options.failProduct) return null;
    applyStockUpdate(item, filter, update);
    return item;
  });
  t.mock.method(Product, 'updateOne', async (filter, update) => {
    if (options.failRollback && update.$inc.countInStock !== undefined) throw new Error('Simulated rollback failure');
    const item = products.find((entry) => String(entry._id) === String(filter._id));
    if (options.missingRollback || !stockMatches(item, filter)) return { matchedCount: 0 };
    applyStockUpdate(item, filter, update);
    return { matchedCount: 1 };
  });
  t.mock.method(Voucher, 'findOne', async () => voucher || null);
  t.mock.method(Voucher, 'findOneAndUpdate', async () => {
    if (!voucher || options.failVoucher || voucher.usedCount >= voucher.maxUses) return null;
    voucher.usedCount += 1;
    return voucher;
  });
  t.mock.method(Voucher, 'updateOne', async (_filter, update) => {
    voucher.usedCount += update.$inc.usedCount;
    return { matchedCount: 1 };
  });
  t.mock.method(Order.prototype, 'save', async function () {
    this.isNew = false;
    const snapshot = this.toObject();
    saved.push(snapshot);
    orders.set(String(this._id), snapshot);
    // Simulate an ambiguous acknowledgement after the pending write persisted.
    // Rollback must prove ownership using the stored record, not isNew.
    if (options.failSave) throw new Error('Simulated write acknowledgement failure');
    return this;
  });
  t.mock.method(Order, 'findById', async value => orders.has(String(value)) ? new Order(orders.get(String(value))) : null);
  const matches = (record, filter) => record && Object.entries(filter).every(([field, value]) => value && typeof value === 'object' && '$ne' in value ? record[field] !== value.$ne : String(record[field] ?? null) === String(value));
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    const record = orders.get(String(filter._id));
    if (!matches(record, filter)) return null;
    Object.assign(record, update.$set);
    record.__v = (record.__v || 0) + (update.$inc?.__v || 0);
    return new Order(record);
  });
  t.mock.method(Order, 'deleteOne', async filter => {
    const record = orders.get(String(filter._id));
    if (!matches(record, filter)) return { deletedCount: 0 };
    orders.delete(String(filter._id));
    saved.splice(saved.findIndex(item => String(item._id) === String(filter._id)), 1);
    return { deletedCount: 1 };
  });
  return { customers, saved, stockCalls };
};
const checkoutRequest = (customerId, body = {}) => ({
  user: { _id: customerId, isAdmin: false, authVersion: 0 },
  body: {
    shippingAddress: shipping, paymentMethod: 'COD',
    expectedCart: checkoutCarts.get(String(customerId))?.cart.map(item => ({ product: String(item.product), color: item.color || '', size: item.size ?? null, quantity: item.quantity })),
    ...body,
  },
});

test('Checkout yêu cầu danh sách xác nhận; payload thiếu/sai không đọc giỏ hoặc giữ kho', async (t) => {
  const item = product();
  const customerId = id();
  const { saved, stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }]);
  const claim = t.mock.method(Customer, 'findOneAndUpdate', () => { throw new Error('Invalid confirmation must not claim the cart'); });
  for (const expectedCart of [undefined, null, [], {}, [{ product: 'invalid', quantity: 1 }], [{ product: String(item._id), size: 38, quantity: true }]]) {
    const res = response();
    await addOrderItems(checkoutRequest(customerId, { expectedCart }), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(claim.mock.callCount(), 0);
  assert.equal(saved.length, 0);
  assert.equal(stockCalls.length, 0);
});

test('Dấu xác nhận giỏ chuẩn hóa màu/size và thứ tự nhưng giữ sản phẩm, số lượng và số dòng', () => {
  const first = { product: String(id()), color: 'Trắng', size: 38.5, quantity: 1 };
  const second = { product: String(id()), color: '', size: null, quantity: 2 };
  assert.equal(checkoutCartKey([first, second]), checkoutCartKey([second, { ...first, color: ' TRẮNG '.normalize('NFD'), size: '38.5', quantity: '1' }]));
  assert.notEqual(checkoutCartKey([first]), checkoutCartKey([{ ...first, size: 39 }]));
  assert.notEqual(checkoutCartKey([first]), checkoutCartKey([{ ...first, quantity: 2 }]));
  assert.notEqual(checkoutCartKey([first]), checkoutCartKey([first, first]));
});

test('Giỏ đổi màu/size/sản phẩm/số lượng sau xác nhận đều trả 409 trước khi giữ hàng', async (t) => {
  const item = product({ sizes: [38, 39], countInStock: 10, variants: [{ color: 'Trắng', size: 38, quantity: 5 }, { color: 'Đen', size: 38, quantity: 5 }] });
  const customerId = id();
  const actual = cartItem(item, { color: 'Đen' });
  const { customers, saved, stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [actual] }]);
  const confirmed = { product: String(item._id), color: 'Đen', size: 38, quantity: 1 };
  for (const previous of [
    { ...confirmed, color: 'Trắng' }, { ...confirmed, size: 39 },
    { ...confirmed, product: String(id()) }, { ...confirmed, quantity: 2 },
  ]) {
    const res = response();
    await addOrderItems(checkoutRequest(customerId, { expectedCart: [previous], expectedTotalPrice: 230000 }), res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /giỏ đã thay đổi/);
    assert.equal(customers.get(String(customerId)).checkoutLock, null);
    assert.equal(customers.get(String(customerId)).cart[0].color, 'Đen');
  }
  assert.equal(saved.length, 0);
  assert.equal(stockCalls.length, 0);
  assert.equal(item.countInStock, 10);
  assert.equal(item.variants[1].quantity, 5);
});

test('Xác nhận đúng màu và size vẫn đặt hàng theo giá server', async (t) => {
  const item = product({ sizes: [38], countInStock: 5, variants: [{ color: 'Trắng', size: 38, quantity: 5 }] });
  const customerId = id();
  const { saved } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { color: 'Trắng' })] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId, { expectedCart: [{ product: String(item._id), color: ' trắng ', size: 38, quantity: 1 }], expectedTotalPrice: 230000 }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(saved[0].orderItems[0].color, 'Trắng');
  assert.equal(saved[0].orderItems[0].price, 200000);
  assert.equal(saved[0].totalPrice, 230000);
  assert.equal(item.variants[0].quantity, 4);
});

test('Miễn vận chuyển chỉ loại phí ship một lần; voucher tiền cố định không làm tổng âm', () => {
  assert.deepEqual(calculateOrderPricing(200000, { type: 'shipping', discount: 30000 }), { itemsPrice: 200000, shippingPrice: 0, discountAmount: 0, totalPrice: 200000 });
  assert.deepEqual(calculateOrderPricing(10000, { type: 'fixed', discount: 50000 }), { itemsPrice: 10000, shippingPrice: 30000, discountAmount: 10000, totalPrice: 30000 });
  assert.equal(calculateOrderPricing(199999, { type: 'percent', discount: 15 }).discountAmount, 30000);
  for (const value of [-1, Infinity, NaN, 1.5]) assert.throws(() => calculateOrderPricing(value));
  assert.throws(() => calculateOrderPricing(100000, { type: 'percent', discount: 101 }));
});

test('Voucher bắt buộc đúng thời gian, trạng thái, lượt và mức đơn tối thiểu', () => {
  const voucher = { type: 'percent', discount: 10, isActive: true, usedCount: 0, maxUses: 1, minOrder: 100000, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') };
  const now = new Date('2026-06-01');
  assert.equal(validateVoucherEligibility(voucher, 200000, now).totalPrice, 210000);
  for (const patch of [{ isActive: false }, { usedCount: 1 }, { startDate: new Date('2026-07-01') }, { endDate: new Date('2026-05-01') }, { minOrder: 200001 }]) {
    assert.throws(() => validateVoucherEligibility({ ...voucher, ...patch }, 200000, now));
  }
});

test('Schema từ chối số lượng âm/lẻ, tiền âm và size sai; chấp nhận nửa size', () => {
  const item = product();
  const valid = new Order({ user: id(), orderItems: [cartItem(item, { size: 38.5, price: 200000 })], shippingAddress: shipping, totalPrice: 230000 });
  assert.equal(valid.validateSync(), undefined);
  for (const quantity of [-1, 0, 1.5]) {
    const invalid = new Customer({ email: 'test@example.com', password: 'example', cart: [cartItem(item, { quantity })] });
    assert.ok(invalid.validateSync()?.errors['cart.0.quantity']);
  }
  const invalidProduct = new Product({ ...item, brand: 'Nike', category: 'Sneaker', description: 'Giày', sizes: [38.3], countInStock: -1, price: -1 });
  assert.ok(invalidProduct.validateSync()?.errors.sizes);
  assert.ok(invalidProduct.validateSync()?.errors.countInStock);
  assert.ok(invalidProduct.validateSync()?.errors.price);
  const invalidVoucher = new Voucher({ code: 'TEST', description: 'Voucher', type: 'percent', discount: 101, endDate: new Date(Date.now() + 86400000) });
  assert.ok(invalidVoucher.validateSync()?.errors.discount);
  const overused = new Voucher({ code: 'USED', description: 'Voucher', type: 'fixed', discount: 10000, maxUses: 1, usedCount: 2, endDate: new Date(Date.now() + 86400000) });
  assert.ok(overused.validateSync()?.errors.usedCount);
  const wrongCategory = new Product({ ...item, brand: 'Nike', category: 'Sách', description: 'Giày' });
  assert.ok(wrongCategory.validateSync()?.errors.category);
});

test('Checkout COD tính lại tiền từ Product, lưu size/địa chỉ và bỏ thông tin chuyển khoản', async (t) => {
  const item = product();
  const customerId = id();
  const { saved } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { quantity: 2, size: 38.5 })] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId, { paymentMethod: 'COD', totalPrice: 1, discountAmount: 999999, bankTransferInfo: { bankName: 'VCB', accountNumber: '123456', accountHolder: 'Nguyễn An', transferNote: 'Thanh toán đơn hàng' } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].totalPrice, 430000);
  assert.equal(saved[0].isPaid, false);
  assert.equal(saved[0].paidAt, undefined);
  assert.equal(saved[0].orderItems[0].price, 200000);
  assert.equal(saved[0].orderItems[0].size, 38.5);
  assert.deepEqual(saved[0].shippingAddress, shipping);
  assert.equal(saved[0].paymentMethod, 'COD');
  assert.equal(saved[0].bankTransferInfo?.accountHolder, undefined);
  assert.equal(item.countInStock, 3);
});

test('Checkout gộp các size cùng sản phẩm trước khi trừ kho', async (t) => {
  const item = product({ countInStock: 5 });
  const customerId = id();
  const { stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { quantity: 2, size: 38 }), cartItem(item, { quantity: 2, size: 39 })] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 201);
  assert.equal(item.countInStock, 1);
  assert.equal(stockCalls.length, 1);
  assert.equal(stockCalls[0].filter.countInStock.$gte, 4);
});

test('Giá thay đổi sau khi khách xác nhận: trả 409 trước khi giữ kho', async (t) => {
  const item = product();
  const customerId = id();
  const { saved, stockCalls, customers } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId, { expectedTotalPrice: 220000 }), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /đã thay đổi/);
  assert.equal(stockCalls.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(item.countInStock, 5);
  assert.equal(customers.get(String(customerId)).cart.length, 1);
  assert.equal(customers.get(String(customerId)).checkoutLock, null);
});

test('Tổng tiền xác nhận bắt buộc là số nguyên VND; giá khớp vẫn tạo đơn', async (t) => {
  const item = product();
  const customerId = id();
  const { saved, stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }]);
  for (const expectedTotalPrice of [true, [], '230000', null, -1, 230000.5]) {
    const res = response();
    await addOrderItems(checkoutRequest(customerId, { expectedTotalPrice }), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(stockCalls.length, 0);
  const confirmed = response();
  await addOrderItems(checkoutRequest(customerId, { expectedTotalPrice: 230000, totalPrice: 1 }), confirmed);
  assert.equal(confirmed.statusCode, 201);
  assert.equal(saved[0].totalPrice, 230000);
});

test('Checkout từ chối số lượng âm trước khi cập nhật kho', async (t) => {
  const item = product();
  const customerId = id();
  const { saved, stockCalls, customers } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { quantity: -1 })] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 400);
  assert.equal(stockCalls.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(item.countInStock, 5);
  assert.equal(customers.get(String(customerId)).checkoutLock, null);
});

test('Checkout không đoán size cho giỏ cũ chưa có size', async (t) => {
  const item = product();
  const customerId = id();
  const { saved } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { size: undefined })] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 400);
  assert.equal(saved.length, 0);
});

test('Hai khách mua đôi cuối cùng: chỉ một đơn thành công, tồn kho không âm', async (t) => {
  const item = product({ countInStock: 1 });
  const first = id();
  const second = id();
  const { saved } = mockCheckout(t, [item], [{ _id: first, cart: [cartItem(item)] }, { _id: second, cart: [cartItem(item)] }]);
  const responses = [response(), response()];
  await Promise.all([addOrderItems(checkoutRequest(first), responses[0]), addOrderItems(checkoutRequest(second), responses[1])]);
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [201, 409]);
  assert.equal(saved.length, 1);
  assert.equal(item.countInStock, 0);
});

test('Hai submit cùng giỏ: chỉ một đơn được tạo', async (t) => {
  const item = product();
  const customerId = id();
  const { saved } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }]);
  const responses = [response(), response()];
  await Promise.all(responses.map((res) => addOrderItems(checkoutRequest(customerId), res)));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [201, 409]);
  assert.equal(saved.length, 1);
  assert.equal(item.countInStock, 4);
});

test('Sản phẩm sau hết kho: hoàn lại phần kho đã giữ và giữ nguyên giỏ', async (t) => {
  const first = product();
  const second = product();
  const customerId = id();
  const { saved, customers } = mockCheckout(t, [first, second], [{ _id: customerId, cart: [cartItem(first), cartItem(second)] }], { failProduct: String(second._id) });
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 409);
  assert.equal(first.countInStock, 5);
  assert.equal(second.countInStock, 5);
  assert.equal(saved.length, 0);
  assert.equal(customers.get(String(customerId)).cart.length, 2);
});

test('Lưu đơn thất bại: hoàn kho và trả lượt voucher đã giữ', async (t) => {
  const item = product();
  const customerId = id();
  const voucher = { _id: id(), code: 'SAVE10', type: 'percent', discount: 10, isActive: true, usedCount: 0, maxUses: 1, minOrder: 0, startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 86400000) };
  mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }], { voucher, failSave: true });
  const res = response();
  await addOrderItems(checkoutRequest(customerId, { voucherCode: 'save10' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(item.countInStock, 5);
  assert.equal(voucher.usedCount, 0);
});

test('Bù kho lỗi: khóa đối soát không tự hết hạn rồi cho tạo đơn khác', async (t) => {
  const item = product();
  const customerId = id();
  const { customers } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }], { failSave: true, failRollback: true });
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 503);
  const customer = customers.get(String(customerId));
  assert.equal(customer.checkoutLock.recoveryRequired, true);
  customer.checkoutLock.expiresAt = new Date(Date.now() - 10000);
  const retry = response();
  await addOrderItems(checkoutRequest(customerId), retry);
  assert.equal(retry.statusCode, 409);
  assert.equal(item.countInStock, 4);
});

const mockCancellation = (t, orderData, products, options = {}) => {
  let store = new Order(orderData).toObject();
  let restores = 0;
  const snapshot = () => new Order(store);
  t.mock.method(Order, 'findById', async () => snapshot());
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    if (filter.orderStatus && store.orderStatus !== filter.orderStatus) return null;
    if (filter.cancellationLock !== undefined && (store.cancellationLock || null) !== filter.cancellationLock) return null;
    Object.assign(store, update.$set);
    return snapshot();
  });
  t.mock.method(Order, 'updateOne', async (_filter, update) => { Object.assign(store, update.$set); return { matchedCount: 1 }; });
  t.mock.method(Product, 'updateOne', async (filter, update) => {
    const item = products.find((entry) => String(entry._id) === String(filter._id));
    if (update.$inc.countInStock > 0 && String(filter._id) === options.failProduct) throw new Error('Simulated restore failure');
    if (!stockMatches(item, filter)) return { matchedCount: 0 };
    if (update.$inc.countInStock > 0) restores += 1;
    applyStockUpdate(item, filter, update);
    return { matchedCount: 1 };
  });
  t.mock.method(Product, 'exists', async (filter) => products.some((entry) => String(entry._id) === String(filter._id)));
  return { current: () => store, restores: () => restores };
};

test('Hủy đồng thời và retry không hoàn tồn kho hai lần', async (t) => {
  const item = product({ countInStock: 3 });
  const userId = id();
  const orderId = id();
  const state = mockCancellation(t, { _id: orderId, user: userId, orderItems: [cartItem(item, { quantity: 2 })], shippingAddress: shipping, totalPrice: 430000 }, [item]);
  const req = { params: { id: String(orderId) }, user: { _id: userId, isAdmin: false } };
  const responses = [response(), response()];
  await Promise.all(responses.map((res) => cancelOrder(req, res)));
  assert.equal(responses.filter((res) => res.statusCode === 200).length, 1);
  assert.equal(item.countInStock, 5);
  assert.equal(state.restores(), 1);
  assert.equal(state.current().stockRestored, true);
  const retry = response();
  await cancelOrder(req, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(item.countInStock, 5);
  assert.equal(state.restores(), 1);
});

test('Hủy lỗi giữa các sản phẩm: bù lại phần đã hoàn và trả trạng thái cũ', async (t) => {
  const first = product({ countInStock: 3 });
  const second = product({ countInStock: 3 });
  const userId = id();
  const orderId = id();
  const state = mockCancellation(t, { _id: orderId, user: userId, orderItems: [cartItem(first, { quantity: 2 }), cartItem(second, { quantity: 2 })], shippingAddress: shipping, totalPrice: 830000 }, [first, second], { failProduct: String(second._id) });
  const res = response();
  await cancelOrder({ params: { id: String(orderId) }, user: { _id: userId, isAdmin: false } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(first.countInStock, 3);
  assert.equal(second.countInStock, 3);
  assert.equal(state.current().orderStatus, 'Đang xử lý');
  assert.equal(state.current().cancellationLock, null);
});

test('Người dùng không được hủy đơn của người khác hay đơn đã xác nhận', async (t) => {
  const item = product();
  const owner = id();
  const orderId = id();
  mockCancellation(t, { _id: orderId, user: owner, orderItems: [cartItem(item)], shippingAddress: shipping, orderStatus: 'Đã xác nhận', totalPrice: 230000 }, [item]);
  const other = response();
  await cancelOrder({ params: { id: String(orderId) }, user: { _id: id(), isAdmin: false } }, other);
  assert.equal(other.statusCode, 403);
  const own = response();
  await cancelOrder({ params: { id: String(orderId) }, user: { _id: owner, isAdmin: false } }, own);
  assert.equal(own.statusCode, 400);
});

test('Đơn không nhảy ngược, BANK chưa trả tiền không giao; terminal không mở lại', () => {
  assert.throws(() => validateOrderTransition({ orderStatus: 'Đang xử lý', paymentMethod: 'COD' }, 'Đã giao'));
  assert.throws(() => validateOrderTransition({ orderStatus: 'Đã xác nhận', paymentMethod: 'BANK', isPaid: false }, 'Đang giao'));
  assert.doesNotThrow(() => validateOrderTransition({ orderStatus: 'Đã xác nhận', paymentMethod: 'BANK', isPaid: true }, 'Đang giao'));
  for (const status of ['Đã giao', 'Đã hủy']) assert.throws(() => validateOrderTransition({ orderStatus: status, paymentMethod: 'COD' }, 'Đang xử lý'));
});

test('DELETE yêu cầu admin, payment chỉ nhận boolean', async () => {
  const res = response();
  await deleteOrder({ user: { _id: id(), isAdmin: false }, params: { id: String(id()) } }, res);
  assert.equal(res.statusCode, 403);
  const payment = response();
  await updatePaymentStatus({ user: { isAdmin: true }, params: { id: String(id()) }, body: { isPaid: 'false' } }, payment);
  assert.equal(payment.statusCode, 400);
});

test('Checkout từ chối BANK kể cả payload hợp lệ trước khi khóa giỏ, giữ kho hoặc tạo đơn', async (t) => {
  const item = product();
  const customerId = id();
  const { saved, stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item)] }]);
  const claim = t.mock.method(Customer, 'findOneAndUpdate', () => { throw new Error('Removed payment method must not claim the cart'); });
  for (const bankTransferInfo of [undefined, { bankName: 'VCB', accountNumber: '123456', accountHolder: 'Nguyễn An' }, 'VCB', [], 123, { accountNumber: 123456 }]) {
    const res = response();
    await addOrderItems(checkoutRequest(customerId, { paymentMethod: 'BANK', bankTransferInfo }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /COD.*VNPAY/);
  }
  assert.equal(claim.mock.callCount(), 0);
  assert.equal(saved.length, 0);
  assert.equal(stockCalls.length, 0);
  assert.equal(item.countInStock, 5);
});

test('Tìm kiếm đơn coi dấu ngoặc và ký tự regex là văn bản thông thường', async (t) => {
  let query;
  t.mock.method(Order, 'find', (filter) => {
    query = filter;
    return { populate: () => ({ sort: async () => [] }) };
  });
  const res = response();
  const search = 'Nike (Air) + [x]';
  await getOrders({ user: { isAdmin: true }, query: { search } }, res);
  assert.equal(res.statusCode, 200);
  const regex = new RegExp(query.$or[0].$expr.$regexMatch.regex, 'i');
  assert.equal(regex.test(search), true);
  assert.equal(regex.test('Nike Air plus x'), false);
  assert.equal(regex.test('Nike (Air) + xxx'), false);
});

test('Hủy đơn đã thanh toán chờ hoàn tiền; xác nhận thủ công giữ lịch sử thanh toán', async (t) => {
  const item = product({ countInStock: 4 });
  const owner = id();
  const orderId = id();
  const state = mockCancellation(t, { _id: orderId, user: owner, orderItems: [cartItem(item)], shippingAddress: shipping, totalPrice: 230000, isPaid: true, paidAt: new Date() }, [item]);
  const cancelled = response();
  await cancelOrder({ params: { id: String(orderId) }, user: { _id: owner, isAdmin: false } }, cancelled);
  assert.equal(cancelled.statusCode, 200);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.current().isPaid, true);
  const refunded = response();
  await confirmOrderRefund({ params: { id: String(orderId) }, user: { isAdmin: true } }, refunded);
  assert.equal(refunded.statusCode, 200);
  assert.equal(state.current().refundStatus, 'refunded');
  assert.ok(state.current().refundedAt);
  assert.equal(state.current().isPaid, true);
  const retry = response();
  await confirmOrderRefund({ params: { id: String(orderId) }, user: { isAdmin: true } }, retry);
  assert.equal(retry.statusCode, 200);
});

test('Không được xóa đơn đã thanh toán còn chờ hoàn tiền', async (t) => {
  const orderId = id();
  t.mock.method(Order, 'findById', async () => ({ _id: orderId, orderStatus: 'Đã hủy', stockRestored: true, isPaid: true, refundStatus: 'pending' }));
  const deletion = t.mock.method(Order, 'deleteOne', async () => ({ deletedCount: 1 }));
  const res = response();
  await deleteOrder({ user: { isAdmin: true }, params: { id: String(orderId) } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(deletion.mock.callCount(), 0);
});

test('Checkout gộp đúng màu và size, trừ mỗi biến thể và tổng kho cùng một cập nhật', async (t) => {
  const item = product({ __v: 0, countInStock: 14, variants: [
    { color: 'Trắng', size: 38, quantity: 2 },
    { color: 'Đen', size: 38, quantity: 7 },
    { color: 'Trắng', size: 39, quantity: 5 },
  ] });
  const customerId = id();
  const { saved, stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [
    cartItem(item, { color: 'Trắng' }), cartItem(item, { color: 'trắng' }),
    cartItem(item, { color: 'Đen', quantity: 3 }), cartItem(item, { color: 'Trắng', size: 39, quantity: 2 }),
  ] }]);
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 201);
  assert.equal(item.countInStock, 7);
  assert.deepEqual(item.variants.map((row) => row.quantity), [0, 4, 3]);
  assert.deepEqual(saved[0].orderItems.map((row) => row.color), ['Trắng', 'Trắng', 'Đen', 'Trắng']);
  assert.ok(saved[0].orderItems.every((row) => row.inventoryVariant));
  assert.equal(stockCalls.length, 3);
  assert.deepEqual(stockCalls.map((call) => call.filter.__v), [0, 1, 2]);
  assert.deepEqual(stockCalls[0].filter.variants.$elemMatch, { color: 'Trắng', size: 38, quantity: { $gte: 2 } });
  assert.equal(stockCalls[0].update.$inc['variants.$.quantity'], -2);
});

test('Một màu hết hàng không được lấy tồn kho từ màu khác; checkout không đoán màu', async (t) => {
  const item = product({ countInStock: 10, variants: [
    { color: 'Trắng', size: 38, quantity: 0 }, { color: 'Đen', size: 38, quantity: 10 },
  ] });
  const customerId = id();
  const { customers, saved, stockCalls } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { color: 'Trắng' })] }]);
  const soldOut = response();
  await addOrderItems(checkoutRequest(customerId), soldOut);
  assert.equal(soldOut.statusCode, 409);
  assert.equal(item.countInStock, 10);
  assert.deepEqual(item.variants.map((row) => row.quantity), [0, 10]);
  customers.get(String(customerId)).cart[0].color = undefined;
  const missingColor = response();
  await addOrderItems(checkoutRequest(customerId), missingColor);
  assert.equal(missingColor.statusCode, 400);
  assert.equal(stockCalls.length, 1);
  assert.equal(saved.length, 0);
});

test('Hai khách mua đôi cuối của một biến thể: một đơn thành công dù màu khác vẫn còn kho', async (t) => {
  const item = product({ countInStock: 10, variants: [
    { color: 'Trắng', size: 38, quantity: 1 }, { color: 'Đen', size: 38, quantity: 9 },
  ] });
  const customerIds = [id(), id()];
  const { saved } = mockCheckout(t, [item], customerIds.map((_id) => ({ _id, cart: [cartItem(item, { color: 'Trắng' })] })));
  const responses = [response(), response()];
  await Promise.all(customerIds.map((customerId, index) => addOrderItems(checkoutRequest(customerId), responses[index])));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [201, 409]);
  assert.equal(saved.length, 1);
  assert.equal(item.countInStock, 9);
  assert.deepEqual(item.variants.map((row) => row.quantity), [0, 9]);
});

test('Lưu đơn lỗi hoàn lại chính xác từng biến thể đã giữ', async (t) => {
  const item = product({ countInStock: 10, variants: [
    { color: 'Trắng', size: 38, quantity: 4 }, { color: 'Đen', size: 38, quantity: 6 },
  ] });
  const customerId = id();
  mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { color: 'Trắng', quantity: 2 }), cartItem(item, { color: 'Đen', quantity: 3 })] }], { failSave: true });
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 500);
  assert.equal(item.countInStock, 10);
  assert.deepEqual(item.variants.map((row) => row.quantity), [4, 6]);
});

test('Bù kho không tìm thấy biến thể giữ khóa đối soát thay vì coi là thành công', async (t) => {
  const item = product({ countInStock: 4, variants: [{ color: 'Trắng', size: 38, quantity: 4 }] });
  const customerId = id();
  const { customers } = mockCheckout(t, [item], [{ _id: customerId, cart: [cartItem(item, { color: 'Trắng' })] }], { failSave: true, missingRollback: true });
  const res = response();
  await addOrderItems(checkoutRequest(customerId), res);
  assert.equal(res.statusCode, 503);
  assert.equal(customers.get(String(customerId)).checkoutLock.recoveryRequired, true);
  assert.equal(item.countInStock, 3);
  assert.equal(item.variants[0].quantity, 3);
});

test('Hủy đơn biến thể hoàn từng màu/size đúng một lần và đồng bộ tổng kho', async (t) => {
  const item = product({ countInStock: 5, variants: [
    { color: 'Trắng', size: 38, quantity: 1 }, { color: 'Đen', size: 38, quantity: 4 },
  ] });
  const owner = id();
  const orderId = id();
  const state = mockCancellation(t, { _id: orderId, user: owner, orderItems: [
    cartItem(item, { color: 'Trắng', quantity: 2, inventoryVariant: true }),
    cartItem(item, { color: 'Đen', quantity: 3, inventoryVariant: true }),
  ], shippingAddress: shipping, totalPrice: 1030000 }, [item]);
  const req = { params: { id: String(orderId) }, user: { _id: owner, isAdmin: false } };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = response();
    await cancelOrder(req, res);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(item.countInStock, 10);
  assert.deepEqual(item.variants.map((row) => row.quantity), [3, 7]);
  assert.equal(state.restores(), 2);
});

test('Hủy đơn không cộng kho tổng khi biến thể đã bị xóa hoặc đơn cũ chưa phân bổ màu', async (t) => {
  const item = product({ countInStock: 5, variants: [{ color: 'Đen', size: 38, quantity: 5 }] });
  const owner = id();
  const orderId = id();
  const state = mockCancellation(t, { _id: orderId, user: owner, orderItems: [
    cartItem(item, { color: 'Trắng', inventoryVariant: true }),
  ], shippingAddress: shipping, totalPrice: 230000 }, [item]);
  const req = { params: { id: String(orderId) }, user: { _id: owner, isAdmin: false } };
  const removedVariant = response();
  await cancelOrder(req, removedVariant);
  assert.equal(removedVariant.statusCode, 409);
  assert.equal(item.countInStock, 5);
  assert.equal(item.variants[0].quantity, 5);
  assert.equal(state.current().stockRestored, false);
  state.current().orderItems[0].inventoryVariant = false;
  state.current().orderItems[0].color = '';
  const oldOrder = response();
  await cancelOrder(req, oldOrder);
  assert.equal(oldOrder.statusCode, 409);
  assert.equal(item.countInStock, 5);
  assert.equal(item.variants[0].quantity, 5);
});

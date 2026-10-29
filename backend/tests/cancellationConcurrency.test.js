import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { cancelOrder, updatePaymentStatus } from '../controllers/orderController.js';

const id = () => new mongoose.Types.ObjectId();
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

// Return independent Mongoose snapshots, then apply each conditional write against
// the current stored document so the tests reproduce interleaved database updates.
const setupOrder = (t, options = {}) => {
  const ownerId = id();
  const orderId = id();
  const productId = id();
  const voucherId = id();
  const product = { countInStock: 3, variantQuantity: 3 };
  const voucher = { usedCount: 1 };
  let store = new Order({
    _id: orderId,
    __v: 0,
    user: ownerId,
    paymentMethod: 'BANK',
    isPaid: options.isPaid || false,
    ...(options.isPaid ? { paidAt: new Date() } : {}),
    orderItems: [{
      product: productId, name: 'Giày trắng', image: '/shoe.jpg',
      price: 200000, quantity: 2, size: 40, color: 'Trắng', inventoryVariant: true,
    }],
    shippingAddress: { name: 'Khách', phone: '0901234567', address: '10 Nguyễn Huệ', city: 'TP. Hồ Chí Minh' },
    totalPrice: 430000,
    voucher: { _id: voucherId, code: 'SAVE', type: 'fixed', discount: 10000 },
  }).toObject();
  const snapshot = () => new Order(store);
  const matches = (filter) => {
    if (filter.orderStatus !== undefined && filter.orderStatus !== store.orderStatus) return false;
    if (filter.isPaid !== undefined && filter.isPaid !== store.isPaid) return false;
    if (filter.cancellationLock !== undefined && filter.cancellationLock !== (store.cancellationLock || null)) return false;
    if (filter.stockRestored?.$ne !== undefined && filter.stockRestored.$ne === store.stockRestored) return false;
    if (filter.__v !== undefined && filter.__v !== store.__v) return false;
    return true;
  };
  const apply = (update) => {
    Object.assign(store, update.$set);
    store.__v += update.$inc?.__v || 0;
  };
  let beforeCancellationClaim;
  let beforePaymentWrite;
  const orderWrites = [];
  t.mock.method(Order, 'findById', async () => snapshot());
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    const claimingCancellation = typeof update.$set?.cancellationLock === 'string';
    const changingPayment = Object.hasOwn(update.$set || {}, 'isPaid');
    if (claimingCancellation && beforeCancellationClaim) {
      const run = beforeCancellationClaim;
      beforeCancellationClaim = undefined;
      await run();
    }
    if (changingPayment && beforePaymentWrite) {
      const run = beforePaymentWrite;
      beforePaymentWrite = undefined;
      await run();
    }
    orderWrites.push({ filter, update });
    if (!matches(filter)) return null;
    apply(update);
    return snapshot();
  });
  t.mock.method(Order, 'updateOne', async (filter, update) => {
    if (!matches(filter)) return { matchedCount: 0 };
    apply(update);
    return { matchedCount: 1 };
  });
  const stockUpdate = t.mock.method(Product, 'updateOne', async (filter, update) => {
    assert.equal(String(filter._id), String(productId));
    assert.deepEqual(filter.variants.$elemMatch.color, 'Trắng');
    assert.equal(filter.variants.$elemMatch.size, 40);
    product.countInStock += update.$inc.countInStock;
    product.variantQuantity += update.$inc['variants.$.quantity'];
    return { matchedCount: 1 };
  });
  t.mock.method(Product, 'exists', async () => true);
  const voucherUpdate = t.mock.method(Voucher, 'updateOne', async (filter, update) => {
    assert.equal(String(filter._id), String(voucherId));
    voucher.usedCount += update.$inc.usedCount || 0;
    return { matchedCount: 1 };
  });
  return {
    current: () => store,
    product, voucher, stockUpdate, voucherUpdate, orderWrites,
    cancelRequest: { params: { id: String(orderId) }, user: { _id: ownerId, isAdmin: false } },
    paymentRequest: (isPaid) => ({ params: { id: String(orderId) }, user: { _id: id(), isAdmin: true }, body: { isPaid } }),
    beforeCancellationClaim: (callback) => { beforeCancellationClaim = callback; },
    beforePaymentWrite: (callback) => { beforePaymentWrite = callback; },
  };
};

test('Payment confirmed after cancellation snapshot: reject without stock/voucher changes, retry requires refund', async (t) => {
  const state = setupOrder(t);
  const payment = response();
  state.beforeCancellationClaim(() => updatePaymentStatus(state.paymentRequest(true), payment));
  const cancelled = response();
  await cancelOrder(state.cancelRequest, cancelled);

  assert.equal(payment.statusCode, 200);
  assert.equal(cancelled.statusCode, 409);
  assert.equal(state.current().orderStatus, 'Đang xử lý');
  assert.equal(state.current().isPaid, true);
  assert.equal(state.current().cancellationLock, null);
  assert.equal(state.stockUpdate.mock.callCount(), 0);
  assert.equal(state.voucherUpdate.mock.callCount(), 0);
  assert.equal(state.product.countInStock, 3);
  assert.equal(state.voucher.usedCount, 1);

  const retry = response();
  await cancelOrder(state.cancelRequest, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.order.isPaid, true);
  assert.equal(retry.body.order.refundStatus, 'pending');
  assert.ok(retry.body.order.paidAt);
  assert.equal(retry.body.order.stockRestored, true);
  assert.equal(state.product.countInStock, 5);
  assert.equal(state.product.variantQuantity, 5);
  assert.equal(state.voucher.usedCount, 0);

  const repeated = response();
  await cancelOrder(state.cancelRequest, repeated);
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.body.order.refundStatus, 'pending');
  assert.equal(state.stockUpdate.mock.callCount(), 1);
  assert.equal(state.voucherUpdate.mock.calls.filter(call => call.arguments[1].$inc?.usedCount).length, 1);
});

test('Payment reversed after cancellation snapshot: reject before restoration, retry needs no refund', async (t) => {
  const state = setupOrder(t, { isPaid: true });
  const payment = response();
  state.beforeCancellationClaim(() => updatePaymentStatus(state.paymentRequest(false), payment));
  const cancelled = response();
  await cancelOrder(state.cancelRequest, cancelled);

  assert.equal(payment.statusCode, 200);
  assert.equal(cancelled.statusCode, 409);
  assert.equal(state.current().orderStatus, 'Đang xử lý');
  assert.equal(state.current().isPaid, false);
  assert.equal(state.stockUpdate.mock.callCount(), 0);
  assert.equal(state.voucherUpdate.mock.callCount(), 0);

  const retry = response();
  await cancelOrder(state.cancelRequest, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.order.isPaid, false);
  assert.equal(retry.body.order.refundStatus, 'not_required');
  assert.equal(state.stockUpdate.mock.callCount(), 1);
  assert.equal(state.voucherUpdate.mock.calls.filter(call => call.arguments[1].$inc?.usedCount).length, 1);
});

test('Cancellation claims first: a stale payment confirmation cannot change the cancelled order', async (t) => {
  const state = setupOrder(t);
  const cancelled = response();
  state.beforePaymentWrite(() => cancelOrder(state.cancelRequest, cancelled));
  const payment = response();
  await updatePaymentStatus(state.paymentRequest(true), payment);

  assert.equal(cancelled.statusCode, 200);
  assert.equal(payment.statusCode, 409);
  assert.equal(state.current().orderStatus, 'Đã hủy');
  assert.equal(state.current().isPaid, false);
  assert.equal(state.current().refundStatus, 'not_required');
  assert.equal(state.current().stockRestored, true);
  assert.equal(state.product.countInStock, 5);
  assert.equal(state.voucher.usedCount, 0);
});

test('Concurrent cancellations and retries restore a paid variant and voucher exactly once', async (t) => {
  const state = setupOrder(t, { isPaid: true });
  const responses = [response(), response()];
  await Promise.all(responses.map((res) => cancelOrder(state.cancelRequest, res)));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(state.current().refundStatus, 'pending');
  assert.equal(state.current().isPaid, true);
  assert.equal(state.product.countInStock, 5);
  assert.equal(state.product.variantQuantity, 5);
  assert.equal(state.voucher.usedCount, 0);

  const retry = response();
  await cancelOrder(state.cancelRequest, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(state.stockUpdate.mock.callCount(), 1);
  assert.equal(state.voucherUpdate.mock.calls.filter(call => call.arguments[1].$inc?.usedCount).length, 1);
});

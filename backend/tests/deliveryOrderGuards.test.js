import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import { updateOrderStatus, updatePaymentStatus, cancelOrder, confirmOrderRefund, deleteOrder } from '../controllers/orderController.js';
import { recordDeliveryFailure, completeDeliveryReturn } from '../controllers/deliveryController.js';
import { publicOrder, publicCustomerOrder } from '../utils/orderPresentation.js';
import { validateOrderTransition } from '../utils/orderPricing.js';

const id = () => new mongoose.Types.ObjectId();
const response = () => ({ statusCode: 200, body: undefined, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
const orderOf = (overrides = {}) => ({
  _id: id(), user: id(), checkoutState: 'committed', orderStatus: 'Giao thất bại',
  isPaid: true, isDelivered: false, stockRestored: false, cancellationLock: null,
  totalPrice: 230000, shippingPrice: 30000, refundStatus: 'pending',
  ...overrides,
});
const req = (order, body = {}) => ({ params: { id: String(order._id) }, user: { _id: id(), isAdmin: true }, body });

test('failure states cannot use ordinary payment, delivery, cancellation or deletion endpoints', async t => {
  const order = orderOf();
  t.mock.method(Order, 'findById', async () => order);
  const mutations = t.mock.method(Order, 'findOneAndUpdate', async () => { throw new Error('Unexpected mutation'); });
  const deletions = t.mock.method(Order, 'deleteOne', async () => { throw new Error('Unexpected deletion'); });
  for (const state of ['Giao thất bại', 'Đã xử lý hoàn hàng']) {
    order.orderStatus = state;
    for (const [handler, body] of [
      [updatePaymentStatus, { isPaid: true }], [updatePaymentStatus, { isPaid: false }],
      [updateOrderStatus, { orderStatus: 'Đã giao' }], [cancelOrder, {}], [deleteOrder, {}],
    ]) {
      const res = response(); await handler(req(order, body), res);
      assert.equal(res.statusCode, 400, handler.name + ': ' + state);
    }
  }
  assert.equal(mutations.mock.callCount(), 0);
  assert.equal(deletions.mock.callCount(), 0);
});

test('new states cannot bypass reason or inspection via the generic status endpoint', () => {
  for (const [current, next] of [['Đang giao', 'Giao thất bại'], ['Giao thất bại', 'Đã xử lý hoàn hàng'], ['Giao thất bại', 'Đã giao'], ['Đã xử lý hoàn hàng', 'Đang giao']]) {
    assert.throws(() => validateOrderTransition({ orderStatus: current, paymentMethod: 'COD', isPaid: false }, next));
  }
});

test('refund waits for completed inspection and rejects unpaid or zero-refund returns', async t => {
  const order = orderOf();
  t.mock.method(Order, 'findById', async () => order);
  const mutation = t.mock.method(Order, 'findOneAndUpdate', async () => { throw new Error('Unexpected refund'); });
  for (const changes of [
    { orderStatus: 'Giao thất bại', deliveryReturn: undefined },
    { orderStatus: 'Giao thất bại', deliveryReturn: { state: 'processing', refundAmount: 200000 } },
    { orderStatus: 'Đã xử lý hoàn hàng', deliveryReturn: { state: 'completed', refundAmount: 0 } },
    { orderStatus: 'Đã xử lý hoàn hàng', isPaid: false, deliveryReturn: { state: 'completed', refundAmount: 200000 } },
  ]) {
    Object.assign(order, { isPaid: true }, changes);
    const res = response(); await confirmOrderRefund(req(order), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(mutation.mock.callCount(), 0);
});

test('completed partial return can record refund without pretending damaged stock was restored', async t => {
  const order = orderOf({ orderStatus: 'Đã xử lý hoàn hàng', deliveryReturn: { state: 'completed', refundAmount: 200000, retainedShippingFee: 30000, token: 'secret', requestHash: 'private' } });
  t.mock.method(Order, 'findById', async () => order);
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.orderStatus, 'Đã xử lý hoàn hàng');
    assert.equal(filter['deliveryReturn.state'], 'completed');
    assert.equal(filter['deliveryReturn.refundAmount'], 200000);
    assert.equal(filter.isPaid, true);
    assert.equal(Object.hasOwn(filter, 'stockRestored'), false);
    Object.assign(order, update.$set); return order;
  });
  const first = response(); await confirmOrderRefund(req(order), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.refundStatus, 'refunded');
  assert.equal(first.body.deliveryReturn.refundAmount, 200000);
  assert.equal(first.body.isPaid, true);
  assert.equal(first.body.stockRestored, false);
  assert.equal(Object.hasOwn(first.body.deliveryReturn, 'token'), false);
  const retry = response(); await confirmOrderRefund(req(order), retry);
  assert.equal(retry.statusCode, 200);
});

test('a concurrent failure wins over a stale payment or delivery request without restoring COD payment', async t => {
  const current = orderOf({ orderStatus: 'Đang giao', isPaid: false, paymentMethod: 'COD' });
  t.mock.method(Order, 'findById', async () => ({ ...current }));
  t.mock.method(Order, 'findOneAndUpdate', async filter => {
    // Failure commits after the ordinary handler reads its shipping snapshot.
    current.orderStatus = 'Giao thất bại';
    assert.equal(filter.orderStatus, 'Đang giao');
    assert.equal(filter.isPaid, false);
    return null;
  });
  for (const [handler, body] of [[updateOrderStatus, { orderStatus: 'Đã giao' }], [updatePaymentStatus, { isPaid: true }]]) {
    current.orderStatus = 'Đang giao';
    const res = response(); await handler(req(current, body), res);
    assert.equal(res.statusCode, 409);
    assert.equal(current.isPaid, false);
    assert.equal(current.orderStatus, 'Giao thất bại');
  }
});

test('both delivery endpoints reject pending checkouts before touching inventory', async t => {
  const order = orderOf({ checkoutState: 'pending' });
  t.mock.method(Order, 'findById', async () => order);
  const product = t.mock.method(Product, 'updateOne', async () => { throw new Error('Unexpected stock update'); });
  const voucher = t.mock.method(Voucher, 'updateOne', async () => { throw new Error('Unexpected voucher update'); });
  for (const handler of [recordDeliveryFailure, completeDeliveryReturn]) {
    const res = response(); await handler(req(order, { reason: 'Khách từ chối nhận' }), res);
    assert.equal(res.statusCode, 409);
  }
  assert.equal(product.mock.callCount(), 0); assert.equal(voucher.mock.callCount(), 0);
});

test('public order responses hide internal return receipts and do not mutate documents', () => {
  const order = orderOf({ checkoutToken: 'checkout', cancellationLock: 'cancel', deliveryReturn: { state: 'processing', token: 'secret', requestHash: 'hash', refundAmount: 200000, recoveryRequired: true } });
  const exposed = publicOrder(order);
  assert.equal(Object.hasOwn(exposed, 'checkoutToken'), false);
  assert.equal(Object.hasOwn(exposed, 'checkoutState'), false);
  assert.equal(Object.hasOwn(exposed, 'cancellationLock'), false);
  assert.equal(Object.hasOwn(exposed.deliveryReturn, 'token'), false);
  assert.equal(Object.hasOwn(exposed.deliveryReturn, 'requestHash'), false);
  assert.equal(exposed.deliveryReturn.recoveryRequired, true);
  assert.equal(order.deliveryReturn.token, 'secret');
});

test('customer responses retain charged fees and refunds while hiding store costs and internal notes', () => {
  const order = orderOf({
    deliveryFailure: { reason: 'Khách từ chối nhận', notes: 'Ghi chú nội bộ', failedBy: id(), failedAt: new Date() },
    deliveryReturn: { state: 'completed', token: 'secret', requestHash: 'hash', refundAmount: 200000,
      retainedShippingFee: 30000, returnShippingCost: 25000, notes: 'Ghi chú kho', receivedBy: id(), recoveryRequired: false },
  });
  const customer = publicCustomerOrder(order);
  assert.equal(customer.deliveryFailure.reason, 'Khách từ chối nhận');
  assert.equal(Object.hasOwn(customer.deliveryFailure, 'notes'), false);
  assert.equal(Object.hasOwn(customer.deliveryFailure, 'failedBy'), false);
  for (const field of ['token', 'requestHash', 'returnShippingCost', 'notes', 'receivedBy', 'recoveryRequired']) {
    assert.equal(Object.hasOwn(customer.deliveryReturn, field), false, field);
  }
  assert.equal(customer.deliveryReturn.refundAmount, 200000);
  assert.equal(customer.deliveryReturn.retainedShippingFee, 30000);
  assert.equal(publicOrder(order).deliveryReturn.returnShippingCost, 25000);
  assert.equal(order.deliveryReturn.notes, 'Ghi chú kho');
});

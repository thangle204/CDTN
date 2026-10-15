import test from 'node:test';
import assert from 'node:assert/strict';
import Customer from '../models/customerModel.js';
import Order from '../models/orderModel.js';
import { getAllCustomers } from '../controllers/customerController.js';

const evaluate = (expression, order) => {
  if (typeof expression === 'string' && expression.startsWith('$')) return order[expression.slice(1)];
  if (Array.isArray(expression)) return expression.map(value => evaluate(value, order));
  if (expression == null || typeof expression !== 'object') return expression;
  if (expression.$eq) return evaluate(expression.$eq[0], order) === evaluate(expression.$eq[1], order);
  if (expression.$ne) return evaluate(expression.$ne[0], order) !== evaluate(expression.$ne[1], order);
  if (expression.$and) return expression.$and.every(value => evaluate(value, order));
  if (expression.$not) return !evaluate(expression.$not[0], order);
  if (expression.$in) return evaluate(expression.$in[1], order).includes(evaluate(expression.$in[0], order));
  if (expression.$cond) return evaluate(expression.$cond[evaluate(expression.$cond[0], order) ? 1 : 2], order);
  throw new Error(`Unsupported aggregation expression: ${JSON.stringify(expression)}`);
};

test('customer statistics count committed orders but exclude failed deliveries and cancellations from spending', async (t) => {
  const customer = { _id: 'customer', name: 'Buyer' };
  const orders = [
    { user: 'customer', checkoutState: undefined, isPaid: true, orderStatus: 'Đã giao', totalPrice: 100000 },
    { user: 'customer', checkoutState: 'committed', isPaid: true, orderStatus: 'Đã xác nhận', totalPrice: 200000 },
    { user: 'customer', checkoutState: 'pending', isPaid: true, orderStatus: 'Đang xử lý', totalPrice: 900000 },
    { user: 'customer', checkoutState: 'committed', isPaid: true, orderStatus: 'Giao thất bại', totalPrice: 800000 },
    { user: 'customer', checkoutState: 'committed', isPaid: true, orderStatus: 'Đã xử lý hoàn hàng', totalPrice: 700000 },
    { user: 'customer', checkoutState: 'committed', isPaid: true, orderStatus: 'Đã hủy', totalPrice: 600000 },
    { user: 'customer', checkoutState: 'committed', isPaid: false, orderStatus: 'Đang xử lý', totalPrice: 500000 },
  ];
  const query = { select() { return this; }, sort() { return this; }, lean: async () => [customer] };
  t.mock.method(Customer, 'find', () => query);
  t.mock.method(Order, 'aggregate', async (pipeline) => {
    // Interpret the relevant filter rather than returning a precomputed result
    // that could mask the absence of a pending-checkout exclusion.
    const excluded = pipeline.find(stage => stage.$match)?.$match.checkoutState?.$ne;
    const visible = orders.filter(order => excluded === undefined || order.checkoutState !== excluded);
    const spendExpression = pipeline.find(stage => stage.$group)?.$group.totalSpent.$sum;
    return [{ _id: customer._id, totalOrders: visible.length, totalSpent: visible
      .reduce((total, order) => total + evaluate(spendExpression, order), 0) }];
  });
  let body;
  await getAllCustomers({}, { json(value) { body = value; } });
  assert.equal(body[0].totalOrders, 6);
  assert.equal(body[0].totalSpent, 300000);
});

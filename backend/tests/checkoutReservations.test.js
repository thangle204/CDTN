import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Product from '../models/productModel.js';
import { releaseCheckoutReservations } from '../utils/checkoutReservations.js';

test('releasing a checkout deduplicates SKU selections and preserves other checkout holds', async (t) => {
  const firstId = new mongoose.Types.ObjectId();
  const secondId = new mongoose.Types.ObjectId();
  const rows = new Map([
    [String(firstId), { checkoutReservations: ['own-checkout', 'other-checkout'], __v: 3, countInStock: 5 }],
    [String(secondId), { checkoutReservations: ['own-checkout'], __v: 8, countInStock: 2 }],
  ]);
  const writes = t.mock.method(Product, 'updateOne', async (filter, update) => {
    assert.deepEqual(Object.keys(filter), ['_id'], 'An already released token must remain idempotent');
    assert.deepEqual(update, { $pull: { checkoutReservations: 'own-checkout' }, $inc: { __v: 1 } });
    const row = rows.get(String(filter._id));
    if (!row) return { matchedCount: 0 };
    row.checkoutReservations = row.checkoutReservations.filter((token) => token !== update.$pull.checkoutReservations);
    row.__v += update.$inc.__v;
    return { matchedCount: 1 };
  });
  const items = [
    { product: firstId, color: 'White', size: 40 },
    { product: { _id: firstId }, color: 'Black', size: 41 },
    { product: String(secondId) },
  ];
  assert.equal(await releaseCheckoutReservations(items, 'own-checkout'), undefined);
  assert.equal(writes.mock.callCount(), 2);
  assert.deepEqual(rows.get(String(firstId)), { checkoutReservations: ['other-checkout'], __v: 4, countInStock: 5 });
  assert.deepEqual(rows.get(String(secondId)), { checkoutReservations: [], __v: 9, countInStock: 2 });

  await releaseCheckoutReservations(items, 'own-checkout');
  assert.equal(writes.mock.callCount(), 4);
  assert.deepEqual(rows.get(String(firstId)).checkoutReservations, ['other-checkout']);
  assert.equal(rows.get(String(firstId)).countInStock, 5);
  assert.equal(rows.get(String(secondId)).countInStock, 2);
});

test('release reports failure if any reserved SKU is missing, after settling all writes', async (t) => {
  const completed = [];
  t.mock.method(Product, 'updateOne', async (filter) => {
    if (filter._id === 'missing') return { matchedCount: 0 };
    await Promise.resolve();
    completed.push(filter._id);
    return { matchedCount: 1 };
  });
  await assert.rejects(
    releaseCheckoutReservations([{ product: 'missing' }, { product: 'present' }], 'checkout'),
    (error) => error.status === 503,
  );
  assert.deepEqual(completed, ['present']);
});

test('release sanitizes database failures without clearing another token', async (t) => {
  t.mock.method(Product, 'updateOne', async (_filter, update) => {
    assert.deepEqual(update.$pull, { checkoutReservations: 'checkout' });
    throw new Error('PRIVATE_DATABASE_CONNECTION_DETAILS');
  });
  await assert.rejects(releaseCheckoutReservations([{ product: 'product' }], 'checkout'), (error) => {
    assert.equal(error.status, 503);
    assert.ok(!error.message.includes('PRIVATE_DATABASE_CONNECTION_DETAILS'));
    return true;
  });
});

test('release refuses empty/invalid tokens before issuing writes and handles an empty reservation list', async (t) => {
  const writes = t.mock.method(Product, 'updateOne', async () => { throw new Error('No writes expected'); });
  for (const token of ['', ' ', undefined, null, true]) {
    await assert.rejects(releaseCheckoutReservations([{ product: 'product' }], token), (error) => error.status === 503);
  }
  await releaseCheckoutReservations([], 'checkout');
  assert.equal(writes.mock.callCount(), 0);
});

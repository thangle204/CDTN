import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVariantSummary, getProductVariant, parseProductVariants } from '../utils/productVariants.js';
import { assertCartStock, findCartItem } from '../utils/cart.js';

test('variant rows keep color, half size and stock together and derive product summaries', () => {
  const variants = parseProductVariants([
    { color: ' Trắng ', size: '40', quantity: '20' },
    { color: 'trắng', size: 40.5, quantity: 0 },
    { color: 'Đen', size: 39, quantity: 7 },
  ]);
  assert.deepEqual(variants, [
    { color: 'Trắng', size: 40, quantity: 20 },
    { color: 'Trắng', size: 40.5, quantity: 0 },
    { color: 'Đen', size: 39, quantity: 7 },
  ]);
  const product = applyVariantSummary({ _id: 'shoe', name: 'Giày' }, variants);
  assert.equal(product.countInStock, 27);
  assert.deepEqual(product.sizes, [39, 40, 40.5]);
  assert.equal(product.color, 'Trắng, Đen');
  assert.equal(getProductVariant(product, '40', ' TRẮNG '), variants[0]);
  assert.equal(getProductVariant({ sizes: [40], countInStock: 5 }, 40), null);
  const longColor = 'a'.repeat(100);
  const longColorProduct = applyVariantSummary({}, parseProductVariants([{ color: longColor, size: 40, quantity: 1 }]));
  assert.equal(getProductVariant(longColorProduct, 40, longColor).color, longColor);
  assert.throws(() => parseProductVariants([{ color: `${longColor}a`, size: 40, quantity: 1 }]), error => error.status === 400);
});

test('variant validation rejects duplicate pairs, missing fields and invalid or overflowing quantities', () => {
  const row = { color: 'Trắng', size: 40, quantity: 20 };
  for (const value of [
    undefined, [], Array.from({ length: 101 }, () => row),
    [row, { ...row, color: ' trắng ' }],
    [{ ...row, color: '' }], [{ ...row, color: {} }], [{ ...row, size: '' }],
    [{ ...row, size: 40.25 }], [{ ...row, size: true }], [{ ...row, size: 61 }],
    [{ ...row, quantity: -1 }], [{ ...row, quantity: 1.5 }], [{ ...row, quantity: true }],
    [{ ...row, quantity: Number.MAX_SAFE_INTEGER }, { color: 'Đen', size: 40, quantity: 1 }],
  ]) assert.throws(() => parseProductVariants(value), error => error.status === 400);
});

test('cart identifies color plus size and limits only the selected variant inventory', () => {
  const product = applyVariantSummary({ _id: 'shoe', name: 'Giày' }, parseProductVariants([
    { color: 'Trắng', size: 40, quantity: 2 },
    { color: 'Đen', size: 40, quantity: 50 },
    { color: 'Trắng', size: 41, quantity: 0 },
  ]));
  const cart = [
    { _id: 'white-40', product: 'shoe', color: 'Trắng', size: 40, quantity: 1 },
    { _id: 'black-40', product: 'shoe', color: 'Đen', size: 40, quantity: 10 },
  ];
  assert.equal(findCartItem(cart, { productId: 'shoe', size: 40, color: 'trắng' }), cart[0]);
  assert.throws(() => findCartItem(cart, { productId: 'shoe', size: 40 }), error => error.status === 400);
  assert.doesNotThrow(() => assertCartStock(cart, product, 2, 'white-40', cart[0]));
  assert.throws(() => assertCartStock(cart, product, 3, 'white-40', cart[0]), error => error.status === 400);
  assert.throws(() => assertCartStock(cart, product, 1, undefined, { color: 'Trắng', size: 41 }), error => error.status === 400);
  assert.throws(() => getProductVariant(product, 40), error => error.status === 400);
  assert.throws(() => getProductVariant(product, 40, 'Đỏ'), error => error.status === 409);
});

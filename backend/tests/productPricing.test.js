import test from 'node:test';
import assert from 'node:assert/strict';
import { productPricing, productSalePrice } from '../../shared/productPricing.js';

test('product sales retain the original price and round the discount per pair in integer VND', () => {
  assert.deepEqual(productPricing({ price: 1000000, discountPercent: 15 }), { originalPrice: 1000000, discountPercent: 15, discountAmount: 150000, salePrice: 850000 });
  assert.equal(productSalePrice({ price: 199999, discountPercent: 15 }), 169999);
  assert.equal(productSalePrice({ price: 101, discountPercent: 50 }), 50);
  assert.equal(productSalePrice({ price: 101, discountPercent: 50 }) * 2, 100);
  assert.equal(productSalePrice({ price: Number.MAX_SAFE_INTEGER, discountPercent: 99 }), 90071992547410);
});

test('legacy, disabled and full discounts are supported without trusting a supplied sale price', () => {
  assert.equal(productSalePrice({ price: 200000 }), 200000);
  assert.equal(productSalePrice({ price: 200000, discountPercent: 0 }), 200000);
  assert.equal(productSalePrice({ price: 200000, discountPercent: 100 }), 0);
  assert.equal(productSalePrice({ price: 0, discountPercent: 20 }), 0);
  assert.equal(productSalePrice({ price: 200000, discountPercent: 20, salePrice: 1 }), 160000);
});

test('invalid source prices and sale percentages cannot enter order calculations', () => {
  for (const discountPercent of [-1, 101, 1.5, true, null, '', '10', NaN, Infinity, []]) {
    assert.throws(() => productPricing({ price: 200000, discountPercent }), { status: 400 });
  }
  for (const price of [-1, 0.5, Infinity, NaN, '200000', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => productPricing({ price }), { status: 400 });
  }
});

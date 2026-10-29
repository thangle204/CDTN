import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import Customer from '../models/customerModel.js';
import Product from '../models/productModel.js';
import Voucher from '../models/voucherModel.js';
import Order from '../models/orderModel.js';
import VoucherWallet from '../models/voucherWalletModel.js';

const secret = 'catalog-api-test-secret-only';
const customerId = '000000000000000000000011';
const productId = '000000000000000000000012';
const voucherId = '000000000000000000000013';
let databaseState = 1;
let server;
let baseUrl;
let originalReadyState;
const originalSecret = process.env.JWT_SECRET;
const queryOf = (value) => {
  const query = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  for (const method of ['select', 'populate', 'sort', 'lean']) query[method] = () => query;
  return query;
};
const token = () => jwt.sign({ id: customerId, accountType: 'customer', authVersion: 0 }, secret);
const installUser = (t, isAdmin = true) => t.mock.method(Customer, 'findById', () => queryOf({ _id: customerId, name: 'Catalog tester', isAdmin, isActive: true, authVersion: 0 }));
const request = async (path, { method = 'GET', body, auth = false } = {}) => {
  const response = await fetch(baseUrl + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: `Bearer ${token()}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, body: await response.json() };
};
const shoeFields = { name: 'Test sneaker', brand: 'Test brand', category: 'Sneaker', description: 'A test shoe', image: '/images/shoe.svg', price: 200000, countInStock: 3, sizes: [38, 39] };
const voucherFields = { code: 'TEST10', description: 'Test offer', type: 'percent', discount: 10, minOrder: 0, maxUses: 5, usedCount: 0, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z') };

before(async () => {
  process.env.JWT_SECRET = secret;
  originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => databaseState });
  server = createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalReadyState) Object.defineProperty(mongoose.connection, 'readyState', originalReadyState);
  else delete mongoose.connection.readyState;
  originalSecret === undefined ? delete process.env.JWT_SECRET : process.env.JWT_SECRET = originalSecret;
});

test('offline catalog and GET reviews serve marked sample data without touching MongoDB', async (t) => {
  databaseState = 0;
  t.after(() => { databaseState = 1; });
  const find = t.mock.method(Product, 'find', () => { throw new Error('No real database query allowed'); });
  const findOne = t.mock.method(Product, 'findOne', () => { throw new Error('No real database query allowed'); });
  const catalog = await request('/api/products?keyword=Nike&category=Sneaker');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers.get('x-demo-mode'), 'true');
  assert.ok(catalog.body.length > 0);
  assert.ok(catalog.body.every(product => product.brand === 'Nike' && product.category === 'Sneaker'));
  const reviews = await request('/api/products/mock-1/reviews');
  assert.equal(reviews.status, 200);
  assert.equal(reviews.headers.get('x-demo-mode'), 'true');
  assert.deepEqual(reviews.body, { reviews: [], numReviews: 0, rating: 0 });
  assert.equal(find.mock.callCount(), 0);
  assert.equal(findOne.mock.callCount(), 0);
  assert.equal((await request('/api/products/unknown-product/reviews')).status, 503);
  assert.equal((await request('/api/products', { method: 'POST', auth: true, body: shoeFields })).status, 503);
});

test('connected catalog escapes regex search and rejects structured query injection', async (t) => {
  let filter;
  t.mock.method(Product, 'find', value => { filter = value; return queryOf([]); });
  assert.equal((await request('/api/products?keyword=.*&category=Sneaker')).status, 200);
  assert.equal(filter.$or[0].name.$regex, '\\.\\*');
  assert.equal(filter.category, 'Sneaker');
  assert.deepEqual(filter.isHidden, { $ne: true });
  assert.deepEqual(filter.isArchived, { $ne: true });
  assert.equal((await request('/api/products?keyword=first&keyword=second')).status, 400);
});

test('GET reviews uses the stored review data and hides unavailable products', async (t) => {
  let product = { reviews: [{ _id: 'review-a', rating: 5, comment: 'Comfortable' }], numReviews: 1, rating: 5 };
  let lookup;
  t.mock.method(Product, 'findOne', async filter => { lookup = filter; return product; });
  const reviews = await request(`/api/products/${productId}/reviews`);
  assert.equal(reviews.status, 200);
  assert.equal(reviews.headers.get('x-demo-mode'), null);
  assert.equal(reviews.body.reviews[0].comment, 'Comfortable');
  assert.equal(reviews.body.numReviews, 1);
  assert.deepEqual(lookup.isHidden, { $ne: true });
  assert.deepEqual(lookup.isArchived, { $ne: true });
  product = null;
  assert.equal((await request(`/api/products/${productId}/reviews`)).status, 404);
});

test('catalog and voucher administrative endpoints require an administrator', async (t) => {
  installUser(t, false);
  for (const [path, method, body] of [
    ['/api/products/admin/all', 'GET'],
    ['/api/products', 'POST', shoeFields],
    [`/api/products/${productId}/validate-update`, 'POST', { name: 'Updated shoe', version: 0 }],
    [`/api/products/${productId}/stock`, 'PUT', { countInStock: 0 }],
    ['/api/vouchers/admin/all', 'GET'],
    ['/api/vouchers/create', 'POST', voucherFields],
    [`/api/vouchers/${voucherId}/toggle-visibility`, 'PUT', {}],
  ]) {
    assert.equal((await request(path, { method, body })).status, 401, path);
    assert.equal((await request(path, { method, body, auth: true })).status, 403, path);
  }
});

test('admin product creation normalizes color/size rows and derives totals instead of trusting summary fields', async (t) => {
  installUser(t);
  let saved;
  t.mock.method(Product.prototype, 'save', async function () { await this.validate(); saved = this; return this; });
  const created = await request('/api/products', { method: 'POST', auth: true, body: {
    ...shoeFields, price: 0, countInStock: 999, sizes: [60], color: 'Wrong summary',
    variants: [{ color: ' Trắng ', size: '39', quantity: '0' }, { color: 'trắng', size: 38.5, quantity: 0 }],
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.price, 0);
  assert.equal(created.body.countInStock, 0);
  assert.deepEqual(created.body.sizes, [38.5, 39]);
  assert.equal(created.body.color, 'Trắng');
  assert.deepEqual(created.body.variants, [{ color: 'Trắng', size: 39, quantity: 0 }, { color: 'Trắng', size: 38.5, quantity: 0 }]);
  assert.equal(saved.name, shoeFields.name);
});

test('admin creation saves a gallery, detailed specifications and article sections together', async t => {
  installUser(t);
  t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const images = ['/uploads/products/front.jpg', '/uploads/products/back.jpg'];
  const result = await request('/api/products', { method: 'POST', auth: true, body: {
    ...shoeFields, image: images[0], images, material: ' Mesh ', origin: ' Store supplied ', gender: 'Unisex', modelCode: ' MODEL-1 ',
    variants: [{ color: 'White', size: 40, quantity: 5 }],
    contentSections: [{ title: ' Design ', body: 'First paragraph\n\n- Soft lining\n- Rubber sole', image: images[1], caption: ' Back view ' }],
  } });
  assert.equal(result.status, 201, result.body.message);
  assert.deepEqual(result.body.images, images); assert.equal(result.body.image, images[0]);
  assert.equal(result.body.material, 'Mesh'); assert.equal(result.body.modelCode, 'MODEL-1');
  assert.equal(result.body.contentSections[0].image, images[1]); assert.equal(result.body.contentSections[0].caption, 'Back view');
  assert.equal(result.body.countInStock, 5);
});

test('invalid gallery/article payloads never reach product persistence', async t => {
  installUser(t);
  const save = t.mock.method(Product.prototype, 'save', () => { throw new Error('Invalid media must not persist'); });
  for (const patch of [{ images: [] }, { images: 'not-an-array' }, { images: [shoeFields.image, shoeFields.image] }, { images: ['/different.jpg'] }, { images: Array.from({ length: 11 }, (_, i) => `/image-${i}.jpg`) }, { gender: 'Invalid' }, { contentSections: [{ body: 'Text', image: '/outside-gallery.jpg' }] }, { contentSections: [{ title: 'Empty section' }] }]) {
    const result = await request('/api/products', { method: 'POST', auth: true, body: { ...shoeFields, variants: [{ color: 'White', size: 40, quantity: 5 }], ...patch } });
    assert.equal(result.status, 400, JSON.stringify(patch));
  }
  assert.equal(save.mock.callCount(), 0);
});

test('gallery and article edits preserve legacy shared inventory and its migration guards', async t => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 4, images: [shoeFields.image] });
  t.mock.method(Product, 'findById', async () => product);
  const orderLookup = t.mock.method(Order, 'exists', () => { throw new Error('Metadata edit must not inspect inventory migration'); });
  const cartLookup = t.mock.method(Customer, 'exists', () => { throw new Error('Metadata edit must not inspect inventory migration'); });
  t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const result = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { version: 4, images: [shoeFields.image, '/detail.jpg'], contentSections: [{ title: 'Care', body: 'Dry naturally', image: '/detail.jpg' }], material: 'Canvas' } });
  assert.equal(result.status, 200, result.body.message);
  assert.equal(result.body.countInStock, shoeFields.countInStock); assert.deepEqual(result.body.sizes, shoeFields.sizes);
  assert.equal(result.body.variants.length, 0); assert.equal(orderLookup.mock.callCount(), 0); assert.equal(cartLookup.mock.callCount(), 0);
});

test('article preflight checks a detached candidate and rejects removed inline image references', async t => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 2, images: [shoeFields.image, '/detail.jpg'], contentSections: [{ body: 'Existing detail', image: '/detail.jpg' }] });
  t.mock.method(Product, 'findById', async () => product);
  const save = t.mock.method(Product.prototype, 'save', () => { throw new Error('Preflight must not save'); });
  const before = product.toObject();
  const invalid = await request(`/api/products/${productId}/validate-update`, { method: 'POST', auth: true, body: { version: 2, images: [shoeFields.image] } });
  assert.equal(invalid.status, 400); assert.deepEqual(product.toObject(), before);
  const valid = await request(`/api/products/${productId}/validate-update`, { method: 'POST', auth: true, body: { version: 2, images: [shoeFields.image], contentSections: [{ body: 'Text only' }] } });
  assert.equal(valid.status, 200); assert.deepEqual(product.toObject(), before); assert.equal(save.mock.callCount(), 0);
});

test('long Vietnamese product articles exceed 64KB safely while ordinary API body limits stay unchanged', async t => {
  installUser(t);
  t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const body = { ...shoeFields, variants: [{ color: 'White', size: 40, quantity: 5 }], contentSections: Array.from({ length: 4 }, () => ({ body: 'ấ'.repeat(9000) })) };
  assert(Buffer.byteLength(JSON.stringify(body)) > 65536);
  assert.equal((await request('/api/products', { method: 'POST', auth: true, body })).status, 201);
  assert.equal((await request('/api/orders', { method: 'POST', auth: true, body: { padding: 'x'.repeat(70000) } })).status, 413);
  assert.equal((await request('/api/products', { method: 'POST', auth: true, body: { padding: 'x'.repeat(530000) } })).status, 413);
});

test('admin product endpoint rejects invalid category, image and inventory rows before save', async (t) => {
  installUser(t);
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('Invalid products must not save'); });
  for (const override of [
    { category: 'Phone' }, { price: true }, { price: -1 }, { image: 'javascript:alert(1)' },
    { variants: undefined }, { variants: [] }, { variants: [{ color: '', size: 40, quantity: 20 }] },
    { variants: [{ color: 'Trắng', size: 38.25, quantity: 20 }] },
    { variants: [{ color: 'Trắng', size: true, quantity: 20 }] },
    { variants: [{ color: 'Trắng', size: 40, quantity: -1 }] },
    { variants: [{ color: 'Trắng', size: 40, quantity: 1.5 }] },
    { variants: [{ color: 'Trắng', size: 40, quantity: true }] },
    { variants: [{ color: 'Trắng', size: 40, quantity: 20 }, { color: ' trắng ', size: '40', quantity: 10 }] },
  ]) {
    const result = await request('/api/products', { method: 'POST', auth: true, body: { ...shoeFields, variants: [{ color: 'Trắng', size: 40, quantity: 20 }], ...override } });
    assert.equal(result.status, 400, JSON.stringify(override));
  }
  assert.equal(save.mock.callCount(), 0);
});

test('variant product schema rejects mismatched aggregate stock and duplicate rows', async () => {
  const fields = { ...shoeFields, countInStock: 20, sizes: [40], variants: [{ color: 'Trắng', size: 40, quantity: 20 }] };
  await new Product(fields).validate();
  for (const overrides of [
    { countInStock: 21 },
    { variants: [{ color: 'Trắng', size: 40, quantity: 10 }, { color: 'trắng', size: 40, quantity: 10 }] },
    { variants: [{ color: 'Trắng', size: 40, quantity: -1 }] },
    { variants: [{ color: 'Trắng', size: 40.25, quantity: 20 }] },
  ]) await assert.rejects(new Product({ ...fields, ...overrides }).validate(), error => error.name === 'ValidationError');
});

test('product edit rejects stale inventory version and preserves canonical color for order restoration', async (t) => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 4, color: 'Trắng', sizes: [40], countInStock: 20, variants: [{ color: 'Trắng', size: 40, quantity: 20 }] });
  t.mock.method(Product, 'findById', async () => product);
  const save = t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const body = { variants: [{ color: 'trắng', size: 40, quantity: 15 }], version: 3 };
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body })).status, 409);
  assert.equal(save.mock.callCount(), 0);
  const missingVersion = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { variants: body.variants } });
  assert.equal(missingVersion.status, 400);
  const edited = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { ...body, version: 4 } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.countInStock, 15);
  assert.equal(edited.body.variants[0].color, 'Trắng');
  assert.equal((await request(`/api/products/${productId}/stock`, { method: 'PUT', auth: true, body: { countInStock: 50 } })).status, 400);
  const stock = await request(`/api/products/${productId}/stock`, { method: 'PUT', auth: true, body: { ...body, version: 4 } });
  assert.equal(stock.status, 200);
  assert.equal(stock.body.variants[0].color, 'Trắng');
  const addedSize = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { version: 4, variants: [...body.variants, { color: 'trắng', size: 41, quantity: 2 }] } });
  assert.equal(addedSize.status, 200);
  assert.equal(addedSize.body.countInStock, 17);
  assert.equal(addedSize.body.color, 'Trắng');
  assert.deepEqual(addedSize.body.variants.map(variant => variant.color), ['Trắng', 'Trắng']);
});

test('a color/size referenced by cart or order cannot be removed but can be set to zero', async (t) => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 1, color: 'Trắng, Đen', sizes: [40], countInStock: 21, variants: [{ color: 'Trắng', size: 40, quantity: 20 }, { color: 'Đen', size: 40, quantity: 1 }] });
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(Order, 'exists', async () => true);
  t.mock.method(Customer, 'exists', async () => false);
  t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const removal = { variants: [{ color: 'Đen', size: 40, quantity: 1 }], version: 1 };
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: removal })).status, 409);
  const retained = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { ...removal, variants: [{ color: 'Trắng', size: 40, quantity: 0 }, ...removal.variants] } });
  assert.equal(retained.status, 200);
  assert.equal(retained.body.countInStock, 1);
});

test('legacy inventory conversion waits for carts and active orders before allocating rows', async (t) => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 0 });
  t.mock.method(Product, 'findById', async () => product);
  let ordered = true;
  let inCart = false;
  t.mock.method(Order, 'exists', async () => ordered);
  t.mock.method(Customer, 'exists', async () => inCart);
  t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const body = { variants: [{ color: 'Trắng', size: 38, quantity: 3 }], version: 0 };
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body })).status, 409);
  ordered = false;
  inCart = true;
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body })).status, 409);
  inCart = false;
  const converted = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body });
  assert.equal(converted.status, 200);
  assert.equal(converted.body.variants[0].quantity, 3);
});

test('legacy metadata edits preserve shared inventory without querying cart or order migration guards', async (t) => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 4, color: 'Trắng' });
  const inventory = { countInStock: product.countInStock, sizes: [...product.sizes], color: product.color, variants: product.variants.toObject() };
  t.mock.method(Product, 'findById', async () => product);
  const orderLookup = t.mock.method(Order, 'exists', async () => { throw new Error('Metadata edits must not inspect active orders'); });
  const cartLookup = t.mock.method(Customer, 'exists', async () => { throw new Error('Metadata edits must not inspect carts'); });
  const save = t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  const body = { name: 'Updated legacy sneaker', brand: 'Updated brand', description: 'Updated description', category: 'Giày thể thao', price: 250000, image: '/uploads/products/new-image.png', version: 4 };
  const edited = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body });
  assert.equal(edited.status, 200);
  for (const [field, value] of Object.entries(body)) if (field !== 'version') assert.equal(edited.body[field], value);
  assert.deepEqual({ countInStock: edited.body.countInStock, sizes: edited.body.sizes, color: edited.body.color, variants: edited.body.variants }, inventory);
  assert.equal(orderLookup.mock.callCount(), 0);
  assert.equal(cartLookup.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 1);
});

test('metadata preflight validates a detached candidate without changing the loaded legacy product', async (t) => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 2, color: 'Trắng' });
  const before = product.toObject();
  t.mock.method(Product, 'findById', async () => product);
  const orderLookup = t.mock.method(Order, 'exists', async () => true);
  const cartLookup = t.mock.method(Customer, 'exists', async () => true);
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('Preflight must not persist'); });
  const result = await request(`/api/products/${productId}/validate-update`, { method: 'POST', auth: true, body: { name: 'Changed name', price: 300000, image: '/uploads/products/new-image.png', version: 2 } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  assert.deepEqual(product.toObject(), before);
  assert.equal(orderLookup.mock.callCount(), 0);
  assert.equal(cartLookup.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
});

test('conversion preflight blocks used legacy inventory and final update checks again after a successful preflight', async (t) => {
  installUser(t);
  const product = new Product({ ...shoeFields, _id: productId, __v: 0 });
  const before = product.toObject();
  t.mock.method(Product, 'findById', async () => product);
  let ordered = true;
  let inCart = false;
  t.mock.method(Order, 'exists', async () => ordered);
  t.mock.method(Customer, 'exists', async () => inCart);
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('Blocked update and preflight must not persist'); });
  const body = { variants: [{ color: 'Trắng', size: 38, quantity: 3 }], version: 0 };
  const preflight = () => request(`/api/products/${productId}/validate-update`, { method: 'POST', auth: true, body });
  assert.equal((await preflight()).status, 409);
  ordered = false;
  inCart = true;
  assert.equal((await preflight()).status, 409);
  inCart = false;
  assert.equal((await preflight()).status, 200);
  assert.deepEqual(product.toObject(), before);
  inCart = true;
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body })).status, 409);
  assert.deepEqual(product.toObject(), before);
  assert.equal(save.mock.callCount(), 0);
});

test('product preflight rejects stale versions, invalid fields and archived or missing products without saving', async (t) => {
  installUser(t);
  const original = new Product({ ...shoeFields, _id: productId, __v: 3 });
  let product = original;
  t.mock.method(Product, 'findById', async () => product);
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('Preflight must not persist'); });
  const preflight = body => request(`/api/products/${productId}/validate-update`, { method: 'POST', auth: true, body });
  assert.equal((await preflight({ name: 'Changed', version: 2 })).status, 409);
  assert.equal((await preflight({ variants: [{ color: 'Trắng', size: 38, quantity: 3 }] })).status, 400);
  assert.equal((await preflight({ variants: [{ color: 'Trắng', size: 38, quantity: '' }], version: 3 })).status, 400);
  assert.equal((await preflight({ image: 'javascript:alert(1)', version: 3 })).status, 400);
  assert.equal((await preflight({ name: '', version: 3 })).status, 400);
  // The detached candidate runs schema validation as well as controller validation.
  product.sizes = [38, 38];
  assert.equal((await preflight({ name: 'Changed', version: 3 })).status, 400);
  product.isArchived = true;
  assert.equal((await preflight({ name: 'Changed', version: 3 })).status, 409);
  product = null;
  assert.equal((await preflight({ name: 'Changed', version: 3 })).status, 404);
  assert.equal(save.mock.callCount(), 0);
});

test('product and voucher schemas reject impossible numeric/date values without connecting', async () => {
  for (const overrides of [{ price: -1 }, { price: 0.5 }, { countInStock: -1 }, { countInStock: 1.5 }, { sizes: [38, 38] }, { sizes: [38.25] }, { sizes: [61] }, { reviews: [{ name: 'Tester', rating: 6, comment: 'Review', user: customerId }] }]) {
    await assert.rejects(new Product({ ...shoeFields, ...overrides }).validate(), error => error.name === 'ValidationError');
  }
  for (const overrides of [{ discount: 101 }, { discount: -1 }, { maxUses: 0 }, { usedCount: -1 }, { minOrder: 0.5 }, { endDate: new Date('2025-01-01') }]) {
    await assert.rejects(new Voucher({ ...voucherFields, ...overrides }).validate(), error => error.name === 'ValidationError');
  }
  await new Product({ ...shoeFields, price: 0, countInStock: 0, sizes: [38.5] }).validate();
  await new Voucher({ ...voucherFields, discount: 100 }).validate();
});

test('legacy product review writes are retired and cannot modify a product', async (t) => {
  installUser(t, false);
  const lookup = t.mock.method(Product, 'findById', () => { throw new Error('Legacy review writes must not read products'); });
  const result = await request(`/api/products/${productId}/reviews`, { method: 'POST', auth: true, body: { rating: 5, comment: 'Review from an old client' } });
  assert.equal(result.status, 410);
  assert.equal(lookup.mock.callCount(), 0);
});

test('only admins can configure validated product percentages; legacy edits keep their stock', async t => {
  installUser(t);
  const save = t.mock.method(Product.prototype, 'save', async function () { await this.validate(); return this; });
  for (const discountPercent of [-1, 101, 1.5, null, '', true, {}, []]) {
    const result = await request('/api/products', { method: 'POST', auth: true, body: { ...shoeFields, variants: [{ color: 'Trắng', size: 40, quantity: 3 }], discountPercent } });
    assert.equal(result.status, 400, JSON.stringify(discountPercent));
  }
  assert.equal(save.mock.callCount(), 0);
  const created = await request('/api/products', { method: 'POST', auth: true, body: { ...shoeFields, variants: [{ color: 'Trắng', size: 40, quantity: 3 }], discountPercent: 20, salePrice: 1 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.price, 200000);
  assert.equal(created.body.discountPercent, 20);
  assert.equal(created.body.salePrice, undefined);
  const product = new Product({ ...shoeFields, _id: productId, __v: 4 });
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(Customer, 'exists', async () => { throw new Error('A discount edit must not convert legacy stock'); });
  t.mock.method(Order, 'exists', async () => { throw new Error('A discount edit must not inspect legacy orders'); });
  const edited = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { version: 4, discountPercent: 25 } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.discountPercent, 25);
  assert.equal(edited.body.countInStock, 3);
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { version: 3, discountPercent: 0 } })).status, 409);
  assert.equal((await request(`/api/products/${productId}/validate-update`, { method: 'POST', auth: true, body: { version: 4, discountPercent: 101 } })).status, 400);
  const cleared = await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { version: 4, discountPercent: 0 } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.discountPercent, 0);
  installUser(t, false);
  assert.equal((await request(`/api/products/${productId}`, { method: 'PUT', auth: true, body: { discountPercent: 100 } })).status, 403);
});

test('the product schema enforces percentages even outside the HTTP controller', async () => {
  for (const discountPercent of [-1, 101, 0.5, null]) {
    await assert.rejects(new Product({ ...shoeFields, discountPercent }).validate(), { name: 'ValidationError' });
  }
  for (const discountPercent of [undefined, 0, 100]) await new Product({ ...shoeFields, discountPercent }).validate();
});

test('review deletion requires its author or an administrator', async (t) => {
  installUser(t, false);
  const review = { _id: 'review-a', user: '000000000000000000000099', rating: 4 };
  const reviews = [review];
  reviews.id = () => review;
  const product = { reviews, save: async () => product };
  t.mock.method(Product, 'findById', async () => product);
  assert.equal((await request(`/api/products/${productId}/reviews/review-a`, { method: 'DELETE', auth: true })).status, 403);
});

test('admin deletion archives stocked or ordered products while used vouchers remain protected', async (t) => {
  installUser(t);
  const product = { _id: productId, __v: 0, countInStock: 3, isArchived: false, isHidden: false };
  t.mock.method(Product, 'findById', async () => product);
  const archived = t.mock.method(Product, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { _id: productId, isArchived: { $ne: true } });
    if (product.isArchived) return null;
    assert.deepEqual(update, { $set: { isArchived: true, isHidden: true }, $inc: { __v: 1 } });
    Object.assign(product, update.$set);
    product.__v += update.$inc.__v;
    return product;
  });
  const orderLookup = t.mock.method(Order, 'exists', async () => { throw new Error('Archival must not race a pre-delete order lookup'); });
  const deletedProduct = t.mock.method(Product, 'deleteOne', async () => { throw new Error('Must retain archived SKUs'); });
  const first = await request(`/api/products/${productId}`, { method: 'DELETE', auth: true });
  assert.equal(first.status, 200);
  assert.equal(first.body.message, 'Đã lưu trữ sản phẩm');
  assert.equal((await request(`/api/products/${productId}`, { method: 'DELETE', auth: true })).status, 200);
  assert.equal(product.countInStock, 3);
  assert.equal(product.__v, 1);
  assert.equal(product.isHidden, true);
  assert.equal(product.isArchived, true);
  assert.equal(archived.mock.callCount(), 2);
  assert.equal(orderLookup.mock.callCount(), 0);
  t.mock.method(Voucher, 'findById', async () => ({ _id: voucherId, usedCount: 1 }));
  const deletedVoucher = t.mock.method(Voucher, 'deleteOne', async () => { throw new Error('Must not delete used voucher'); });
  assert.equal((await request(`/api/vouchers/${voucherId}`, { method: 'DELETE', auth: true })).status, 409);
  assert.equal(deletedProduct.mock.callCount(), 0);
  assert.equal(deletedVoucher.mock.callCount(), 0);
});

test('archived products are excluded from the normal admin catalog and cannot be edited or reactivated', async (t) => {
  installUser(t);
  t.mock.method(Product, 'find', filter => {
    assert.deepEqual(filter, { isArchived: { $ne: true } });
    return queryOf([]);
  });
  const list = await request('/api/products/admin/all', { auth: true });
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 0);
  t.mock.method(Product, 'findById', async () => ({ _id: productId, isArchived: true, isHidden: true }));
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('An archived product must not be edited'); });
  for (const [path, body] of [
    [`/api/products/${productId}`, { name: 'Reactivate', isHidden: false, isArchived: false }],
    [`/api/products/${productId}/stock`, { countInStock: 10 }],
    [`/api/products/${productId}/toggle-visibility`, {}],
  ]) assert.equal((await request(path, { method: 'PUT', auth: true, body })).status, 409);
  assert.equal(save.mock.callCount(), 0);
});

test('voucher admin validation rejects invalid discounts/dates and respects explicit inactive status', async (t) => {
  installUser(t);
  t.mock.method(Voucher, 'exists', async () => false);
  const save = t.mock.method(Voucher.prototype, 'save', async function () { await this.validate(); return this; });
  for (const override of [{ discount: 101 }, { discount: 1.5 }, { maxUses: 0 }, { maxUses: true }, { endDate: 'invalid' }, { endDate: '2025-01-01' }, { isActive: 'false' }]) {
    assert.equal((await request('/api/vouchers/create', { method: 'POST', auth: true, body: { ...voucherFields, ...override } })).status, 400, JSON.stringify(override));
  }
  assert.equal(save.mock.callCount(), 0);
  const created = await request('/api/vouchers/create', { method: 'POST', auth: true, body: { ...voucherFields, code: ' test10 ', isActive: false } });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, 'TEST10');
  assert.equal(created.body.isActive, false);
});

test('voucher preview checks start/end/usage and free shipping; browser cannot consume voucher usage', async (t) => {
  installUser(t, false);
  const now = Date.now();
  let voucher = { ...voucherFields, isActive: true, type: 'shipping', discount: 30000, startDate: new Date(now - 60000), endDate: new Date(now + 60000) };
  t.mock.method(Voucher, 'findOne', async () => voucher);
  let wallet = null;
  t.mock.method(VoucherWallet, 'findOne', async filter => { assert.equal(String(filter.user), customerId);return wallet; });
  assert.equal((await request('/api/vouchers/apply', { method: 'POST', body: { code: 'TEST10', orderTotal: 200000 } })).status, 401);
  assert.equal((await request('/api/vouchers/apply', { method: 'POST', auth: true, body: { code: 'TEST10', orderTotal: 200000 } })).status, 403);
  wallet = { _id: voucherId, kind: 'saved' };
  const preview = await request('/api/vouchers/apply', { method: 'POST', auth: true, body: { code: 'TEST10', orderTotal: 200000 } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.shippingPrice, 0);
  assert.equal(preview.body.totalPrice, 200000);
  for (const override of [{ isActive: false }, { startDate: new Date(now + 60000) }, { endDate: new Date(now - 60000) }, { usedCount: 5 }]) {
    const previous = voucher;
    voucher = { ...voucher, ...override };
    assert.equal((await request('/api/vouchers/apply', { method: 'POST', auth: true, body: { code: 'TEST10', orderTotal: 200000 } })).status, 400);
    voucher = previous;
  }
  assert.equal((await request(`/api/vouchers/${voucherId}/use`, { method: 'PUT', auth: true, body: {} })).status, 409);
  assert.equal(voucher.usedCount, 0);
});

test('CastError, model validation and internal failures are mapped to safe HTTP responses', async (t) => {
  installUser(t);
  let failure = new mongoose.Error.CastError('ObjectId', 'invalid', '_id');
  t.mock.method(Product, 'findById', async () => { throw failure; });
  const cast = await request('/api/products/not-an-id/stock', { method: 'PUT', auth: true, body: { countInStock: 0 } });
  assert.equal(cast.status, 400);
  failure = new Error('PRIVATE_CONNECTION_SECRET');
  const internal = await request(`/api/products/${productId}/stock`, { method: 'PUT', auth: true, body: { countInStock: 0 } });
  assert.equal(internal.status, 500);
  assert.ok(!JSON.stringify(internal.body).includes('PRIVATE_CONNECTION_SECRET'));
  const validation = new mongoose.Error.ValidationError();
  validation.addError('price', new mongoose.Error.ValidatorError({ path: 'price', message: 'Giá không hợp lệ' }));
  failure = validation;
  const invalid = await request(`/api/products/${productId}/stock`, { method: 'PUT', auth: true, body: { countInStock: 0 } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.message, /Giá không hợp lệ/);
});

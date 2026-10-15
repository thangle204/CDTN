import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import Product from '../models/productModel.js';
import { productUploadsDirectory } from '../controllers/uploadController.js';
import { setupIntegration } from './setup.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxoAAAAASUVORK5CYII=', 'base64');

test('real MongoDB image upload, product administration and customer registration', { timeout: 120000 }, async (t) => {
  const ctx = await setupIntegration(t);
  const admin = await ctx.createCustomer({ isAdmin: true });
  const token = await ctx.login(admin);
  let product;

  await t.test('an authenticated image upload is persisted with product variants and served through the API', async () => {
    const upload = await fetch(`${ctx.baseUrl}/api/products/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: png, signal: AbortSignal.timeout(20000),
    });
    assert.equal(upload.status, 201);
    const { image } = await upload.json();
    assert.match(image, /^\/uploads\/products\/[a-f0-9-]{36}\.png$/);
    const filename = image.split('/').at(-1);
    const ownedFile = join(productUploadsDirectory, filename);
    // Only remove the exact random file this authenticated request created,
    // and only if its bytes still match our fixture.
    t.after(async () => {
      const bytes = await readFile(ownedFile);
      assert.deepEqual(bytes, png, 'Uploaded test image ownership must still match before removal');
      await unlink(ownedFile);
    });
    const created = await ctx.request('POST', '/api/products', {
      token, body: {
        name: 'Integration uploaded shoe', brand: 'Nike', category: 'Sneaker',
        description: 'Shoe created through the real authenticated API', image, price: 250000,
        countInStock: 999,
        variants: [{ color: ' Trắng ', size: 40, quantity: 20 }, { color: 'Đen', size: 41, quantity: 7 }],
      },
    });
    assert.equal(created.status, 201, created.body.message);
    product = created.body;
    const persisted = await Product.findById(product._id);
    assert.equal(persisted.image, image);
    assert.equal(persisted.countInStock, 27);
    assert.deepEqual(persisted.sizes, [40, 41]);
    assert.deepEqual(persisted.variants.map(({ color, size, quantity }) => ({ color, size, quantity })), [
      { color: 'Trắng', size: 40, quantity: 20 }, { color: 'Đen', size: 41, quantity: 7 },
    ]);
    const catalog = await ctx.request('GET', '/api/products');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.headers.get('x-demo-mode'), null);
    assert.ok(catalog.body.some(row => row._id === product._id));
    const detail = await ctx.request('GET', `/api/products/${product._id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.image, image);
    const downloaded = await fetch(`${ctx.baseUrl}${image}`, { signal: AbortSignal.timeout(20000) });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  });

  await t.test('stale product edits are rejected by persisted MongoDB versions', async () => {
    assert.ok(product, 'Product creation must succeed before editing');
    const version = product.__v;
    const body = { version, variants: [{ color: 'Trắng', size: 40, quantity: 5 }, { color: 'Đen', size: 41, quantity: 7 }] };
    const changed = await ctx.request('PUT', `/api/products/${product._id}`, { token, body });
    assert.equal(changed.status, 200, changed.body.message);
    assert.equal(changed.body.countInStock, 12);
    assert.ok(changed.body.__v > version);
    const stale = await ctx.request('PUT', `/api/products/${product._id}`, {
      token, body: { ...body, variants: [{ color: 'Trắng', size: 40, quantity: 20 }, { color: 'Đen', size: 41, quantity: 7 }] },
    });
    assert.equal(stale.status, 409);
    assert.equal((await Product.findById(product._id)).countInStock, 12);
  });

  await t.test('customer registration persists a hash and restores an authorized profile', async () => {
    const password = 'IntegrationRegistration!123';
    const email = `registration-${Date.now()}@example.test`;
    const registered = await ctx.request('POST', '/api/customers', {
      body: { name: 'Integration Registered Buyer', email, phone: '0901234567', password, isAdmin: true },
    });
    assert.equal(registered.status, 201, registered.body.message);
    assert.equal(registered.body.isAdmin, false);
    assert.equal(registered.body.password, undefined);
    const profile = await ctx.request('GET', '/api/customers/profile', { token: registered.body.token });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.email, email);
    const customerAdmin = await ctx.request('GET', '/api/products/admin/all', { token: registered.body.token });
    assert.equal(customerAdmin.status, 403);
    const { default: Customer } = await import('../models/customerModel.js');
    const persisted = await Customer.findById(registered.body._id);
    assert.notEqual(persisted.password, password);
    assert.equal(await persisted.matchPassword(password), true);
  });
});

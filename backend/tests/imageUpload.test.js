import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Customer from '../models/customerModel.js';
import { createApp } from '../app.js';
import { createProductUploadHandler, parseProductImage, serveProductImages, MAX_PRODUCT_IMAGE_BYTES } from '../controllers/uploadController.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const secret = 'upload-api-test-secret-only';
const customerId = '000000000000000000000091';
let uploadDirectory;
let uploadServer;
let apiServer;
let uploadUrl;
let apiUrl;
let databaseState = 1;
let originalReadyState;
const oldSecret = process.env.JWT_SECRET;

const startServer = async (app) => {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return [server, `http://127.0.0.1:${server.address().port}`];
};
const upload = async (body, type = 'image/png') => {
  const response = await fetch(`${uploadUrl}/upload`, { method: 'POST', headers: { 'Content-Type': type }, body });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  uploadDirectory = await mkdtemp(join(tmpdir(), 'shoe-image-upload-test-'));
  // Storage/parser tests use an isolated application. Actual API authorization
  // is tested separately against createApp below, without a real database.
  const storageApp = express();
  storageApp.use(express.json({ limit: '64kb' }));
  storageApp.use((req, res, next) => { req.body ??= {}; next(); });
  storageApp.post('/upload', parseProductImage, createProductUploadHandler({ directory: uploadDirectory }));
  storageApp.use('/uploads/products', serveProductImages({ directory: uploadDirectory }));
  storageApp.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  [uploadServer, uploadUrl] = await startServer(storageApp);
  process.env.JWT_SECRET = secret;
  originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => databaseState });
  [apiServer, apiUrl] = await startServer(createApp());
});

after(async () => {
  for (const server of [uploadServer, apiServer]) {
    if (!server) continue;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (originalReadyState) Object.defineProperty(mongoose.connection, 'readyState', originalReadyState);
  else delete mongoose.connection.readyState;
  oldSecret === undefined ? delete process.env.JWT_SECRET : process.env.JWT_SECRET = oldSecret;
  if (uploadDirectory) {
    assert.equal(dirname(uploadDirectory), tmpdir());
    assert.ok(uploadDirectory.includes('shoe-image-upload-test-'));
    await rm(uploadDirectory, { recursive: true, force: true });
  }
});

test('PNG, JPEG and WebP upload to unique names and are served unchanged with nosniff', async () => {
  const paths = new Set();
  for (const [type, bytes, extension] of [['image/png', png, 'png'], ['image/jpeg', jpeg, 'jpg'], ['image/webp', webp, 'webp'], ['image/png', png, 'png']]) {
    const result = await upload(bytes, type);
    assert.equal(result.status, 201, `${type}: ${result.body.message || ''}`);
    assert.match(result.body.image, new RegExp(`^/uploads/products/[0-9a-f-]{36}\\.${extension}$`));
    assert.equal(paths.has(result.body.image), false);
    paths.add(result.body.image);
    const response = await fetch(uploadUrl + result.body.image);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type').split(';')[0], type);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
});

test('invalid, mislabeled, empty and truncated images are rejected without writing files', async () => {
  const beforeFiles = await readdir(uploadDirectory);
  for (const [type, bytes] of [
    ['image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['image/jpeg', png], ['image/png', Buffer.alloc(0)],
    ['image/png', png.subarray(0, png.length - 1)],
    ['image/jpeg', jpeg.subarray(0, jpeg.length - 2)],
    ['image/webp', webp.subarray(0, webp.length - 1)],
    ['image/png', Buffer.concat([png, Buffer.from('<script>bad</script>')])],
  ]) {
    assert.equal((await upload(bytes, type)).status, 400, type);
  }
  for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream']) {
    const response = await upload(png, type);
    assert.equal(response.status, 415);
    assert.match(response.body.message, /JPG, PNG/);
  }
  assert.deepEqual(await readdir(uploadDirectory), beforeFiles);
});

test('an oversized image has a friendly 413 response and is not stored', async () => {
  const beforeFiles = await readdir(uploadDirectory);
  const result = await upload(Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1));
  assert.equal(result.status, 413);
  assert.match(result.body.message, /5 MB/);
  assert.deepEqual(await readdir(uploadDirectory), beforeFiles);
});

test('raw uploads larger than the API JSON limit remain supported', async () => {
  const metadata = Buffer.alloc(65537);
  metadata[0] = 0xff;
  metadata[1] = 0xe2;
  metadata.writeUInt16BE(65535, 2);
  const largeJpeg = Buffer.concat([jpeg.subarray(0, 2), metadata, metadata, jpeg.subarray(2)]);
  assert.ok(largeJpeg.length > 64 * 1024);
  const result = await upload(largeJpeg, 'image/jpeg');
  assert.equal(result.status, 201);
  const downloaded = await fetch(uploadUrl + result.body.image);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), largeJpeg);
});

test('static images reject hidden files and return 404 for unknown paths', async () => {
  await writeFile(join(uploadDirectory, '.hidden'), 'private');
  const hidden = await fetch(uploadUrl + '/uploads/products/.hidden');
  assert.equal(hidden.status, 403);
  assert.equal(hidden.headers.get('x-content-type-options'), 'nosniff');
  const missing = await fetch(uploadUrl + '/uploads/products/missing.png');
  assert.equal(missing.status, 404);
});

test('actual product upload route requires a database, login and administrator before parsing images', async (t) => {
  const request = (headers = {}) => fetch(apiUrl + '/api/products/upload', {
    method: 'POST', headers: { 'Content-Type': 'text/plain', ...headers }, body: 'not an image',
  });
  assert.equal((await request()).status, 401);
  const user = { _id: customerId, isAdmin: false, isActive: true, authVersion: 0 };
  t.mock.method(Customer, 'findById', () => ({ select: async () => user }));
  const authorization = { Authorization: `Bearer ${jwt.sign({ id: customerId, accountType: 'customer', authVersion: 0 }, secret)}` };
  assert.equal((await request(authorization)).status, 403);
  user.isAdmin = true;
  assert.equal((await request(authorization)).status, 415);
  databaseState = 0;
  try { assert.equal((await request(authorization)).status, 503); }
  finally { databaseState = 1; }
});

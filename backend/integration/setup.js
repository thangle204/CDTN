import '../config/env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { mongoConnectionOptions } from '../config/mongoOptions.js';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import Product from '../models/productModel.js';

const DATABASE_PREFIX = 'shoe_store_it_';
// Atlas shared clusters apply a smaller database-name limit than standalone
// MongoDB. Keep every generated name within 38 bytes on both configurations.
const DATABASE_PATTERN = /^shoe_store_it_[a-z0-9]{8,10}_[a-f0-9]{12}$/;
const MAX_DATABASE_NAME_BYTES = 38;
const MARKER_COLLECTION = '__integration_owner';
const SAFE_ERROR_CODES = new Set([
  'ETIMEOUT', 'ENOTFOUND', 'ENODATA', 'ECONNREFUSED', 'ECONNRESET',
  'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const connectionFailure = (error) => {
  if (error?.code === 18 || error?.codeName === 'AuthenticationFailed') {
    return new Error('MongoDB integration connection failed: authentication rejected. No existing shop data was changed.');
  }
  const code = SAFE_ERROR_CODES.has(error?.code) ? error.code : 'CONNECTION_FAILED';
  return new Error(`MongoDB integration connection failed (${code}). Check MongoDB access, network and DNS. No existing shop data was changed.`);
};

// Supplying dbName changes the driver's implicit authentication database too.
// Recover the original source before selecting our disposable database. For
// SRV, use the system resolver exactly as the driver does, preserving Atlas TXT
// authSource=admin rather than authenticating against the generated database.
export const isolatedConnectionOptions = async (uri, dbName) => {
  const parsed = new mongoose.mongo.MongoClient(uri).options;
  const options = {
    dbName,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false,
  };
  if (!parsed.credentials) return options;
  let source = parsed.credentials.source;
  const externalMechanism = ['GSSAPI', 'MONGODB-X509', 'MONGODB-AWS', 'MONGODB-OIDC'].includes(parsed.credentials.mechanism);
  if (parsed.srvHost && !parsed.userSpecifiedAuthSource && !externalMechanism) {
    let records = [];
    try {
      records = await resolveTxt(parsed.srvHost);
    } catch (error) {
      if (!['ENODATA', 'ENOTFOUND'].includes(error?.code)) throw error;
    }
    if (records.length > 1) throw new Error('Invalid MongoDB DNS configuration');
    if (records.length === 1) {
      const txt = new URLSearchParams(records[0].join(''));
      if (txt.has('authSource')) source = txt.get('authSource');
    }
  }
  options.authSource = source;
  return options;
};

/**
 * Real HTTP + real MongoDB, always in a new, owned database. This helper never
 * seeds, clears, or writes to the database named in MONGO_URI/MONGO_TEST_URI.
 */
export const setupIntegration = async (t) => {
  const uri = process.env.MONGO_TEST_URI || process.env.MONGO_URI;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('Set MONGO_TEST_URI or MONGO_URI before running MongoDB integration tests.');
  }
  if (mongoose.connection.readyState !== 0) {
    throw new Error('Integration setup requires its own disconnected Node test process.');
  }

  const dbName = `${DATABASE_PREFIX}${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  assert.match(dbName, DATABASE_PATTERN);
  assert.ok(Buffer.byteLength(dbName) <= MAX_DATABASE_NAME_BYTES);
  const ownerToken = crypto.randomBytes(32).toString('hex');
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  let server;
  let connected = false;
  let ownsDatabase = false;

  t.after(async () => {
    let cleanupError;
    try {
      if (server) {
        server.closeIdleConnections?.();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
      if (connected) {
        const actualName = mongoose.connection.db?.databaseName;
        if (actualName !== dbName || !DATABASE_PATTERN.test(actualName)
          || Buffer.byteLength(actualName) > MAX_DATABASE_NAME_BYTES) {
          throw new Error('Integration cleanup refused: database identity does not match this run.');
        }
        if (!ownsDatabase) {
          throw new Error(`Integration cleanup refused: ownership was not established for ${dbName}.`);
        }
        const marker = await mongoose.connection.db.collection(MARKER_COLLECTION).findOne({ _id: 'owner' });
        if (marker?.token !== ownerToken || marker?.database !== dbName) {
          throw new Error(`Integration cleanup refused: ownership marker does not match ${dbName}.`);
        }
        await mongoose.connection.db.dropDatabase();
        t.diagnostic(`Removed owned integration database ${dbName}.`);
      }
    } catch (error) {
      // Deliberately omit driver error messages, which may contain connection
      // details. A mismatch leaves the database untouched for manual review.
      cleanupError = new Error(`Integration cleanup did not complete for ${dbName}; database identity or ownership check failed, or MongoDB was unavailable.`);
    } finally {
      try { await mongoose.disconnect(); } catch { /* no raw driver logs */ }
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
    if (cleanupError) throw cleanupError;
  });

  try {
    const options = await isolatedConnectionOptions(uri, dbName);
    await mongoose.connect(uri, mongoConnectionOptions(uri, options));
    connected = true;
  } catch (error) {
    throw connectionFailure(error);
  }
  if (mongoose.connection.db.databaseName !== dbName || !DATABASE_PATTERN.test(dbName)) {
    throw new Error('Integration setup refused: connection did not select the generated database.');
  }
  const db = mongoose.connection.db;
  let setupStage = 'list-collections';
  try {
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length !== 0) {
      throw new Error('Generated database is not empty');
    }
    setupStage = 'insert-owner';
    await db.collection(MARKER_COLLECTION).insertOne({ _id: 'owner', token: ownerToken, database: dbName, createdAt: new Date() });
    ownsDatabase = true;
    for (const Model of Object.values(mongoose.models)) {
      setupStage = `create-collection:${Model.modelName}`;
      await Model.createCollection();
      setupStage = `create-indexes:${Model.modelName}`;
      await Model.createIndexes();
    }
  } catch (error) {
    const safeLabel = (value) => typeof value === 'string' && /^[A-Za-z0-9_]+$/.test(value) ? value : undefined;
    const metadata = [safeLabel(error?.name), Number.isSafeInteger(error?.code) ? String(error.code) : undefined, safeLabel(error?.codeName)]
      .filter(Boolean).join('/');
    throw new Error(`MongoDB integration setup failed at ${setupStage} (${metadata || 'UnknownError'}) for ${dbName}. Check create-database/index permissions; an unowned database will never be cleared.`);
  }
  t.diagnostic(`Using isolated MongoDB database ${dbName}; existing shop database is not modified.`);

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', () => reject(new Error('Could not start local integration HTTP server.')));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const passwords = new Map();
  const testPassword = `Integration!${crypto.randomBytes(16).toString('hex')}`;

  const request = async (method, path, { token, body } = {}) => {
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
      throw new Error('Integration requests must use a local /api/ path.');
    }
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(`Local integration request failed: ${method} ${path.split('?')[0]}.`);
    }
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = text; }
    return { status: response.status, body: result, headers: response.headers };
  };

  const createAccount = async (Model, overrides) => {
    const password = overrides.password ?? testPassword;
    const account = await Model.create({
      name: 'Integration Customer', phone: '0901234567',
      email: `${crypto.randomUUID()}@example.test`, isActive: true,
      ...overrides, password,
    });
    passwords.set(String(account._id), password);
    return account;
  };
  const loginAccount = async (account, password, path) => {
    const result = await request('POST', path, {
      body: { email: account.email, password: password ?? passwords.get(String(account._id)) },
    });
    assert.equal(result.status, 200, 'Integration account login must succeed');
    assert.equal(typeof result.body.token, 'string');
    return result.body.token;
  };
  const createProduct = async (overrides = {}) => {
    const variants = overrides.variants ?? [
      { color: 'Trắng', size: 40, quantity: 10 },
      { color: 'Đen', size: 40, quantity: 10 },
    ];
    return Product.create({
      name: `Integration Shoe ${crypto.randomUUID()}`,
      image: '/uploads/products/integration-test.png',
      brand: 'Nike', category: 'Sneaker', description: 'Integration test shoe', price: 200000,
      variants,
      sizes: [...new Set(variants.map((variant) => variant.size))],
      color: [...new Set(variants.map((variant) => variant.color))].join(', '),
      countInStock: variants.reduce((sum, variant) => sum + variant.quantity, 0),
      ...overrides,
    });
  };
  return {
    request, baseUrl, dbName, createProduct,
    createCustomer: (overrides = {}) => createAccount(Customer, overrides),
    createStaff: (overrides = {}) => createAccount(Staff, { role: 'Integration Staff', ...overrides }),
    login: (customer, password) => loginAccount(customer, password, '/api/customers/login'),
    loginStaff: (staff, password) => loginAccount(staff, password, '/api/staff/login'),
  };
};

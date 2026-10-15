import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import mongoose from 'mongoose';
import { mongoConnectionOptions } from '../config/mongoOptions.js';

// Exercise option generation and the installed driver's parser without loading
// .env, performing DNS lookups, connecting to MongoDB or modifying any data.
const replaceCAReader = (t, reader) => {
  const previous = Object.getOwnPropertyDescriptor(tls, 'getCACertificates');
  Object.defineProperty(tls, 'getCACertificates', { configurable: true, writable: true, value: reader });
  t.after(() => {
    if (previous) Object.defineProperty(tls, 'getCACertificates', previous);
    else delete tls.getCACertificates;
  });
};

test('Mongo trust combines default and system roots without mutating caller options', (t) => {
  const reads = [];
  replaceCAReader(t, (store) => {
    reads.push(store);
    return store === 'default' ? ['bundled-root', 'shared-root'] : ['system-root', 'shared-root'];
  });
  const overrides = { dbName: 'isolated_test', serverSelectionTimeoutMS: 10000, autoIndex: false };
  const result = mongoConnectionOptions('mongodb+srv://cluster.example.com/shoes', overrides);
  assert.deepEqual(reads, ['default', 'system']);
  assert.deepEqual(result, { ...overrides, ca: ['bundled-root', 'shared-root', 'system-root'] });
  assert.notEqual(result, overrides);
  assert.equal(Object.hasOwn(overrides, 'ca'), false);
  for (const flag of ['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames', 'rejectUnauthorized', 'checkServerIdentity']) {
    assert.equal(Object.hasOwn(result, flag), false);
  }
});

test('explicit trust options are preserved without adding system roots', (t) => {
  replaceCAReader(t, () => { assert.fail('An explicit trust store must not be replaced'); });
  for (const custom of [
    { ca: ['pinned-root'] }, { ca: [] }, { ca: null }, { ca: undefined },
    { secureContext: {} }, { tlsCAFile: './custom.pem' }, { TLSCAFILE: './custom.pem' },
  ]) {
    const overrides = { serverSelectionTimeoutMS: 10000, ...custom };
    const result = mongoConnectionOptions('mongodb://127.0.0.1:27017/shoes?tls=true', overrides);
    assert.deepEqual(result, overrides);
    for (const key of Object.keys(custom)) assert.equal(result[key], custom[key]);
  }
});

test('URI tlsCAFile is respected case-insensitively, including encoded parameter names', (t) => {
  replaceCAReader(t, () => { assert.fail('URI trust configuration must not be overridden'); });
  for (const parameter of ['tlsCAFile', 'TLSCAFILE', 'tLsCaFiLe', '%74lsCAFile']) {
    const uri = `mongodb+srv://cluster.example.com/shoes?retryWrites=true&${parameter}=%2Fcustom.pem`;
    assert.deepEqual(mongoConnectionOptions(uri, { dbName: 'isolated_test' }), { dbName: 'isolated_test' });
  }
});

test('older Node or an unsupported system store falls back to unchanged TLS defaults', (t) => {
  const overrides = { dbName: 'isolated_test', serverSelectionTimeoutMS: 10000 };
  replaceCAReader(t, undefined);
  assert.deepEqual(mongoConnectionOptions('mongodb+srv://cluster.example.com/shoes', overrides), overrides);
  tls.getCACertificates = () => { throw new Error('System trust store unavailable'); };
  assert.deepEqual(mongoConnectionOptions('mongodb+srv://cluster.example.com/shoes', overrides), overrides);
  tls.getCACertificates = () => [];
  assert.deepEqual(mongoConnectionOptions('mongodb+srv://cluster.example.com/shoes', overrides), overrides);
});

test('Mongo driver keeps SRV certificate validation and does not enable TLS for plain MongoDB', (t) => {
  replaceCAReader(t, () => tls.rootCertificates);
  const uri = 'mongodb+srv://cluster.example.com/shoes';
  const srvClient = new mongoose.mongo.MongoClient(uri, mongoConnectionOptions(uri));
  assert.equal(srvClient.options.tls, true);
  assert.notEqual(srvClient.options.rejectUnauthorized, false);
  assert.equal(srvClient.options.checkServerIdentity, undefined);
  assert.deepEqual(srvClient.options.ca, tls.rootCertificates);

  const plainUri = 'mongodb://127.0.0.1:27017/shoes';
  const plainClient = new mongoose.mongo.MongoClient(plainUri, mongoConnectionOptions(plainUri));
  assert.notEqual(plainClient.options.tls, true);
  assert.notEqual(plainClient.options.rejectUnauthorized, false);
});

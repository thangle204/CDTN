import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { connectDB, hasMongoConfiguration } from '../config/db.js';
import { startDatabaseConnection } from '../utils/databaseStartup.js';

// No .env, DNS queries, MongoDB sockets or collection operations in these tests.
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const scheduler = () => {
  const pending = new Map();
  const delays = [];
  let serial = 0;
  return {
    delays,
    pending,
    setTimer(callback, delay) {
      const id = ++serial;
      delays.push(delay);
      pending.set(id, callback);
      return id;
    },
    clearTimer(id) { pending.delete(id); },
    runNext() {
      assert.equal(pending.size, 1, 'Exactly one retry should be scheduled');
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback();
    },
  };
};

test('initial failure recovers API health and database gate on the next successful attempt', async t => {
  let databaseState = 0;
  const previous = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => databaseState });
  t.after(() => {
    if (previous) Object.defineProperty(mongoose.connection, 'readyState', previous);
    else delete mongoose.connection.readyState;
  });
  t.mock.method(console, 'error', () => {});
  const server = createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clock = scheduler();
  let calls = 0;
  const startup = startDatabaseConnection({
    ...clock,
    connect: async () => {
      if (++calls === 1) return false;
      databaseState = 1;
      return true;
    },
  });
  t.after(() => startup.stop());
  await settle();
  assert.equal((await (await fetch(baseUrl + '/api/test')).json()).databaseConnected, false);
  assert.equal((await fetch(baseUrl + '/api/customers/profile')).status, 503);
  clock.runNext();
  await settle();
  assert.equal((await (await fetch(baseUrl + '/api/test')).json()).databaseConnected, true);
  // Authentication now runs instead of the database gate rejecting the call.
  assert.equal((await fetch(baseUrl + '/api/customers/profile')).status, 401);
  assert.equal(calls, 2);
  assert.equal(clock.pending.size, 0);
});

test('a slow connection does not schedule or overlap another connection', async t => {
  const clock = scheduler();
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const startup = startDatabaseConnection({
    ...clock,
    connect: () => ++calls === 1 ? first.promise : second.promise,
  });
  t.after(() => startup.stop());
  await settle();
  assert.equal(calls, 1);
  assert.equal(clock.pending.size, 0);
  first.resolve(false);
  await settle();
  assert.deepEqual(clock.delays, [1000]);
  clock.runNext();
  await settle();
  assert.equal(calls, 2);
  assert.equal(clock.pending.size, 0);
  second.resolve(true);
  await settle();
  assert.equal(clock.pending.size, 0);
});

test('retry backoff increases to 30 seconds and stays bounded', async t => {
  const clock = scheduler();
  const startup = startDatabaseConnection({ ...clock, connect: async () => false });
  t.after(() => startup.stop());
  await settle();
  for (let i = 0; i < 8; i++) {
    clock.runNext();
    await settle();
  }
  assert.deepEqual(clock.delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(clock.pending.size, 1);
});

test('stop cancels the pending retry and remains safe when called twice', async () => {
  const clock = scheduler();
  let calls = 0;
  const startup = startDatabaseConnection({ ...clock, connect: async () => { calls++; return false; } });
  await settle();
  const alreadyQueuedCallback = [...clock.pending.values()][0];
  startup.stop();
  startup.stop();
  assert.equal(clock.pending.size, 0);
  // Even if a canceled callback had already entered the event queue, it is inert.
  alreadyQueuedCallback();
  await settle();
  assert.equal(calls, 1);
});

test('stop during an in-flight failure prevents the retry from being scheduled', async () => {
  const clock = scheduler();
  const pending = deferred();
  const startup = startDatabaseConnection({ ...clock, connect: () => pending.promise });
  startup.stop();
  pending.reject(new Error('temporary network failure'));
  await settle();
  assert.equal(clock.pending.size, 0);
  assert.deepEqual(clock.delays, []);
});

test('successful initial connection and non-retryable failures do not schedule timers', async () => {
  for (const options of [
    { connect: async () => true },
    { connect: async () => false, shouldRetry: () => false },
  ]) {
    const clock = scheduler();
    const startup = startDatabaseConnection({ ...clock, ...options });
    await settle();
    assert.equal(clock.pending.size, 0);
    startup.stop();
  }
});

test('a rejected connection retries without exposing its raw error to callbacks', async t => {
  const clock = scheduler();
  const notices = [];
  const startup = startDatabaseConnection({
    ...clock,
    connect: async () => { throw new Error('mongodb://private-user:private-password@example.invalid'); },
    onRetry: (...args) => notices.push(args),
  });
  t.after(() => startup.stop());
  await settle();
  assert.deepEqual(notices, [[1000]]);
  assert.equal(clock.pending.size, 1);
});

test('missing or malformed MongoDB configuration logs once and never connects or retries', async t => {
  const oldUri = process.env.MONGO_URI;
  t.after(() => oldUri === undefined ? delete process.env.MONGO_URI : process.env.MONGO_URI = oldUri);
  t.mock.method(mongoose, 'connect', () => assert.fail('Invalid configuration must not reach MongoDB'));
  const warnings = t.mock.method(console, 'warn', () => {});
  for (const uri of ['', 'https://example.invalid', 'mongodb://']) {
    process.env.MONGO_URI = uri;
    const clock = scheduler();
    const startup = startDatabaseConnection({ ...clock, connect: connectDB, shouldRetry: hasMongoConfiguration });
    await settle();
    assert.equal(clock.pending.size, 0);
    startup.stop();
  }
  assert.equal(warnings.mock.callCount(), 3);
});

test('one-shot connector retains its boolean result and uses the same timeout as check:db', async t => {
  const oldUri = process.env.MONGO_URI;
  t.after(() => oldUri === undefined ? delete process.env.MONGO_URI : process.env.MONGO_URI = oldUri);
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test_only';
  let fail = false;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(mongoose, 'connect', async (uri, options) => {
    assert.equal(uri, process.env.MONGO_URI);
    assert.equal(options.serverSelectionTimeoutMS, 10000);
    if (fail) throw new Error('connection failure');
  });
  assert.equal(await connectDB(), true);
  fail = true;
  assert.equal(await connectDB(), false);
});

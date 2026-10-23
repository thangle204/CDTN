import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { describeMongoConnectionError, formatMongoConnectionError } from '../utils/mongoDiagnostics.js';

// No .env, DNS or database connection. Use the installed driver's error wrappers
// and the real Mongoose assimilation path, including its stock Atlas IP advice.
const privateUri = 'mongodb+srv://private-user:private-password@private-cluster.mongodb.net/private-db';
class TopologyDescription {
  constructor(error) {
    this.servers = new Map([['private-cluster.mongodb.net:27017', {
      host: 'private-cluster.mongodb.net', port: 27017, type: 'Unknown', error,
    }]]);
  }
}
const driverCause = (code, syscall) => Object.assign(new Error(privateUri), { code, syscall });
const wrappedSelection = cause => {
  const network = new mongoose.mongo.MongoNetworkError(privateUri, { cause });
  const selection = new mongoose.mongo.MongoServerSelectionError(privateUri, new TopologyDescription(network));
  return new mongoose.Error.MongooseServerSelectionError().assimilateError(selection);
};
const assertSecretFree = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of [privateUri, 'private-user', 'private-password', 'private-cluster', 'private-db']) {
    assert.equal(text.includes(secret), false, 'Diagnostics must not expose a connection/account value');
  }
};

test('nested TLS cause takes precedence over Mongoose Atlas whitelist suggestion', () => {
  const error = wrappedSelection(driverCause('UNABLE_TO_VERIFY_LEAF_SIGNATURE'));
  assert.match(error.message, /IP.*whitelist/);
  const diagnostic = describeMongoConnectionError(error);
  assert.equal(diagnostic.kind, 'tls');
  assert.equal(diagnostic.code, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  assertSecretFree(diagnostic);
  assertSecretFree(formatMongoConnectionError(error));
});

test('authentication failures are found inside real driver and aggregate wrappers', () => {
  const auth = new mongoose.mongo.MongoServerError({ message: privateUri, code: 18 });
  const error = new AggregateError([wrappedSelection(driverCause('ETIMEDOUT', 'connect')), auth], privateUri);
  assert.equal(describeMongoConnectionError(error).kind, 'authentication');
  assert.equal(describeMongoConnectionError(error).code, '18');
  assertSecretFree(formatMongoConnectionError(error));
});

test('legacy authentication errors use fixed text without echoing message or code', () => {
  const error = new Error('Authentication failed: ' + privateUri);
  error.code = privateUri;
  assert.equal(describeMongoConnectionError(error).kind, 'authentication');
  assertSecretFree(formatMongoConnectionError(error));
});

test('DNS resolution failures are recognized in root and nested driver errors', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL', 'EREFUSED', 'EFORMERR']) {
    for (const error of [driverCause(code), wrappedSelection(driverCause(code))]) {
      const diagnostic = describeMongoConnectionError(error);
      assert.equal(diagnostic.kind, 'dns', code);
      assert.equal(diagnostic.code, code);
      assertSecretFree(diagnostic);
    }
  }
});

test('DNS timeout is distinguished from a TCP or unspecified timeout', () => {
  for (const code of ['ETIMEOUT', 'ETIMEDOUT']) {
    for (const syscall of ['querySrv', 'queryTxt', 'getaddrinfo']) {
      assert.equal(describeMongoConnectionError(wrappedSelection(driverCause(code, syscall))).kind, 'dns');
    }
    for (const syscall of [undefined, 'connect']) {
      assert.equal(describeMongoConnectionError(wrappedSelection(driverCause(code, syscall))).kind, 'timeout');
    }
  }
  const legacy = Object.assign(new Error('querySrv ETIMEOUT ' + privateUri), { code: 'ETIMEOUT' });
  assert.equal(describeMongoConnectionError(legacy).kind, 'dns');
  assertSecretFree(formatMongoConnectionError(legacy));
});

test('an Atlas selection timeout without a concrete cause stays inconclusive', () => {
  const error = wrappedSelection(new Error(privateUri));
  const diagnostic = describeMongoConnectionError(error);
  assert.match(error.message, /whitelist/);
  assert.equal(diagnostic.kind, 'timeout');
  assert.equal(diagnostic.code, 'SERVER_SELECTION_TIMEOUT');
  assert.match(diagnostic.advice, /không đủ để kết luận/);
  assertSecretFree(diagnostic);
});

test('TCP refusal, reset and unreachable errors retain only allowlisted codes', () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE']) {
    const diagnostic = describeMongoConnectionError(wrappedSelection(driverCause(code, 'connect')));
    assert.equal(diagnostic.kind, 'tcp', code);
    assert.equal(diagnostic.code, code);
    assertSecretFree(diagnostic);
  }
  assert.equal(describeMongoConnectionError(driverCause('ECONNREFUSED', 'querySrv')).kind, 'dns');
});

test('a reset explicitly before the secure TLS handshake does not imply bad credentials or an IP rule', () => {
  const cause = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established: ' + privateUri), {
    code: 'ECONNRESET',
  });
  const diagnostic = describeMongoConnectionError(wrappedSelection(cause));
  assert.equal(diagnostic.kind, 'tls_handshake');
  assert.equal(diagnostic.code, 'ECONNRESET_BEFORE_TLS');
  assert.match(diagnostic.message, /trước bước xác thực/);
  assert.match(diagnostic.advice, /chưa thể kết luận/);
  assertSecretFree(formatMongoConnectionError(wrappedSelection(cause)));
});

test('driver parse errors give configuration advice without echoing the invalid URI', () => {
  for (const error of [new mongoose.mongo.MongoParseError(privateUri), new mongoose.mongo.MongoInvalidArgumentError(privateUri)]) {
    const diagnostic = describeMongoConnectionError(error);
    assert.equal(diagnostic.kind, 'configuration');
    assert.equal(diagnostic.code, 'INVALID_CONFIGURATION');
    assertSecretFree(formatMongoConnectionError(error));
  }
});

test('certificate, hostname and TLS alert failures remain TLS diagnostics', () => {
  for (const code of ['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE']) {
    const diagnostic = describeMongoConnectionError(wrappedSelection(driverCause(code)));
    assert.equal(diagnostic.kind, 'tls', code);
    assert.equal(diagnostic.code, code);
    assertSecretFree(diagnostic);
  }
});

test('network and operation timeouts are not mislabeled as DNS or authentication', () => {
  const errors = [
    [new mongoose.mongo.MongoNetworkTimeoutError(privateUri), 'NETWORK_TIMEOUT'],
    [Object.assign(new Error(privateUri), { name: 'MongoOperationTimeoutError' }), 'OPERATION_TIMEOUT'],
  ];
  for (const [error, code] of errors) {
    assert.equal(describeMongoConnectionError(error).kind, 'timeout');
    assert.equal(describeMongoConnectionError(error).code, code);
    assertSecretFree(formatMongoConnectionError(error));
  }
});

test('unknown errors and hostile metadata cannot leak into diagnostics', () => {
  const error = Object.assign(new Error(privateUri), { code: privateUri, name: privateUri, syscall: privateUri });
  error.stack = privateUri;
  const diagnostic = describeMongoConnectionError(error);
  assert.equal(diagnostic.kind, 'unknown');
  assert.equal(diagnostic.code, 'UNKNOWN');
  assertSecretFree(diagnostic);
  assertSecretFree(formatMongoConnectionError(error));
  for (const value of [undefined, null, false, 42, privateUri]) {
    assert.equal(describeMongoConnectionError(value).kind, 'unknown');
    assertSecretFree(formatMongoConnectionError(value));
  }
});

test('cycles and unreadable metadata terminate while retaining a reachable concrete cause', () => {
  const error = new Error(privateUri);
  error.cause = error;
  error.reason = { servers: new Map([['private-cluster', { error }]]) };
  error.errors = [error, driverCause('CERT_HAS_EXPIRED')];
  Object.defineProperty(error, 'code', { get() { throw new Error(privateUri); } });
  assert.equal(describeMongoConnectionError(error).code, 'CERT_HAS_EXPIRED');
  assertSecretFree(formatMongoConnectionError(error));
});

test('long error graphs are bounded and cannot exhaust recursive stack', () => {
  let error = new Error(privateUri);
  for (let i = 0; i < 10000; i++) error = { cause: error };
  assert.equal(describeMongoConnectionError(error).kind, 'unknown');
  assertSecretFree(formatMongoConnectionError(error));
});

test('API connector logs the shared safe diagnostic and retains its boolean contract', async t => {
  const previousUri = process.env.MONGO_URI;
  t.after(() => previousUri === undefined ? delete process.env.MONGO_URI : process.env.MONGO_URI = previousUri);
  process.env.MONGO_URI = privateUri;
  const failure = wrappedSelection(driverCause('ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR'));
  t.mock.method(mongoose, 'connect', async () => { throw failure; });
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  assert.equal(await connectDB(), false);
  assert.deepEqual(logs, [[formatMongoConnectionError(failure)]]);
  assertSecretFree(logs);
});

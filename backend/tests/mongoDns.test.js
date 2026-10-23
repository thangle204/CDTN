import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { configureMongoDns } from '../config/mongoDns.js';

// Resolver methods are always mocked. Do not import env.js or load a .env file.
const validationMessage = 'MONGO_DNS_SERVERS phải là tối đa 3 địa chỉ IP, phân cách bằng dấu phẩy.';
const mockResolver = t => {
  const applied = [];
  const read = t.mock.method(dns, 'getServers', () => { throw new Error('Existing resolver settings must not be read'); });
  const write = t.mock.method(dns, 'setServers', servers => { applied.push([...servers]); });
  return { applied, read, write };
};
const setEnvironment = (t, value) => {
  const previous = process.env.MONGO_DNS_SERVERS;
  t.after(() => {
    if (previous === undefined) delete process.env.MONGO_DNS_SERVERS;
    else process.env.MONGO_DNS_SERVERS = previous;
  });
  if (value === undefined) delete process.env.MONGO_DNS_SERVERS;
  else process.env.MONGO_DNS_SERVERS = value;
};
const assertInvalid = value => assert.throws(() => configureMongoDns(value), error => {
  assert.ok(error instanceof TypeError);
  assert.equal(error.message, validationMessage);
  return true;
});

test('unset Mongo DNS configuration leaves the existing resolver untouched', t => {
  const resolver = mockResolver(t);
  setEnvironment(t, undefined);
  assert.deepEqual(configureMongoDns(), []);
  assert.equal(resolver.read.mock.callCount(), 0);
  assert.equal(resolver.write.mock.callCount(), 0);
});

test('blank Mongo DNS configuration leaves the existing resolver untouched', t => {
  const resolver = mockResolver(t);
  for (const value of ['', ' ', '    ']) assert.deepEqual(configureMongoDns(value), []);
  assert.equal(resolver.read.mock.callCount(), 0);
  assert.equal(resolver.write.mock.callCount(), 0);
});

test('Mongo DNS trims CSV addresses, canonicalizes IPv6 and deduplicates before applying once', t => {
  const resolver = mockResolver(t);
  const value = ' 1.1.1.1 , 2001:0DB8:0000:0000:0000:0000:0000:0001 , 2001:db8::1 , 1.1.1.1 , 8.8.8.8 ';
  const expected = ['1.1.1.1', '2001:db8::1', '8.8.8.8'];
  assert.deepEqual(configureMongoDns(value), expected);
  assert.deepEqual(resolver.applied, [expected]);
  assert.equal(resolver.read.mock.callCount(), 0);
  assert.equal(resolver.write.mock.callCount(), 1);
});

test('Mongo DNS accepts literal private and IPv6 loopback addresses without interpreting them as hostnames', t => {
  const resolver = mockResolver(t);
  const expected = ['192.168.1.10', '::1'];
  assert.deepEqual(configureMongoDns('192.168.1.10,0:0:0:0:0:0:0:1'), expected);
  assert.deepEqual(resolver.applied, [expected]);
});

test('four distinct Mongo DNS addresses fail validation before any resolver change', t => {
  const resolver = mockResolver(t);
  assertInvalid('1.1.1.1,8.8.8.8,9.9.9.9,2001:db8::1');
  assert.equal(resolver.read.mock.callCount(), 0);
  assert.equal(resolver.write.mock.callCount(), 0);
});

test('Mongo DNS rejects malformed lists and non-string values with the same sanitized error', t => {
  const resolver = mockResolver(t);
  for (const value of [
    null, 53, true, [], {}, Buffer.from('1.1.1.1'),
    ',', ',1.1.1.1', '1.1.1.1,', '1.1.1.1,,8.8.8.8', '1.1.1.1, ,8.8.8.8',
    'dns.google', 'https://1.1.1.1', '1.1.1.1:53', '[2001:db8::1]', '[2001:db8::1]:53',
    'fe80::1%eth0', '2001::db8::1', '256.1.1.1', '01.1.1.1', '1.1.1.1;8.8.8.8',
    '\t1.1.1.1', '1.1.1.1\n', '1.1.1.1\r,8.8.8.8', '1.1.1.1\u0000', '1.1.1.1\u007f',
    'mongodb+srv://private-user:private-looking-secret@cluster.example/test',
    '1.1.1.1,8.8.8.8,invalid-private-looking-secret',
  ]) assertInvalid(value);
  assert.equal(resolver.read.mock.callCount(), 0);
  assert.equal(resolver.write.mock.callCount(), 0);
});

test('Mongo DNS enforces the input byte limit before trimming', t => {
  const resolver = mockResolver(t);
  const boundary = `${' '.repeat(249)}1.1.1.1`;
  assert.equal(Buffer.byteLength(boundary, 'utf8'), 256);
  assert.deepEqual(configureMongoDns(boundary), ['1.1.1.1']);
  assertInvalid(` ${boundary}`);
  assert.equal(resolver.write.mock.callCount(), 1, 'Oversized input must not apply another resolver configuration');
});

test('Mongo DNS wraps resolver application failures without exposing resolver error details', t => {
  const resolver = mockResolver(t);
  const failure = new Error('Synthetic resolver failure containing private-looking-secret');
  resolver.write.mock.mockImplementation(() => { throw failure; });
  assert.throws(() => configureMongoDns('1.1.1.1'), error => {
    assert.ok(error instanceof TypeError);
    assert.notEqual(error, failure);
    assert.equal(error.message, validationMessage);
    assert.equal(error.message.includes('private-looking-secret'), false);
    return true;
  });
  assert.equal(resolver.write.mock.callCount(), 1);
  assert.equal(resolver.read.mock.callCount(), 0);
});

test('Mongo DNS default parameter reads only the explicitly patched environment value', t => {
  const resolver = mockResolver(t);
  setEnvironment(t, ' 1.1.1.1, 2606:4700:4700:0:0:0:0:1111 ');
  const expected = ['1.1.1.1', '2606:4700:4700::1111'];
  assert.deepEqual(configureMongoDns(), expected);
  assert.deepEqual(resolver.applied, [expected]);
  assert.equal(resolver.read.mock.callCount(), 0);
  assert.equal(resolver.write.mock.callCount(), 1);
});

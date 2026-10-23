import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { createVnpayIpnRelay } from '../utils/vnpayIpnRelay.js';

const ipnPath = '/api/payments/vnpay/ipn';
const retry = { RspCode: '99', Message: 'Unable to record transaction' };
const reply = (res, body, { status = 200, type = 'application/json', headers = {} } = {}) => {
  res.writeHead(status, { 'Content-Type': type, ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const listen = async (t, server) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
};
const setup = async (t, handler, options = {}) => {
  const apiPort = await listen(t, createServer(handler));
  return listen(t, createVnpayIpnRelay({ apiPort, ...options }));
};
const call = (port, path = ipnPath, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, headers: res.headers, body: content ? JSON.parse(content) : null });
    });
    res.on('error', reject);
  });
  req.on('error', reject);
  req.end();
});

test('IPN relay preserves the literal signed query while forwarding no client credentials or headers', async t => {
  const path = ipnPath + '?vnp_OrderInfo=A+B%20C%2f&vnp_Amount=100&vnp_Amount=200&vnp_SecureHash=TEST';
  let received;
  const port = await setup(t, (req, res) => {
    received = { url: req.url, method: req.method, headers: req.headers };
    reply(res, { RspCode: '97', Message: 'private upstream details', secret: 'discard' }, {
      headers: { 'Set-Cookie': 'private=value', 'X-Private': 'discard' },
    });
  });
  const result = await call(port, path, { headers: {
    Authorization: 'Bearer private', Cookie: 'session=private',
    'X-Forwarded-Host': 'untrusted.example', 'X-Private': 'discard',
  } });
  assert.equal(received.url, path);
  assert.equal(received.method, 'GET');
  assert.equal(received.headers.accept, 'application/json');
  for (const name of ['authorization', 'cookie', 'x-forwarded-host', 'x-private']) {
    assert.equal(received.headers[name], undefined);
  }
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { RspCode: '97', Message: 'Invalid Signature' });
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(result.headers['x-private'], undefined);
});

test('IPN relay exposes only the exact GET IPN route and cannot act as an open proxy', async t => {
  let requests = 0;
  const port = await setup(t, (req, res) => { requests++; reply(res, { RspCode: '00' }); });
  for (const path of [
    '/', '/health', '/api/test', '/api/orders', '/api/payments/vnpay/return',
    ipnPath + '/', '/api/payments/vnpay/%69pn', ipnPath + '/../../orders',
    'http://127.0.0.1:5000' + ipnPath, '//127.0.0.1:5000' + ipnPath,
  ]) assert.equal((await call(port, path)).status, 404, path);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    const result = await call(port, ipnPath, { method });
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.allow, 'GET');
  }
  assert.equal((await call(port, ipnPath + '?x=' + 'a'.repeat(8192))).status, 414);
  assert.equal(requests, 0);
  assert.deepEqual((await call(port, ipnPath + '?target=http://untrusted.example/api/orders')).body,
    { RspCode: '00', Message: 'Confirm Success' });
  assert.equal(requests, 1);
});

test('IPN relay normalizes every supported VNPAY response code', async t => {
  const expected = {
    '00': 'Confirm Success', '01': 'Order not found', '02': 'Order already updated',
    '04': 'Invalid amount', '97': 'Invalid Signature', '99': 'Unable to record transaction',
  };
  let code;
  const port = await setup(t, (req, res) => reply(res, { RspCode: code, Message: 'sensitive upstream error' }));
  for (const [value, message] of Object.entries(expected)) {
    code = value;
    const result = await call(port);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { RspCode: value, Message: message });
  }
});

test('IPN relay requests a retry for invalid, oversized or failed upstream replies', async t => {
  let respond;
  const port = await setup(t, (req, res) => respond(res));
  const responses = [
    res => reply(res, '<html>interstitial</html>', { type: 'text/html' }),
    res => reply(res, '{invalid json'),
    res => reply(res, { RspCode: '00' }, { status: 500 }),
    res => reply(res, { RspCode: '00' }, { status: 302, headers: { Location: 'http://untrusted.example/' } }),
    res => reply(res, { RspCode: '03' }),
    res => reply(res, { RspCode: 0 }),
    res => reply(res, [{ RspCode: '00' }]),
    res => reply(res, null),
    res => reply(res, { RspCode: '00', Message: 'a'.repeat(4096) }),
    res => reply(res, { RspCode: '00' }, { headers: { 'Content-Encoding': 'gzip' } }),
    res => res.destroy(),
  ];
  for (const handler of responses) {
    respond = handler;
    const result = await call(port);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, retry);
  }
});

test('IPN relay bounds upstream requests that hang before headers or never finish a response', async t => {
  for (const responseStarted of [false, true]) {
    const port = await setup(t, (req, res) => {
      if (responseStarted) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
      }
    }, { requestTimeoutMS: 40 });
    const result = await call(port);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, retry);
  }
});

test('IPN relay returns a gateway retry if the loopback API is unreachable', async t => {
  const unavailable = createServer();
  const apiPort = await new Promise(resolve => unavailable.listen(0, '127.0.0.1', () => resolve(unavailable.address().port)));
  await new Promise(resolve => unavailable.close(resolve));
  const relayPort = await listen(t, createVnpayIpnRelay({ apiPort }));
  assert.deepEqual((await call(relayPort)).body, retry);
});

test('IPN relay rejects invalid target ports and unbounded timeout settings', () => {
  for (const apiPort of [0, -1, 65536, 5000.5, '5000', NaN]) {
    assert.throws(() => createVnpayIpnRelay({ apiPort }), /Invalid local API port/);
  }
  for (const requestTimeoutMS of [0, -1, 60001, 0.5, '5000', NaN]) {
    assert.throws(() => createVnpayIpnRelay({ requestTimeoutMS }), /Invalid IPN request timeout/);
  }
});

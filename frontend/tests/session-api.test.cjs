const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

let api;
let authAPI;
let customersAPI;
let ordersAPI;

before(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'utils', 'api.js')],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['axios'],
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
  ({ default: api, authAPI, customersAPI, ordersAPI } = module.exports);
});

const setup = (token = 'token-A') => {
  const values = new Map(token ? [['token', token], ['user', JSON.stringify({ _id: 'A' })]] : []);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  globalThis.window = { location: { pathname: '/profile', href: '' } };
  return values;
};

const expiredRequest = (path = '/orders/myorders') => {
  let reject;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  api.defaults.adapter = config => new Promise((resolve, rejectRequest) => {
    reject = () => rejectRequest({ config, response: { status: 401 } });
    markStarted(config);
  });
  const settled = api.get(path).then(() => assert.fail('Expected unauthorized response'), error => error);
  return { started, settled, reject: () => reject() };
};

test('VNPAY API preserves the original return query and uses cancellable order payment requests', async () => {
  setup();
  const requests = [];
  api.defaults.adapter = async config => {
    requests.push(config);
    return { status: 200, data: {}, config };
  };
  const controller = new AbortController();
  await ordersAPI.createVnpayPayment('order-1', { signal: controller.signal });
  const rawQuery = '?vnp_OrderInfo=Thanh+toan%20giay&vnp_SecureHash=a%2Bb%2Fc';
  await ordersAPI.verifyVnpayReturn(rawQuery, { signal: controller.signal });
  await ordersAPI.getOrderById('order-1', { signal: controller.signal });
  await ordersAPI.reconcileVnpayPayment('order-1', { signal: controller.signal });
  await ordersAPI.reconcileVnpayPayment('order-1', { signal: controller.signal, txnRef: 'attempt-1' });
  assert.equal(requests[0].method, 'post');
  assert.equal(requests[0].url, '/orders/order-1/vnpay/payment');
  assert.equal(requests[0].data, '{}');
  assert.equal(requests[1].method, 'get');
  assert.equal(requests[1].url, '/payments/vnpay/return' + rawQuery);
  assert.equal(requests[1].params, undefined);
  assert.equal(requests[2].url, '/orders/order-1');
  assert.equal(requests[3].url, '/orders/order-1/vnpay/reconcile');
  assert.equal(requests[3].method, 'post');
  assert.equal(requests[3].data, '{}');
  assert.equal(requests[3].timeout, 30000);
  assert.deepEqual(JSON.parse(requests[4].data), { txnRef: 'attempt-1' });
  assert.ok(requests.every(config => config.signal === controller.signal));
});

test('profile restoration pins its captured token even if storage changes before Axios sends the request', async () => {
  setup();
  let sent;
  api.defaults.adapter = async config => {
    sent = config;
    return { status: 200, data: { _id: 'A' }, config };
  };
  const controller = new AbortController();
  const request = authAPI.getProfile({ token: 'token-A', signal: controller.signal });
  localStorage.setItem('token', 'token-B');
  assert.equal((await request).data._id, 'A');
  assert.equal(sent.headers.get('Authorization'), 'Bearer token-A');
  assert.equal(sent.signal, controller.signal);
  assert.equal(localStorage.getItem('token'), 'token-B');
});

test('ordinary requests and profile callers without options still use the current stored token', async () => {
  setup('token-B');
  const requests = [];
  api.defaults.adapter = async config => {
    requests.push(config);
    return { status: 200, data: {}, config };
  };
  await api.get('/orders/myorders');
  await authAPI.getProfile();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(config => config.headers.get('Authorization') === 'Bearer token-B'));
});

test('profile updates pin their session token even when storage changes before Axios dispatch', async () => {
  setup();
  let sent;
  api.defaults.adapter = async config => {
    sent = config;
    return { status: 200, data: { _id: 'A' }, config };
  };
  const request = customersAPI.updateProfile({ name: 'Updated A' }, { token: 'token-A' });
  localStorage.setItem('token', 'token-B');
  await request;
  assert.equal(sent.headers.get('Authorization'), 'Bearer token-A');
  assert.equal(sent.method, 'put');
  assert.equal(sent.url, '/customers/profile');
  assert.equal(localStorage.getItem('token'), 'token-B');
});

test('a late protected API 401 from account A cannot erase or redirect the newly logged-in account B', async () => {
  setup();
  const request = expiredRequest();
  assert.equal((await request.started).headers.get('Authorization'), 'Bearer token-A');
  localStorage.setItem('token', 'token-B');
  localStorage.setItem('user', JSON.stringify({ _id: 'B', isAdmin: true }));
  request.reject();
  assert.equal((await request.settled).response.status, 401);
  assert.equal(localStorage.getItem('token'), 'token-B');
  assert.equal(JSON.parse(localStorage.getItem('user'))._id, 'B');
  assert.equal(window.location.href, '');
});

test('a late protected API 401 after logout leaves a subsequent anonymous session alone', async () => {
  setup();
  const request = expiredRequest();
  await request.started;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  request.reject();
  await request.settled;
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(localStorage.getItem('user'), null);
  assert.equal(window.location.href, '');
});

test('a 401 belonging to the current session still clears stored credentials and redirects to login', async () => {
  setup();
  const request = expiredRequest();
  await request.started;
  request.reject();
  await request.settled;
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(localStorage.getItem('user'), null);
  assert.equal(window.location.href, '/login');
});

test('profile restoration and login failures are handled by their caller without global session removal', async () => {
  for (const path of ['/customers/profile', '/customers/login']) {
    setup();
    const request = expiredRequest(path);
    await request.started;
    request.reject();
    await request.settled;
    assert.equal(localStorage.getItem('token'), 'token-A');
    assert.equal(JSON.parse(localStorage.getItem('user'))._id, 'A');
    assert.equal(window.location.href, '');
  }
});

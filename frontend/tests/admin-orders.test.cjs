const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

let AdminOrders;
const mockPlugin = {
  name: 'admin-orders-test-mocks',
  setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'mock' }));
    build.onResolve({ filter: /utils\/api(?:\.js)?$/ }, () => ({ path: 'api', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState = initial => globalThis.__adminOrdersTest.state(initial); export const useEffect = effect => globalThis.__adminOrdersTest.effects.push(effect); export const useRef = initial => globalThis.__adminOrdersTest.ref(initial);' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment = "fragment"; export const jsx = (type, props, key) => ({ type, props: props || {}, key }); export const jsxs = jsx;' };
      if (args.path === 'icons') return { contents: ['FaBox', 'FaPhone', 'FaMapMarkerAlt', 'FaEdit', 'FaSearch', 'FaMoneyBillWave'].map(icon => `export const ${icon} = () => null;`).join('\n') };
      if (args.path === 'api') return { contents: 'export const ordersAPI = new Proxy({}, { get: (_, name) => (...args) => globalThis.__adminOrdersTest.request(name, args) });' };
    });
  },
};

before(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'components', 'AdminOrders.jsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    plugins: [mockPlugin], logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  AdminOrders = module.exports.default;
});

const nodes = tree => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
};
const text = tree => {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return text(tree.props?.children);
};
const orderOf = overrides => ({
  _id: 'order-00000001', orderStatus: 'Đang xử lý', paymentMethod: 'BANK', isPaid: true,
  createdAt: '2026-10-14T09:00:00.000Z', totalPrice: 230000,
  user: { name: 'Khách hàng' },
  orderItems: [{ product: 'shoe-1', name: 'Sneaker', color: 'Trắng', size: 40, quantity: 1, price: 200000 }],
  shippingAddress: { name: 'Khách hàng', address: 'Đường A', phone: '0901234567' },
  ...overrides,
});
const paymentTitles = ['Hủy xác nhận thanh toán', 'Xác nhận đã thanh toán'];
const setup = orders => {
  const harness = {
    values: [orders, false], cursor: 0, effects: [], calls: [], confirmations: [], alerts: [], events: [], refs: [], refCursor: 0,
    confirmResult: true,
    state(initial) {
      const index = this.cursor++;
      if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;
      return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }];
    },
    ref(initial) { const index = this.refCursor++; return this.refs[index] || (this.refs[index] = { current: initial }); },
    async request(name, args) {
      this.calls.push({ name, args });
      this.events.push(name);
      if (this.onRequest) return this.onRequest(name, args);
      return { data: orders };
    },
    render() { this.cursor = 0; this.refCursor = 0; this.effects = []; return AdminOrders(); },
    paymentButtons() { return nodes(this.render()).filter(node => node.type === 'button' && paymentTitles.includes(node.props.title)); },
    button(label) {
      const button = nodes(this.render()).find(node => node.type === 'button' && text(node).trim() === label);
      assert.ok(button, `Expected button: ${label}`);
      return button;
    },
  };
  globalThis.__adminOrdersTest = harness;
  globalThis.window = { confirm: message => {
    harness.confirmations.push(message);
    harness.events.push('confirm');
    return harness.confirmResult;
  } };
  globalThis.alert = message => { harness.alerts.push(message); harness.events.push('alert'); };
  return harness;
};

test('paid shipping and delivered orders hide payment reversal for both BANK and COD', () => {
  for (const paymentMethod of ['BANK', 'COD']) {
    for (const orderStatus of ['Đang giao', 'Đã giao']) {
      const h = setup([orderOf({ paymentMethod, orderStatus })]);
      assert.equal(h.paymentButtons().length, 0, `${paymentMethod}: ${orderStatus}`);
      assert.match(text(h.render()), /Đã thanh toán/);
      assert.equal(h.calls.length, 0);
    }
  }
});

test('paid processing and confirmed orders allow reversal after confirmation and refresh the list', async () => {
  for (const paymentMethod of ['BANK', 'COD']) {
    for (const orderStatus of ['Đang xử lý', 'Đã xác nhận']) {
      const order = orderOf({ paymentMethod, orderStatus });
      const h = setup([order]);
      const button = h.button('Hủy xác nhận');
      assert.equal(button.props.disabled, false);
      await button.props.onClick();
      assert.deepEqual(h.calls, [
        { name: 'updatePaymentStatus', args: [order._id, false] },
        { name: 'getAllOrders', args: [''] },
      ]);
      assert.equal(h.confirmations.length, 1);
      assert.match(h.confirmations[0], /hủy xác nhận thanh toán/);
      assert.deepEqual(h.events, ['confirm', 'updatePaymentStatus', 'alert', 'getAllOrders']);
    }
  }
});

test('unpaid non-cancelled BANK and COD orders retain confirmation in every existing status', async () => {
  for (const paymentMethod of ['BANK', 'COD']) {
    for (const orderStatus of ['Đang xử lý', 'Đã xác nhận', 'Đang giao', 'Đã giao']) {
      const order = orderOf({ paymentMethod, orderStatus, isPaid: false });
      const h = setup([order]);
      const button = h.button('Xác nhận đã TT');
      assert.equal(button.props.disabled, false);
      await button.props.onClick();
      assert.deepEqual(h.calls[0], { name: 'updatePaymentStatus', args: [order._id, true] });
      assert.equal(h.calls[1].name, 'getAllOrders');
      assert.match(h.confirmations[0], /xác nhận đã thanh toán/);
    }
  }
});

test('cancelled orders hide payment toggles and preserve their pending refund action', () => {
  for (const paymentMethod of ['BANK', 'COD']) {
    for (const isPaid of [true, false]) {
      const order = orderOf({ paymentMethod, isPaid, orderStatus: 'Đã hủy', refundStatus: isPaid ? 'pending' : 'not_required' });
      const h = setup([order]);
      assert.equal(h.paymentButtons().length, 0);
      if (isPaid) {
        assert.match(text(h.render()), /Chờ hoàn tiền cho khách hàng/);
        assert.equal(h.button('Xác nhận đã hoàn tiền').props.disabled, false);
      }
    }
  }
});

test('recording a pending refund still confirms and calls the separate refund endpoint', async () => {
  const order = orderOf({ orderStatus: 'Đã hủy', refundStatus: 'pending' });
  const h = setup([order]);
  await h.button('Xác nhận đã hoàn tiền').props.onClick();
  assert.deepEqual(h.calls, [
    { name: 'confirmRefund', args: [order._id] },
    { name: 'getAllOrders', args: [''] },
  ]);
  assert.match(h.confirmations[0], /không tự chuyển tiền/);
  assert.equal(h.paymentButtons().length, 0);
});

test('orders under cancellation hide either payment action', () => {
  for (const isPaid of [true, false]) {
    const h = setup([orderOf({ isPaid, cancellationLock: 'cancellation-in-progress' })]);
    assert.equal(h.paymentButtons().length, 0);
  }
});

test('payment callback rechecks forbidden status and cancellation ownership before confirmation or API', async () => {
  for (const changes of [
    { orderStatus: 'Đang giao' }, { orderStatus: 'Đã giao' }, { orderStatus: 'Đã hủy' },
    { cancellationLock: 'cancellation-in-progress' },
  ]) {
    const order = orderOf();
    const h = setup([order]);
    const callback = h.button('Hủy xác nhận').props.onClick;
    Object.assign(order, changes);
    assert.equal(h.paymentButtons().length, 0);
    await callback();
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const order = orderOf({ isPaid: false });
  const h = setup([order]);
  const callback = h.button('Xác nhận đã TT').props.onClick;
  order.cancellationLock = 'cancellation-in-progress';
  await callback();
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.calls.length, 0);
});

test('a pending payment operation disables other payment controls and their callbacks do no work', async () => {
  const first = orderOf();
  const second = orderOf({ _id: 'order-00000002' });
  const h = setup([first, second]);
  let resolvePayment;
  h.onRequest = async name => {
    if (name === 'updatePaymentStatus') return new Promise(resolve => { resolvePayment = resolve; });
    return { data: [{ ...first, isPaid: false }, second] };
  };
  const pending = h.paymentButtons()[0].props.onClick();
  const buttons = h.paymentButtons();
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every(button => button.props.disabled));
  await buttons[1].props.onClick();
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.calls.length, 1);
  resolvePayment({ data: { ...first, isPaid: false } });
  await pending;
  assert.deepEqual(h.calls.map(call => call.name), ['updatePaymentStatus', 'getAllOrders']);
  assert.ok(h.paymentButtons().every(button => !button.props.disabled));
});

test('declining payment confirmation sends no API request for confirmation or reversal', async () => {
  for (const isPaid of [true, false]) {
    const h = setup([orderOf({ isPaid })]);
    h.confirmResult = false;
    await h.paymentButtons()[0].props.onClick();
    assert.equal(h.confirmations.length, 1);
    assert.equal(h.calls.length, 0);
    assert.equal(h.alerts.length, 0);
  }
});

test('payment state errors show the actual server message and reload newer shipping state', async () => {
  for (const status of [400, 409]) {
    const order = orderOf();
    const h = setup([order]);
    const message = `Đơn hàng vừa chuyển sang Đang giao (${status}).`;
    h.onRequest = async name => {
      if (name === 'updatePaymentStatus') throw { response: { status, data: { message } } };
      return { data: [{ ...order, orderStatus: 'Đang giao' }] };
    };
    await h.button('Hủy xác nhận').props.onClick();
    assert.deepEqual(h.calls.map(call => call.name), ['updatePaymentStatus', 'getAllOrders']);
    assert.equal(h.alerts.length, 1);
    assert.ok(h.alerts[0].includes(message));
    assert.equal(h.paymentButtons().length, 0);
    assert.match(text(h.render()), /Đang giao/);
  }
});

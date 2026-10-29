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
    build.onResolve({ filter: /context\/AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState = initial => globalThis.__adminOrdersTest.state(initial); export const useEffect = effect => globalThis.__adminOrdersTest.effects.push(effect); export const useRef = initial => globalThis.__adminOrdersTest.ref(initial);' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment = "fragment"; export const jsx = (type, props, key) => ({ type, props: props || {}, key }); export const jsxs = jsx;' };
      if (args.path === 'icons') return { contents: ['FaBox', 'FaPhone', 'FaMapMarkerAlt', 'FaEdit', 'FaSearch', 'FaMoneyBillWave'].map(icon => `export const ${icon} = () => null;`).join('\n') };
      if (args.path === 'api') return { contents: 'export const ordersAPI = new Proxy({}, { get: (_, name) => (...args) => globalThis.__adminOrdersTest.request(name, args) });' };
      if (args.path === 'auth') return { contents: 'export const useAuth = () => globalThis.__adminOrdersTest.auth;' };
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
    auth: { user: { _id: 'admin-a', isAdmin: true }, loading: false },
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

test('VNPAY payment status is controlled by gateway callbacks and unpaid orders cannot ship', () => {
  for (const isPaid of [true, false]) {
    const h = setup([orderOf({ paymentMethod: 'VNPAY', isPaid, orderStatus: 'Đã xác nhận' })]);
    assert.equal(h.paymentButtons().length, 0);
    assert.match(text(h.render()), /VNPAY Sandbox/);
    nodes(h.render()).find(node => node.type === 'button' && node.props.title === 'Cập nhật trạng thái').props.onClick();
    const statusSelect = nodes(h.render()).find(node => node.type === 'select' && node.props.className?.split(' ').includes('border-blue-500'));
    const options = nodes(statusSelect).filter(node => node.type === 'option').map(text);
    assert.equal(options.includes('Đang giao'), isPaid);
    assert.equal(h.calls.length, 0);
  }
});

test('admin can inspect gateway transaction references and detect an overpayment requiring review', () => {
  const h = setup([orderOf({ paymentMethod: 'VNPAY', paymentReviewRequired: true,
    vnpayPayments: [{ txnRef: 'attempt-1', transactionNo: 'sandbox-1234', bankCode: 'NCB', state: 'paid', amount: 230000 }] })]);
  const tree = h.render();
  assert.match(text(tree), /sandbox-1234/);
  assert.match(text(tree), /Có nhiều giao dịch thành công/);
  assert.match(text(tree), /xử lý khoản thanh toán dư/);
});

test('admin reconciliation queries the sole existing attempt and refreshes persisted orders without creating a payment', async () => {
  const order = orderOf({ paymentMethod: 'VNPAY', isPaid: false, vnpayPayments: [{ txnRef: 'attempt-1', state: 'pending' }] });
  const h = setup([order]);
  h.onRequest = async name => name === 'reconcileVnpayPayment' ? { data: { order: { _id: order._id, isPaid: true }, message: 'VNPAY đã xác nhận thanh toán' } } : { data: [{ ...order, isPaid: true }] };
  await h.button('Đối chiếu với VNPAY').props.onClick();
  assert.deepEqual(h.calls.map(call => call.name), ['reconcileVnpayPayment', 'getAllOrders']);
  assert.equal(h.calls[0].args[0], order._id); assert.equal(h.calls[0].args[1].txnRef, 'attempt-1'); assert.ok(h.calls[0].args[1].signal instanceof AbortSignal);
  assert.equal(h.paymentButtons().length, 0); assert.match(text(h.render()), /VNPAY đã xác nhận thanh toán/);
});

test('admin reconciliation requires selecting an exact reference when an order has several unresolved attempts', async () => {
  const order = orderOf({ paymentMethod: 'VNPAY', isPaid: false, vnpayPayments: [{ txnRef: 'attempt-1', state: 'failed' }, { txnRef: 'attempt-2', state: 'pending' }] });
  const h = setup([order]); const button = h.button('Đối chiếu với VNPAY');
  assert.equal(button.props.disabled, true); await button.props.onClick(); assert.equal(h.calls.length, 0);
  const select = nodes(h.render()).find(node => node.type === 'select' && node.props['aria-label'] === 'Giao dịch cần đối chiếu');
  select.props.onChange({ target: { value: 'attempt-1' } });
  h.onRequest = async name => name === 'reconcileVnpayPayment' ? { data: { order, message: 'Chưa hoàn tất thanh toán' } } : { data: [order] };
  assert.equal(h.button('Đối chiếu với VNPAY').props.disabled, false); await h.button('Đối chiếu với VNPAY').props.onClick();
  assert.equal(h.calls[0].args[1].txnRef, 'attempt-1'); assert.match(text(h.render()), /Chưa hoàn tất thanh toán/);
});

test('admin reconciliation hides actions for orders without attempts, paid orders and active locks', () => {
  for (const changes of [{ vnpayPayments: [] }, { isPaid: true }, { cancellationLock: 'busy' }, { cancellationPending: true }, { checkoutFinalized: false }, { deliveryReturn: { state: 'processing' } }, { paymentMethod: 'BANK' }]) {
    const h = setup([orderOf({ paymentMethod: 'VNPAY', isPaid: false, vnpayPayments: [{ txnRef: 'attempt-1', state: 'pending' }], ...changes })]);
    assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node) === 'Đối chiếu với VNPAY'), false);
  }
});

test('admin reconciliation ignores duplicate clicks and late results for another account', async () => {
  const order = orderOf({ paymentMethod: 'VNPAY', isPaid: false, vnpayPayments: [{ txnRef: 'attempt-1', state: 'pending' }] });
  const h = setup([order]); let resolve;
  h.onRequest = () => new Promise(done => { resolve = done; });
  const button = h.button('Đối chiếu với VNPAY'); const pending = button.props.onClick(); const duplicate = button.props.onClick();
  assert.equal(h.calls.length, 1); h.auth.user = { _id: 'admin-b', isAdmin: true }; h.render();
  resolve({ data: { order: { _id: order._id, isPaid: true }, message: 'Old admin result' } }); await Promise.all([pending, duplicate]);
  assert.equal(h.calls.length, 1); assert.doesNotMatch(text(h.render()), /Old admin result/);
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

const { afterEach, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const sourceRoot = path.join(__dirname, '..', 'src');
const components = {};
const harnesses = new Set();
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const paymentUrl = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=attempt-1&vnp_SecureHash=signed-by-backend';
const orderOf = overrides => ({ _id: 'order-00000001', user: 'customer-a', paymentMethod: 'VNPAY', isPaid: false, orderStatus: 'Đang xử lý', totalPrice: 230000, orderItems: [], shippingAddress: {}, createdAt: '2026-10-22', ...overrides });

afterEach(() => {
  harnesses.forEach(h => h.unmount());
  harnesses.clear();
});

before(async () => {
  const entries = { Button: 'components/VnpayPaymentButton.jsx', Return: 'pages/VnpayReturn.jsx', Checkout: 'pages/Checkout.jsx', Orders: 'pages/MyOrders.jsx' };
  const icons = [...new Set(Object.values(entries).flatMap(relative => fs.readFileSync(path.join(sourceRoot, relative), 'utf8').match(/\bFa[A-Z]\w*/g) || []))];
  const plugin = {
    name: 'vnpay-ui-test-mocks',
    setup(build) {
      build.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^react-router-dom$|^react-icons\/fa$|context\/AuthContext(?:\.jsx)?$|utils\/api(?:\.js)?$/ }, args => ({ path: args.path, namespace: 'vnpay-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'vnpay-mock' }, args => {
        if (args.path === 'react') return { contents: 'export const useState=initial=>globalThis.__vnpayTest.state(initial);export const useRef=initial=>globalThis.__vnpayTest.ref(initial);export const useEffect=(effect,deps)=>globalThis.__vnpayTest.effect(effect,deps);' };
        if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment="fragment";export const jsx=(type,props,key)=>({type,props:props||{},key});export const jsxs=jsx;' };
        if (args.path === 'react-router-dom') return { contents: 'export const Link="a";export const useLocation=()=>globalThis.__vnpayTest.location;export const useNavigate=()=>(...args)=>globalThis.__vnpayTest.navigation.push(args);' };
        if (args.path === 'react-icons/fa') return { contents: icons.map(name => `export const ${name}=()=>null;`).join('\n') };
        if (args.path.includes('AuthContext')) return { contents: 'export const useAuth=()=>globalThis.__vnpayTest.auth;' };
        return { contents: 'const api=new Proxy({},{get:(_,name)=>(...args)=>globalThis.__vnpayTest.request(name,args)});export const ordersAPI=api,cartAPI=api,vouchersAPI=api;' };
      });
    },
  };
  await Promise.all(Object.entries(entries).map(async ([name, relative]) => {
    const result = await esbuild.build({ entryPoints: [path.join(sourceRoot, relative)], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [plugin], logLevel: 'silent' });
    const module = { exports: {} };
    new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
    components[name] = module.exports.default;
  }));
});

const setup = (name, props = {}, values = []) => {
  const h = {
    values: [...values], refs: [], effectSlots: [], pendingEffects: [], calls: [], updates: [], redirects: [], navigation: [], stateCursor: 0, refCursor: 0, effectCursor: 0,
    auth: { user: { _id: 'customer-a', name: 'Khách hàng' }, loading: false }, location: { search: '?vnp_ResponseCode=00&vnp_TxnRef=attempt-1&vnp_SecureHash=original%2Bhash' },
    state(initial) { const index = this.stateCursor++; if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial; return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }]; },
    ref(initial) { const index = this.refCursor++; return this.refs[index] ||= { current: initial }; },
    effect(create, deps) {
      const index = this.effectCursor++; const previous = this.effectSlots[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        const slot = this.effectSlots[index] = { deps };
        this.pendingEffects.push(() => { previous?.cleanup?.(); slot.cleanup = create(); });
      }
    },
    request(name, args) { const pending = deferred(); this.calls.push({ name, args, ...pending }); return pending.promise; },
    render(flush = false) { this.stateCursor = 0; this.refCursor = 0; this.effectCursor = 0; const tree = components[name](props); if (flush) this.pendingEffects.splice(0).forEach(create => create()); return tree; },
    unmount() { this.effectSlots.forEach(slot => slot.cleanup?.()); },
    button(label) { const button = nodes(this.render()).find(node => node.type === 'button' && text(node).includes(label)); assert.ok(button, `Missing button ${label}`); return button; },
    requests(name) { return this.calls.filter(call => call.name === name); },
  };
  if (name === 'Button') props.onOrderUpdated ||= updated => h.updates.push(updated);
  globalThis.__vnpayTest = h;
  globalThis.window = { location: { assign: url => h.redirects.push(url) }, confirm: () => true };
  harnesses.add(h);
  return h;
};

test('only eligible persisted VNPAY orders can open the gateway', async () => {
  const { canPayWithVnpay, vnpaySandboxUrl } = await import(pathToFileURL(path.join(sourceRoot, 'utils/vnpay.js')).href);
  assert.equal(canPayWithVnpay(orderOf()), true);
  assert.equal(canPayWithVnpay(orderOf({ orderStatus: 'Đã xác nhận' })), true);
  for (const changes of [{ paymentMethod: 'COD' }, { paymentMethod: 'BANK' }, { isPaid: true }, { _id: null }, { orderStatus: 'Đã hủy' }, { orderStatus: 'Đang giao' }, { orderStatus: 'Đã giao' }, { orderStatus: 'Giao thất bại' }, { orderStatus: 'Đã xử lý hoàn hàng' }, { cancellationLock: 'locked' }, { checkoutFinalized: false }, { deliveryReturn: { state: 'processing' } }]) {
    const props = { order: orderOf(changes) }; const h = setup('Button', props); assert.equal(h.render(true), null); assert.equal(h.calls.length, 0); assert.equal(canPayWithVnpay(props.order), false);
  }
  assert.equal(vnpaySandboxUrl(paymentUrl), paymentUrl);
  for (const unsafe of ['http://sandbox.vnpayment.vn/paymentv2/vpcpay.html', 'https://sandbox.vnpayment.vn.attacker.test/paymentv2/vpcpay.html', 'https://sandbox.vnpayment.vn/other', 'https://user:password@sandbox.vnpayment.vn/paymentv2/vpcpay.html', 'https://sandbox.vnpayment.vn:444/paymentv2/vpcpay.html', 'javascript:alert(1)', paymentUrl + '#fragment']) assert.throws(() => vnpaySandboxUrl(unsafe));
});

test('gateway button uses order id and a cancellable request, blocks duplicate clicks and opens only server URL', async () => {
  const h = setup('Button', { order: orderOf() }); h.render(true);
  const button = h.button('Thanh toán VNPAY'); const first = button.props.onClick(); const duplicate = button.props.onClick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'createVnpayPayment'); assert.equal(h.calls[0].args[0], orderOf()._id); assert.ok(h.calls[0].args[1].signal instanceof AbortSignal);
  h.calls[0].resolve({ data: { paymentUrl } }); await Promise.all([first, duplicate]); assert.deepEqual(h.redirects, [paymentUrl]); assert.equal(h.updates.length, 0);
});

test('gateway button refuses non-sandbox redirects', async () => {
  const h = setup('Button', { order: orderOf() }); h.render(true); const pending = h.button('Thanh toán VNPAY').props.onClick();
  h.calls[0].resolve({ data: { paymentUrl: 'https://attacker.test' } }); await pending;
  assert.deepEqual(h.redirects, []); assert.match(text(h.render()), /không hợp lệ/);
});

test('late payment links cannot redirect after account change or unmount', async () => {
  for (const change of ['account', 'unmount']) {
    const h = setup('Button', { order: orderOf() }); h.render(true); const pending = h.button('Thanh toán VNPAY').props.onClick();
    if (change === 'account') { h.auth.user = { _id: 'customer-b' }; h.render(true); } else h.unmount();
    assert.equal(h.calls[0].args[1].signal.aborted, true); h.calls[0].resolve({ data: { paymentUrl } }); await pending; assert.deepEqual(h.redirects, []);
  }
});

test('an order cancelled or paid during a pending payment request cannot redirect', async () => {
  for (const changes of [{ isPaid: true }, { orderStatus: 'Đã hủy' }]) {
    const props = { order: orderOf() }; const h = setup('Button', props); h.render(true); const pending = h.button('Thanh toán VNPAY').props.onClick();
    props.order = orderOf(changes); assert.equal(h.render(true), null); h.calls[0].resolve({ data: { paymentUrl } }); await pending; assert.equal(h.redirects.length, 0);
  }
});

test('manual reconciliation queries the server for a persisted order and never submits a paid flag', async () => {
  const h = setup('Button', { order: orderOf() }); h.render(true); const button = h.button('Đối chiếu với VNPAY'); const pending = button.props.onClick(); const duplicate = button.props.onClick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'reconcileVnpayPayment'); assert.equal(h.calls[0].args[0], orderOf()._id); assert.ok(h.calls[0].args[1].signal instanceof AbortSignal);
  h.calls[0].resolve({ data: { order: orderOf({ isPaid: true }), message: 'VNPAY xác nhận thành công' } }); await Promise.all([pending, duplicate]);
  assert.deepEqual(h.updates, [orderOf({ isPaid: true })]); assert.equal(h.redirects.length, 0); assert.equal(h.requests('updatePaymentStatus').length, 0);
  assert.equal(h.requests('createVnpayPayment').length, 0);
});

test('manual reconciliation displays a pending result or an API failure without making another payment', async () => {
  for (const outcome of ['pending', 'error', 'wrong-order']) {
    const h = setup('Button', { order: orderOf() }); h.render(true); const pending = h.button('Đối chiếu với VNPAY').props.onClick();
    if (outcome === 'error') h.calls[0].reject({ response: { data: { message: 'VNPAY đang bận, thử lại sau' } } });
    else h.calls[0].resolve({ data: { order: orderOf(outcome === 'wrong-order' ? { _id: 'other-order' } : {}), message: 'VNPAY chưa xác nhận nhận tiền' } });
    await pending;
    assert.match(text(h.render()), outcome === 'pending' ? /VNPAY chưa xác nhận nhận tiền/ : outcome === 'error' ? /VNPAY đang bận/ : /Kết quả đối chiếu chưa hợp lệ/);
    assert.equal(h.updates.length, outcome === 'pending' ? 1 : 0); assert.equal(h.redirects.length, 0); assert.equal(h.calls.length, 1);
    assert.equal(h.button('Đối chiếu với VNPAY').props.disabled, false);
  }
});

test('late reconciliation cannot update another account, another order or an unmounted payment button', async () => {
  for (const change of ['account', 'order', 'unmount']) {
    const props = { order: orderOf() }; const h = setup('Button', props); h.render(true); const pending = h.button('Đối chiếu với VNPAY').props.onClick();
    if (change === 'account') { h.auth.user = { _id: 'customer-b' }; h.render(true); }
    else if (change === 'order') { props.order = orderOf({ _id: 'other-order' }); h.render(true); }
    else h.unmount();
    assert.equal(h.calls[0].args[1].signal.aborted, true);
    h.calls[0].resolve({ data: { order: orderOf({ isPaid: true }), message: 'Old reconciliation succeeded' } }); await pending;
    assert.equal(h.updates.length, 0); assert.doesNotMatch(text(h.render()), /Old reconciliation succeeded/);
  }
});

test('return page forwards the exact raw query and waits for backend confirmation despite success query', async () => {
  const h = setup('Return'); h.render(true); assert.equal(h.calls[0].name, 'verifyVnpayReturn'); assert.equal(h.calls[0].args[0], h.location.search);
  assert.doesNotMatch(text(h.render()), /Thanh toán thành công/);
  h.calls[0].resolve({ data: { status: 'pending', message: 'Đang chờ IPN', orderId: orderOf()._id } }); await settle();
  assert.match(text(h.render()), /Đang chờ xác nhận thanh toán/); assert.doesNotMatch(text(h.render()), /Thanh toán thành công/);
  const refresh = h.button('Kiểm tra lại').props.onClick(); h.calls[1].resolve({ data: { status: 'paid', message: 'Đã nhận IPN', orderId: orderOf()._id } }); await refresh;
  assert.match(text(h.render()), /Thanh toán thành công/); assert.equal(h.requests('updatePaymentStatus').length, 0);
});

test('return reconciliation is explicit, authenticated and refreshes the verified raw return before displaying paid', async () => {
  const h = setup('Return'); h.render(true);
  assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node).includes('Đối chiếu với VNPAY')), false);
  h.calls[0].resolve({ data: { status: 'pending', orderId: orderOf()._id } }); await settle();
  const button = h.button('Đối chiếu với VNPAY'); const pending = button.props.onClick(); const duplicate = button.props.onClick();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].name, 'reconcileVnpayPayment'); assert.equal(h.calls[1].args[0], orderOf()._id);
  assert.equal(h.calls[1].args[1].txnRef, 'attempt-1');
  assert.ok(h.calls[1].args[1].signal instanceof AbortSignal);
  await h.button('Kiểm tra lại').props.onClick(); assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ data: { order: orderOf({ isPaid: true }), message: 'Đã đối chiếu với VNPAY' } }); await settle();
  assert.equal(h.calls[2].name, 'verifyVnpayReturn'); assert.equal(h.calls[2].args[0], h.location.search);
  assert.doesNotMatch(text(h.render()), /Thanh toán thành công/);
  h.calls[2].resolve({ data: { status: 'paid', orderId: orderOf()._id } }); await Promise.all([pending, duplicate]);
  assert.match(text(h.render()), /Thanh toán thành công/); assert.equal(h.requests('updatePaymentStatus').length, 0); assert.equal(h.requests('createVnpayPayment').length, 0);
});

test('return reconciliation is hidden for anonymous users, failed results and missing verified orders', async () => {
  for (const changes of [{ status: 'failed', orderId: orderOf()._id }, { status: 'invalid', orderId: orderOf()._id }, { status: 'paid', orderId: orderOf()._id }, { status: 'pending' }, { status: 'pending', orderId: orderOf()._id, anonymous: true }]) {
    const h = setup('Return'); if (changes.anonymous) h.auth.user = null; h.render(true); h.calls[0].resolve({ data: changes }); await settle();
    assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node).includes('Đối chiếu với VNPAY')), false);
    assert.equal(h.requests('reconcileVnpayPayment').length, 0);
  }
});

test('return reconciliation errors remain unpaid and do not create automatic gateway queries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = setup('Return'); h.render(true); h.calls[0].resolve({ data: { status: 'pending', orderId: orderOf()._id } }); await settle();
  const pending = h.button('Đối chiếu với VNPAY').props.onClick();
  h.calls[1].reject({ response: { status: 429, data: { message: 'Vui lòng chờ trước khi đối chiếu lại' } } }); await pending;
  assert.match(text(h.render()), /Vui lòng chờ trước khi đối chiếu lại/); assert.doesNotMatch(text(h.render()), /Thanh toán thành công/);
  t.mock.timers.tick(120000); assert.equal(h.calls.length, 2); assert.equal(h.button('Đối chiếu với VNPAY').props.disabled, false);
});

test('return reconciliation aborts and ignores its result when the account, signed query or page changes', async () => {
  for (const change of ['account', 'query', 'unmount']) {
    const h = setup('Return'); h.render(true); h.calls[0].resolve({ data: { status: 'pending', orderId: orderOf()._id } }); await settle();
    const pending = h.button('Đối chiếu với VNPAY').props.onClick(); const old = h.calls[1];
    if (change === 'account') { h.auth.user = { _id: 'customer-b' }; h.render(true); }
    else if (change === 'query') { h.location.search = '?vnp_TxnRef=attempt-2&vnp_SecureHash=new'; h.render(true); assert.equal(h.calls.length, 3); h.calls[2].resolve({ data: { status: 'failed' } }); await settle(); }
    else h.unmount();
    assert.equal(old.args[1].signal.aborted, true); const count = h.calls.length;
    old.resolve({ data: { order: orderOf({ isPaid: true }), message: 'Old reconciliation succeeded' } }); await pending;
    assert.equal(h.calls.length, count); assert.doesNotMatch(text(h.render()), /Old reconciliation succeeded|Thanh toán thành công/);
  }
});

test('invalid signatures and failed payment responses never display paid status', async () => {
  for (const status of ['invalid', 'failed']) {
    const h = setup('Return'); h.render(true); h.calls[0].resolve({ data: { status, message: 'Kết quả đã kiểm tra tại backend' } }); await settle();
    assert.doesNotMatch(text(h.render()), /Thanh toán thành công/); assert.match(text(h.render()), status === 'invalid' ? /Không xác minh được/ : /Thanh toán chưa hoàn tất/);
  }
  const h = setup('Return'); h.location.search = ''; h.render(true); await settle(); assert.equal(h.calls.length, 0); assert.match(text(h.render()), /Không có dữ liệu kết quả/);
});

test('an earlier signed return request cannot overwrite a different return page', async () => {
  const h = setup('Return'); h.render(true); const old = h.calls[0]; h.location.search = '?vnp_TxnRef=attempt-2&vnp_SecureHash=new'; h.render(true);
  assert.equal(old.args[1].signal.aborted, true); h.calls[1].resolve({ data: { status: 'failed', message: 'New attempt failed' } }); await settle();
  old.resolve({ data: { status: 'paid', message: 'Old attempt paid' } }); await settle(); assert.match(text(h.render()), /New attempt failed/); assert.doesNotMatch(text(h.render()), /Old attempt paid|Thanh toán thành công/);
});

test('pending returns recheck sequentially and stop on each verified terminal status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const status of ['paid', 'failed', 'invalid']) {
    const h = setup('Return'); h.render(true);
    h.calls[0].resolve({ data: { status: 'pending', message: 'Waiting for IPN' } }); await settle();
    t.mock.timers.tick(2999); assert.equal(h.calls.length, 1);
    t.mock.timers.tick(1); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].args[0], h.location.search);
    t.mock.timers.tick(6000); assert.equal(h.calls.length, 2, 'An unfinished check must not start another request');
    h.calls[1].resolve({ data: { status, message: `Verified ${status}` } }); await settle();
    t.mock.timers.tick(120000); assert.equal(h.calls.length, 2);
    assert.match(text(h.render()), new RegExp(`Verified ${status}`));
    assert.equal(h.requests('updatePaymentStatus').length, 0);
    h.unmount();
  }
});

test('manual return checks replace queued polls and block duplicate or overlapping requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = setup('Return'); h.render(true);
  await h.button('Đang kiểm tra').props.onClick(); assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ data: { status: 'pending' } }); await settle();
  t.mock.timers.tick(1000);
  const button = h.button('Kiểm tra lại'); const manual = button.props.onClick(); const duplicate = button.props.onClick();
  assert.equal(h.calls.length, 2); h.calls[1].resolve({ data: { status: 'pending' } }); await Promise.all([manual, duplicate]);
  t.mock.timers.tick(2000); assert.equal(h.calls.length, 2, 'The replaced poll must not fire at its original deadline');
  t.mock.timers.tick(1000); assert.equal(h.calls.length, 3);
  await h.button('Đang kiểm tra').props.onClick(); t.mock.timers.tick(6000); assert.equal(h.calls.length, 3);
  h.calls[2].resolve({ data: { status: 'paid' } }); await settle();
  t.mock.timers.tick(120000); assert.equal(h.calls.length, 3); assert.match(text(h.render()), /Thanh toán thành công/);
});

test('return polling stops after twenty checks with next steps and keeps manual checking available', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = setup('Return'); h.render(true);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt) t.mock.timers.tick(3000);
    assert.equal(h.calls.length, attempt + 1);
    h.calls[attempt].resolve({ data: { status: 'pending', message: 'Waiting for IPN' } }); await settle();
  }
  assert.match(text(h.render()), /Chưa nhận được xác nhận thanh toán từ VNPAY/);
  assert.match(text(h.render()), /kiểm tra Đơn hàng của tôi hoặc liên hệ cửa hàng\. Không cần thanh toán lại/);
  t.mock.timers.tick(120000); assert.equal(h.calls.length, 20);
  const button = h.button('Kiểm tra lại'); assert.equal(button.props.disabled, false);
  const manual = button.props.onClick(); assert.equal(h.calls.length, 21);
  h.calls[20].resolve({ data: { status: 'paid' } }); await manual;
  assert.match(text(h.render()), /Thanh toán thành công/); assert.doesNotMatch(text(h.render()), /Chưa nhận được xác nhận/);
});

test('the one-minute deadline aborts a slow poll and ignores its late success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = setup('Return'); h.render(true);
  h.calls[0].resolve({ data: { status: 'pending' } }); await settle();
  t.mock.timers.tick(3000); const slow = h.calls[1]; assert.equal(slow.args[1].signal.aborted, false);
  t.mock.timers.tick(57000); assert.equal(slow.args[1].signal.aborted, true);
  assert.match(text(h.render()), /Chưa nhận được xác nhận/); assert.equal(h.button('Kiểm tra lại').props.disabled, false);
  slow.resolve({ data: { status: 'paid', message: 'Late paid response' } }); await settle();
  assert.doesNotMatch(text(h.render()), /Thanh toán thành công|Late paid response/);
  const manual = h.button('Kiểm tra lại').props.onClick(); h.calls[2].resolve({ data: { status: 'pending' } }); await manual;
  t.mock.timers.tick(120000); assert.equal(h.calls.length, 3, 'Manual refresh after timeout must not restart automatic polling');
});

test('return lifecycle cleanup cancels queued timers and aborts polls on query change or unmount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const change of ['query', 'unmount']) {
    for (const phase of ['scheduled', 'in-flight']) {
      const h = setup('Return'); h.render(true);
      h.calls[0].resolve({ data: { status: 'pending' } }); await settle();
      if (phase === 'in-flight') t.mock.timers.tick(3000);
      const old = h.calls.at(-1);
      if (change === 'query') {
        h.location.search = '?vnp_TxnRef=attempt-2&vnp_SecureHash=new'; h.render(true);
        h.calls.at(-1).resolve({ data: { status: 'failed', message: 'New attempt failed' } }); await settle();
      } else h.unmount();
      const count = h.calls.length; const values = [...h.values];
      if (phase === 'in-flight') {
        assert.equal(old.args[1].signal.aborted, true);
        old.resolve({ data: { status: 'paid', message: 'Old poll paid' } }); await settle();
      }
      t.mock.timers.tick(120000); assert.equal(h.calls.length, count); assert.deepEqual(h.values, values);
      assert.doesNotMatch(text(h.render()), /Old poll paid|Thanh toán thành công/);
      h.unmount();
    }
  }
});

test('failed or malformed return refreshes clear a previously verified paid result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const failure of ['network', 'malformed', 'constructor']) {
    const h = setup('Return'); h.render(true); h.calls[0].resolve({ data: { status: 'paid' } }); await settle();
    assert.match(text(h.render()), /Thanh toán thành công/);
    const manual = h.button('Kiểm tra lại').props.onClick();
    if (failure === 'network') h.calls[1].reject(new Error('Verification unavailable'));
    else h.calls[1].resolve({ data: { status: failure === 'constructor' ? 'constructor' : 'untrusted' } });
    await manual;
    assert.doesNotMatch(text(h.render()), /Thanh toán thành công/); assert.match(text(h.render()), /Chưa xác minh được thanh toán/);
    t.mock.timers.tick(120000); assert.equal(h.calls.length, 2);
    h.unmount();
  }
});

test('a failed automatic check stops its deadline and allows a manual recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = setup('Return'); h.render(true); h.calls[0].resolve({ data: { status: 'pending' } }); await settle();
  t.mock.timers.tick(3000); h.calls[1].reject(new Error('Verification unavailable')); await settle();
  assert.match(text(h.render()), /Verification unavailable/); assert.doesNotMatch(text(h.render()), /Đang chờ xác nhận thanh toán/);
  const values = [...h.values]; t.mock.timers.tick(120000); assert.equal(h.calls.length, 2); assert.deepEqual(h.values, values);
  const manual = h.button('Kiểm tra lại').props.onClick(); h.calls[2].resolve({ data: { status: 'paid' } }); await manual;
  assert.match(text(h.render()), /Thanh toán thành công/); assert.doesNotMatch(text(h.render()), /Verification unavailable/);
});

test('changing the signed query hides a previously paid result before the new effect runs', async () => {
  const h = setup('Return'); h.render(true); h.calls[0].resolve({ data: { status: 'paid' } }); await settle();
  assert.match(text(h.render()), /Thanh toán thành công/);
  h.location.search = '?vnp_TxnRef=attempt-2&vnp_SecureHash=new';
  assert.doesNotMatch(text(h.render()), /Thanh toán thành công/);
  h.render(true); assert.equal(h.calls.length, 2); h.calls[1].resolve({ data: { status: 'invalid' } }); await settle();
  assert.doesNotMatch(text(h.render()), /Thanh toán thành công/);
});

const checkoutValues = () => [[{ _id: 'cart-1', product: { _id: 'shoe-1', name: 'Sneaker', price: 200000 }, color: 'Trắng', size: 40, quantity: 1 }], false, false, 2, '', [], '', null, '', false, null,
  { name: 'Khách hàng', phone: '0901234567', address: 'Đường A', city: 'Hà Nội', district: '', ward: '', notes: '' }, 'VNPAY'];

test('checkout creates the order before automatic VNPAY redirect and does not send bank sender data', async () => {
  const h = setup('Checkout', {}, checkoutValues()); const submit = h.button('Đặt giày').props.onClick();
  assert.deepEqual(h.calls.map(call => call.name), ['createOrder']); const payload = h.calls[0].args[0]; assert.equal(payload.paymentMethod, 'VNPAY'); assert.equal(payload.bankTransferInfo, undefined);
  h.calls[0].resolve({ data: orderOf() }); await settle(); assert.deepEqual(h.calls.map(call => call.name), ['createOrder', 'createVnpayPayment']); assert.equal(h.redirects.length, 0);
  h.calls[1].resolve({ data: { paymentUrl } }); await submit; assert.equal(h.values[3], 3); assert.deepEqual(h.redirects, [paymentUrl]);
});

test('payment link failure preserves the created order and does not repeat checkout or clear its cart confirmation', async () => {
  const h = setup('Checkout', {}, checkoutValues()); const submit = h.button('Đặt giày').props.onClick(); h.calls[0].resolve({ data: orderOf() }); await settle();
  h.calls[1].reject({ response: { status: 409, data: { message: 'Thanh toán đang được xử lý' } } }); await submit;
  assert.equal(h.values[3], 3); assert.equal(h.values[10]._id, orderOf()._id); assert.equal(h.calls.length, 2); assert.equal(h.redirects.length, 0); assert.match(text(h.render()), /Đơn hàng đã được tạo/);
  const resume = nodes(h.render()).find(node => typeof node.type === 'function' && node.props?.order?._id === orderOf()._id); assert.ok(resume);
});

test('checkout double click creates one order and late payment response cannot redirect a different account', async () => {
  const h = setup('Checkout', {}, checkoutValues()); const button = h.button('Đặt giày'); const first = button.props.onClick(); const duplicate = button.props.onClick(); assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ data: orderOf() }); await settle(); h.auth.user = { _id: 'customer-b' }; h.render(); h.calls[1].resolve({ data: { paymentUrl } }); await Promise.all([first, duplicate]); assert.equal(h.redirects.length, 0);
});

test('order history labels VNPAY and offers the shared persisted-order payment action', () => {
  const order = orderOf(); const h = setup('Orders', {}, [[order], false, false, '']); const tree = h.render(); assert.match(text(tree), /VNPAY Sandbox/);
  assert.ok(nodes(tree).find(node => typeof node.type === 'function' && node.props?.order === order && typeof node.props.onOrderUpdated === 'function'));
});

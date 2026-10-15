const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const components = {};
const mockPlugin = {
  name: 'delivery-return-mocks',
  setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'mock' }));
    build.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'mock' }));
    build.onResolve({ filter: /utils\/api(?:\.js)?$/ }, () => ({ path: 'api', namespace: 'mock' }));
    build.onResolve({ filter: /context\/AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState = initial => globalThis.__deliveryTest.state(initial); export const useRef = initial => globalThis.__deliveryTest.ref(initial); export const useEffect = effect => globalThis.__deliveryTest.effects.push(effect);' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment="fragment"; export const jsx=(type,props,key)=>({type,props:props||{},key}); export const jsxs=jsx;' };
      if (args.path === 'router') return { contents: 'export const Link="a";' };
      if (args.path === 'icons') return { contents: ['FaBox', 'FaPhone', 'FaMapMarkerAlt', 'FaEdit', 'FaSearch', 'FaMoneyBillWave', 'FaCheckCircle', 'FaClock', 'FaTruck', 'FaTimesCircle'].map(name => `export const ${name}=()=>null;`).join('\n') };
      if (args.path === 'api') return { contents: 'export const ordersAPI=new Proxy({},{get:(_,name)=>(...args)=>globalThis.__deliveryTest.request(name,args)});' };
      if (args.path === 'auth') return { contents: 'export const useAuth=()=>globalThis.__deliveryTest.auth;' };
    });
  },
};
before(async () => {
  for (const [name, relative] of Object.entries({ Delivery: 'components/DeliveryReturnActions.jsx', Admin: 'components/AdminOrders.jsx', Customer: 'pages/MyOrders.jsx' })) {
    const result = await esbuild.build({ entryPoints: [path.join(__dirname, '..', 'src', relative)], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [mockPlugin], logLevel: 'silent' });
    const module = { exports: {} };
    new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
    components[name] = module.exports.default;
    if (name === 'Delivery') components.Summary = module.exports.DeliveryReturnSummary;
  }
});
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const orderOf = overrides => ({ _id: 'order-00000001', orderStatus: 'Đang giao', paymentMethod: 'COD', isPaid: false, refundStatus: 'not_required', totalPrice: 210000, shippingPrice: 30000,
  createdAt: '2026-10-15', user: { name: 'Khách hàng' }, orderItems: [{ _id: 'line-1', product: 'shoe-1', name: 'Sneaker', color: 'Trắng', size: 40, quantity: 3, price: 60000 }], shippingAddress: { name: 'Khách hàng', address: 'Đường A', phone: '0901234567' }, ...overrides });
const setup = (name, props = {}, values = []) => {
  const h = {
    values, refs: [], cursor: 0, refCursor: 0, effects: [], calls: [], confirmations: [], alerts: [],
    auth: { user: { _id: 'customer-1' }, loading: false },
    state(initial) { const index = this.cursor++; if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial; return [this.values[index], value => { this.values[index] = typeof value === 'function' ? value(this.values[index]) : value; }]; },
    ref(initial) { const index = this.refCursor++; return this.refs[index] || (this.refs[index] = { current: initial }); },
    async request(name, args) { this.calls.push({ name, args }); return this.onRequest ? this.onRequest(name, args) : { data: this.values[0] }; },
    render() { this.cursor = 0; this.refCursor = 0; this.effects = []; return components[name](props); },
    button(label) { const button = nodes(this.render()).find(node => node.type === 'button' && text(node).trim() === label); assert.ok(button, `Missing button ${label}`); return button; },
    form() { const form = nodes(this.render()).find(node => node.type === 'form'); assert.ok(form); return form; },
    async submit() { return this.form().props.onSubmit({ preventDefault() {} }); },
    change(label, value) { const field = nodes(this.render()).find(node => node.type === 'label' && text(node).includes(label)); assert.ok(field, `Missing field ${label}`); const input = nodes(field).find(node => ['input', 'textarea'].includes(node.type)); input.props.onChange({ target: { value } }); },
    deliveryProps() { return nodes(this.render()).find(node => node.props?.onMarkFailed)?.props; },
  };
  globalThis.__deliveryTest = h;
  globalThis.window = { confirm: message => { h.confirmations.push(message); return h.confirmResult !== false; } };
  globalThis.alert = message => h.alerts.push(message);
  return h;
};
const actionProps = order => ({ order, onMarkFailed: async (...args) => { globalThis.__deliveryTest.calls.push({ name: 'mark', args }); }, onSettleReturn: async (...args) => { globalThis.__deliveryTest.calls.push({ name: 'settle', args }); } });
const fillInspection = h => {
  h.change('Hàng tốt nhập lại kho', '1'); h.change('Hàng hỏng không nhập kho', '1'); h.change('Thất lạc / không nhận lại', '1'); h.change('Phí vận chuyển hàng quay về', '25000'); h.change('Ghi chú kiểm hàng', ' Kiểm thực tế ');
};

test('report failure requires reason and confirms no COD payment or automatic stock return', async () => {
  const h = setup('Delivery', actionProps(orderOf()));
  h.button('Báo giao thất bại / từ chối nhận').props.onClick();
  await h.submit();
  assert.equal(h.calls.length, 0);
  assert.match(text(h.render()), /Nhập lý do giao thất bại/);
  h.change('Lý do giao thất bại', ' Khách từ chối COD '); h.change('Ghi chú giao hàng', ' Đã gọi điện ');
  await h.submit();
  assert.deepEqual(h.calls, [{ name: 'mark', args: ['order-00000001', { reason: 'Khách từ chối COD', notes: 'Đã gọi điện' }] }]);
  assert.match(h.confirmations[0], /không thu tiền COD và không tự hoàn kho/);
});

test('inspection starts blank and cannot silently restore every pair', async () => {
  const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại' })));
  h.button('Xác nhận hàng quay về và kiểm hàng').props.onClick();
  assert.ok(nodes(h.render()).filter(node => node.type === 'input').every(node => node.props.value === ''));
  await h.submit();
  assert.equal(h.calls.length, 0); assert.equal(h.confirmations.length, 0);
  assert.match(text(h.render()), /Nhập đủ số lượng tốt, hỏng và thất lạc/);
});

test('inspection rejects totals different from ordered quantity and fractional quantities', async () => {
  for (const quantity of ['2', '0.5', '-1']) {
    const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại' })));
    h.button('Xác nhận hàng quay về và kiểm hàng').props.onClick(); fillInspection(h); h.change('Hàng tốt nhập lại kho', quantity);
    await h.submit(); assert.equal(h.calls.length, 0); assert.equal(h.confirmations.length, 0);
  }
});

test('inspection validates shop return cost before API', async () => {
  for (const cost of ['', '-1', '0.5']) {
    const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại' })));
    h.button('Xác nhận hàng quay về và kiểm hàng').props.onClick(); fillInspection(h); h.change('Phí vận chuyển hàng quay về', cost);
    await h.submit(); assert.equal(h.calls.length, 0); assert.match(text(h.render()), /Nhập phí vận chuyển hàng quay về/);
  }
});

test('valid physical inspection sends numeric counts and shop cost, without client refund authority', async () => {
  const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại', paymentMethod: 'BANK', isPaid: true })));
  h.button('Xác nhận hàng quay về và kiểm hàng').props.onClick(); fillInspection(h); await h.submit();
  assert.deepEqual(h.calls, [{ name: 'settle', args: ['order-00000001', { inspection: [{ itemIndex: 0, restockQuantity: 1, damagedQuantity: 1, missingQuantity: 1 }], returnShippingCost: 25000, notes: 'Kiểm thực tế' }] }]);
  assert.match(h.confirmations[0], /đã nhận và kiểm tra thực tế/); assert.match(h.confirmations[0], /180.000 ₫/);
});

test('refund preview accounts for net payment, free shipping and unpaid COD', () => {
  for (const [overrides, refund, shipping] of [[{ isPaid: true }, '180.000 ₫', '30.000 ₫'], [{ isPaid: true, shippingPrice: 0 }, '210.000 ₫', '0 ₫'], [{ isPaid: false }, '0 ₫', '0 ₫']]) {
    const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại', ...overrides })));
    h.button('Xác nhận hàng quay về và kiểm hàng').props.onClick();
    const displayed = text(h.render()).replace(/\s+/g, ' ');
    assert.ok(displayed.includes(`Tiền hoàn cho khách: ${refund}`)); assert.ok(displayed.includes(`Phí giao ban đầu giữ lại: ${shipping}`));
  }
});

test('processing return freezes saved inspection and retries precisely the persisted payload', async () => {
  const snapshot = { state: 'processing', inspection: [{ itemIndex: 0, restockQuantity: 1, damagedQuantity: 1, missingQuantity: 1 }], returnShippingCost: 12000, notes: 'Đã kiểm', retainedShippingFee: 30000, refundAmount: 180000, recoveryRequired: true };
  const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại', isPaid: true, deliveryReturn: snapshot })));
  const tree = h.render();
  assert.ok(nodes(tree).filter(node => node.type === 'fieldset').every(node => node.props.disabled));
  assert.ok(nodes(tree).filter(node => node.type === 'textarea').every(node => node.props.disabled));
  await h.submit();
  assert.deepEqual(h.calls[0].args[1], { inspection: snapshot.inspection, returnShippingCost: 12000, notes: 'Đã kiểm' });
  assert.match(h.confirmations[0], /không nhập kho lại/);
});

test('rapid duplicate submit makes one mutation even without rerender', async () => {
  const wait = deferred(); const props = actionProps(orderOf()); props.onMarkFailed = async (...args) => { globalThis.__deliveryTest.calls.push({ name: 'mark', args }); await wait.promise; };
  const h = setup('Delivery', props); h.button('Báo giao thất bại / từ chối nhận').props.onClick(); h.change('Lý do giao thất bại', 'Không liên hệ được');
  const submit = h.form().props.onSubmit; const first = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations.length, 1); wait.resolve(); await first;
});

test('declining physical inspection confirmation sends no mutation', async () => {
  const h = setup('Delivery', actionProps(orderOf({ orderStatus: 'Giao thất bại' }))); h.confirmResult = false;
  h.button('Xác nhận hàng quay về và kiểm hàng').props.onClick(); fillInspection(h); await h.submit(); assert.equal(h.calls.length, 0);
});

test('completed return has no failure or inspection actions and displays actual settlement', () => {
  const order = orderOf({ orderStatus: 'Đã xử lý hoàn hàng', isPaid: true, refundStatus: 'pending', deliveryFailure: { reason: 'Từ chối nhận' }, deliveryReturn: { state: 'completed', refundAmount: 180000, retainedShippingFee: 30000, returnShippingCost: 25000, inspection: [{ itemIndex: 0, restockQuantity: 1, damagedQuantity: 1, missingQuantity: 1 }] } });
  const h = setup('Delivery', actionProps(order)); assert.equal(nodes(h.render()).filter(node => node.type === 'button').length, 0);
  const summary = text(components.Summary({ order })); assert.match(summary, /tốt\s+1\s*, hỏng\s+1\s*, thất lạc\s+1/); assert.match(summary, /180.000 ₫/); assert.match(summary, /Đang chờ cửa hàng xử lý hoàn tiền/);
});

test('customer summary hides internal notes and shop expenses while admin can inspect them', () => {
  const order = orderOf({ orderStatus: 'Đã xử lý hoàn hàng', isPaid: true, refundStatus: 'pending',
    deliveryFailure: { reason: 'Không giao được', notes: 'Ghi chú nội bộ giao hàng' },
    deliveryReturn: { state: 'completed', refundAmount: 180000, retainedShippingFee: 30000, returnShippingCost: 25000, notes: 'Ghi chú nội bộ kiểm hàng', inspection: [] } });
  const customer = text(components.Summary({ order }));
  assert.match(customer, /Không giao được/); assert.match(customer, /180.000 ₫/); assert.match(customer, /30.000 ₫/);
  assert.doesNotMatch(customer, /Ghi chú nội bộ|25.000 ₫|Phí vận chuyển hàng quay về/);
  const admin = text(components.Summary({ order, admin: true }));
  assert.match(admin, /Ghi chú nội bộ giao hàng/); assert.match(admin, /Ghi chú nội bộ kiểm hàng/); assert.match(admin, /25.000 ₫/);
  const h = setup('Delivery', actionProps(order));
  const summary = nodes(h.render()).find(node => typeof node.type === 'function' && node.props?.order === order);
  assert.equal(summary.props.admin, true);
});

test('admin hides ordinary payment and premature refund actions on failed delivery', () => {
  for (const isPaid of [true, false]) {
    const h = setup('Admin', {}, [[orderOf({ orderStatus: 'Giao thất bại', isPaid, refundStatus: 'pending' })], false]);
    const tree = h.render(); assert.equal(nodes(tree).filter(node => node.type === 'button' && ['Hủy xác nhận thanh toán', 'Xác nhận đã thanh toán'].includes(node.props.title)).length, 0);
    assert.equal(nodes(tree).filter(node => node.type === 'button' && text(node).includes('Xác nhận đã hoàn tiền')).length, 0);
  }
});

test('admin allows manual refund only after completed positive paid settlement', async () => {
  const order = orderOf({ orderStatus: 'Đã xử lý hoàn hàng', isPaid: true, refundStatus: 'pending', deliveryReturn: { state: 'completed', refundAmount: 180000 } });
  const h = setup('Admin', {}, [[order], false]); await h.button('Xác nhận đã hoàn tiền').props.onClick();
  assert.deepEqual(h.calls.map(call => call.name), ['confirmRefund', 'getAllOrders']);
  for (const changes of [{ isPaid: false }, { deliveryReturn: { state: 'completed', refundAmount: 0 } }, { deliveryReturn: { state: 'processing', refundAmount: 180000 } }]) {
    const invalid = setup('Admin', {}, [[{ ...order, ...changes }], false]); assert.equal(nodes(invalid.render()).filter(node => node.type === 'button' && text(node).includes('Xác nhận đã hoàn tiền')).length, 0);
  }
});

test('an earlier admin list cannot overwrite new failed-delivery state', async () => {
  const old = deferred(); const order = orderOf(); const failed = { ...order, orderStatus: 'Giao thất bại', deliveryFailure: { reason: 'Khách từ chối' } };
  const h = setup('Admin', {}, [[order], false]); h.onRequest = async name => name === 'getAllOrders' ? old.promise : { data: failed };
  h.render(); h.effects[0]();
  await h.deliveryProps().onMarkFailed(order._id, { reason: 'Khách từ chối', notes: '' });
  old.resolve({ data: [order] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.values[0][0].orderStatus, 'Giao thất bại');
});

test('customer sees return status and summary without cancellation action', () => {
  const order = orderOf({ orderStatus: 'Giao thất bại', deliveryFailure: { reason: 'Từ chối nhận' } });
  const h = setup('Customer', {}, [[order], false, false, '']); const tree = h.render();
  assert.match(text(tree), /Giao thất bại/); assert.equal(nodes(tree).filter(node => node.type === 'button' && text(node).includes('Hủy đơn hàng')).length, 0);
  const summary = nodes(tree).find(node => typeof node.type === 'function' && node.props?.order === order); assert.ok(summary); assert.match(text(summary.type(summary.props)), /Đang chờ cửa hàng nhận lại/);
});

test('late customer list does not overwrite a cancellation mutation', async () => {
  const old = deferred(); const order = orderOf({ orderStatus: 'Đang xử lý' }); const cancelled = { ...order, orderStatus: 'Đã hủy' };
  const h = setup('Customer', {}, [[order], false, false, '']); h.onRequest = async name => name === 'getMyOrders' ? old.promise : { data: { order: cancelled } };
  h.render(); h.effects[1](); h.values[0] = [order]; h.values[1] = false;
  await h.button('Hủy đơn hàng').props.onClick(); old.resolve({ data: [order] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.values[0][0].orderStatus, 'Đã hủy');
});

test('customer list from another account is ignored after account switch', async () => {
  const old = deferred(); const order = orderOf(); const h = setup('Customer', {}, [[], false, false, '']); h.onRequest = async () => old.promise;
  h.render(); h.effects[1](); h.auth.user = { _id: 'customer-2' }; h.render();
  old.resolve({ data: [order] }); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(h.values[0], []);
});

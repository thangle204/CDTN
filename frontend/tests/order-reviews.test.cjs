const { before, afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
let Component, Orders;
const harnesses = new Set();
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const item = { _id: 'line-1', product: 'shoe-1', name: 'Test sneaker', image: '/shoe.svg', size: 40, quantity: 1, price: 200000 };
const orderOf = changes => ({ _id: 'order-1', orderStatus: 'Đã giao', isDelivered: true, isPaid: true, totalPrice: 230000, orderItems: [item], shippingAddress: {}, createdAt: '2026-10-26', ...changes });
const reviewOf = changes => ({ _id: 'review-1', rating: 4, comment: 'Comfortable', version: 0, ...changes });
before(async () => {
  const plugin = { name: 'order-reviews-offline', setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^react-router-dom$|^react-icons\/fa$|context\/AuthContext(?:\.jsx)?$|utils\/api(?:\.js)?$/ }, args => ({ path: args.path, namespace: 'review-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'review-mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState=v=>globalThis.__reviewTest.state(v);export const useRef=v=>globalThis.__reviewTest.ref(v);export const useEffect=(fn,deps)=>globalThis.__reviewTest.effect(fn,deps);' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const jsx=(type,props,key)=>({type,props:props||{},key});export const jsxs=jsx;export const Fragment="fragment";' };
      if (args.path === 'react-router-dom') return { contents: 'export const Link="a";' };
      if (args.path === 'react-icons/fa') return { contents: ['FaStar','FaBox','FaPhone','FaMapMarkerAlt','FaCheckCircle','FaClock','FaTruck','FaTimesCircle'].map(name => `export const ${name}=()=>null;`).join('\n') };
      if (args.path.includes('AuthContext')) return { contents: 'export const useAuth=()=>globalThis.__reviewTest.auth;' };
      return { contents: 'export const ordersAPI=new Proxy({},{get:(_,name)=>(...args)=>globalThis.__reviewTest.request(name,args)});' };
    });
  }};
  const compile = async relative => {
    const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, '..', 'src', relative)], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [plugin], logLevel: 'silent' });
    const module = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports); return module.exports.default;
  };
  Component = await compile('components/OrderReviews.jsx'); Orders = await compile('pages/MyOrders.jsx');
});
afterEach(() => { harnesses.forEach(h => h.unmount()); harnesses.clear(); });
const setup = (order = orderOf(), component = () => Component) => {
  const h = {
    props: { order }, values: [], refs: [], slots: [], effects: [], calls: [], stateCursor: 0, refCursor: 0, effectCursor: 0,
    auth: { user: { _id: 'customer-a' }, loading: false },
    state(initial) { const index = this.stateCursor++; if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial; return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }]; },
    ref(initial) { return this.refs[this.refCursor++] ||= { current: initial }; },
    effect(create, deps = []) { const index = this.effectCursor++; const old = this.slots[index]; if (!old || deps.some((dep, i) => dep !== old.deps[i])) { const slot = this.slots[index] = { deps }; this.effects.push(() => { old?.cleanup?.(); slot.cleanup = create(); }); } },
    request(name, args) { const pending = deferred(); this.calls.push({ name, args, ...pending }); return pending.promise; },
    render(flush = false) { globalThis.__reviewTest = this; this.stateCursor = this.refCursor = this.effectCursor = 0; const tree = component()(this.props); if (flush) this.effects.splice(0).forEach(fn => fn()); return tree; },
    button(label) { const node = nodes(this.render()).find(node => node.type === 'button' && text(node).includes(label)); assert.ok(node, 'Missing button: ' + label); return node; },
    unmount() { this.slots.forEach(slot => slot.cleanup?.()); },
  };
  globalThis.__reviewTest = h; globalThis.window = { confirm: () => true };
  harnesses.add(h); h.render(true); return h;
};
const open = async (h, review = null) => {
  const pending = h.button('Đánh giá sản phẩm').props.onClick();
  const call = h.calls.at(-1);
  call.resolve({ data: { orderId: h.props.order._id, products: [{ productId: 'shoe-1', available: true, review }] } });
  await pending;
};
const edit = (h, label = 'Viết đánh giá', comment = ' Great fit ') => {
  h.button(label).props.onClick();
  const tree = h.render();
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: comment } });
  nodes(tree).find(node => node.type === 'input' && node.props.value === 3).props.onChange();
};
const submit = h => nodes(h.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('review controls appear only for paid delivered orders and never fetch before expansion', () => {
  for (const changes of [{ orderStatus: 'Đang xử lý' }, { orderStatus: 'Đang giao' }, { orderStatus: 'Đã hủy' }, { orderStatus: 'Giao thất bại' }, { orderStatus: 'Đã xử lý hoàn hàng' }, { isPaid: false }, { isDelivered: false }, { checkoutFinalized: false }, { cancellationLock: 'busy' }, { deliveryReturn: { state: 'completed' } }]) {
    const h = setup(orderOf(changes)); assert.equal(h.render(), null); assert.equal(h.calls.length, 0);
  }
  const h = setup(); assert(h.button('Đánh giá sản phẩm')); assert.equal(h.calls.length, 0);
  h.auth.user = null; assert.equal(h.render(), null);
});

test('MyOrders attaches the review action only to an eligible order', () => {
  for (const changes of [{}, { isPaid: false }, { orderStatus: 'Đang giao' }]) {
    const order = orderOf(changes), h = setup(order, () => Orders);
    h.values = [[order], false, false, ''];
    const actions = nodes(h.render()).filter(node => typeof node.type === 'function' && node.type.name === 'OrderReviews');
    assert.equal(actions.length, Object.keys(changes).length ? 0 : 1);
  }
});

test('opening reviews loads the selected order and deduplicates repeated colors and sizes', async () => {
  const h = setup(orderOf({ orderItems: [item, { ...item, _id: 'line-2', size: 41 }] }));
  await open(h);
  assert.equal(h.calls[0].name, 'getOrderReviews'); assert.equal(h.calls[0].args[0], 'order-1');
  assert(h.calls[0].args[1].signal instanceof AbortSignal);
  assert.equal(nodes(h.render()).filter(node => node.type === 'article').length, 1);
});

test('creating reviews sends stars and trimmed text to the order API and blocks duplicate clicks', async () => {
  const h = setup(); await open(h); edit(h);
  const first = submit(h), duplicate = submit(h);
  assert.equal(h.calls.length, 2); const call = h.calls[1];
  assert.equal(call.name, 'createOrderReview'); assert.deepEqual(call.args.slice(0, 3), ['order-1', 'shoe-1', { rating: 3, comment: 'Great fit' }]);
  assert.equal(h.button('Ẩn đánh giá').props.disabled, true);
  call.resolve({ data: { productId: 'shoe-1', review: reviewOf({ rating: 3, comment: 'Great fit' }) } }); await Promise.all([first, duplicate]);
  assert(text(h.render()).includes('Đã đánh giá')); assert(text(h.render()).includes('Great fit')); assert(h.button('Sửa đánh giá'));
  assert.equal(nodes(h.render()).some(node => node.type === 'form'), false);
});

test('editing loads the existing draft and sends its version without creating another review', async () => {
  const h = setup(); await open(h, reviewOf({ version: 2 }));
  h.button('Sửa đánh giá').props.onClick();
  assert.equal(nodes(h.render()).find(node => node.type === 'textarea').props.value, 'Comfortable');
  nodes(h.render()).find(node => node.type === 'textarea').props.onChange({ target: { value: 'Updated after use' } });
  const pending = submit(h); const call = h.calls[1];
  assert.equal(call.name, 'updateOrderReview'); assert.deepEqual(call.args.slice(0, 3), ['order-1', 'shoe-1', { rating: 4, comment: 'Updated after use', expectedVersion: 2 }]);
  call.resolve({ data: { productId: 'shoe-1', review: reviewOf({ version: 3, comment: 'Updated after use' }) } }); await pending;
  assert(text(h.render()).includes('Đã cập nhật đánh giá'));
});

test('blank comments cannot be submitted and cancelling a draft sends no write', async () => {
  const h = setup(); await open(h); edit(h, 'Viết đánh giá', '   ');
  await submit(h); assert.equal(h.calls.length, 1); assert(text(h.render()).includes('Vui lòng chọn'));
  h.button('Hủy').props.onClick(); assert.equal(nodes(h.render()).some(node => node.type === 'form'), false); assert.equal(h.calls.length, 1);
});

test('conflicts and lost responses require an explicit reload before another save', async () => {
  for (const failure of [{ response: { status: 409, data: { message: 'Review changed in another tab' } } }, new Error('Connection lost')]) {
    const h = setup(); await open(h); edit(h); const pending = submit(h); h.calls[1].reject(failure); await pending;
    assert(h.button('Tải lại đánh giá')); assert.equal(h.button('Gửi đánh giá').props.disabled, true);
    await submit(h); assert.equal(h.calls.length, 2);
    const reload = h.button('Tải lại đánh giá').props.onClick(); h.calls[2].resolve({ data: { orderId: 'order-1', products: [{ productId: 'shoe-1', available: true, review: reviewOf({ version: 1 }) }] } }); await reload;
    assert(h.button('Sửa đánh giá')); assert.equal(nodes(h.render()).some(node => node.type === 'form'), false);
  }
});

test('unavailable products and malformed responses cannot expose a writing form', async () => {
  const h = setup(); const loading = h.button('Đánh giá sản phẩm').props.onClick();
  h.calls[0].resolve({ data: { orderId: 'order-1', products: [{ productId: 'shoe-1', available: false, review: null }] } }); await loading;
  assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node).includes('Viết đánh giá')), false);
  h.button('Ẩn đánh giá').props.onClick(); const reload = h.button('Đánh giá sản phẩm').props.onClick();
  h.calls[1].resolve({ data: { orderId: 'another-order', products: [] } }); await reload;
  assert(text(h.render()).includes('Dữ liệu đánh giá không hợp lệ'));
});

test('late loads and saves are aborted and ignored when account, order or eligibility changes', async () => {
  for (const change of ['account', 'order', 'eligibility', 'unmount']) {
    for (const kind of ['load', 'save']) {
      const h = setup(); let pending;
      if (kind === 'save') { await open(h); edit(h); pending = submit(h); }
      else pending = h.button('Đánh giá sản phẩm').props.onClick();
      const call = h.calls.at(-1);
      if (change === 'account') h.auth.user = { _id: 'customer-b' };
      if (change === 'order') h.props.order = orderOf({ _id: 'order-2' });
      if (change === 'eligibility') h.props.order = orderOf({ isPaid: false });
      if (change === 'unmount') h.unmount(); else h.render(true);
      assert.equal(call.args.at(-1).signal.aborted, true);
      const snapshot = JSON.stringify(h.values);
      call.resolve({ data: kind === 'load' ? { orderId: 'order-1', products: [] } : { productId: 'shoe-1', review: reviewOf() } }); await pending;
      assert.equal(JSON.stringify(h.values), snapshot);
    }
  }
});

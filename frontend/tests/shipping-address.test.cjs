const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
let Checkout, Profile, helpers;
const original = { name: 'Người nhận A', phone: '0901234567', address: '10 Nguyễn Huệ', city: 'TP. Hồ Chí Minh', district: 'Quận 1', ward: 'Bến Nghé' };
const other = { name: 'Người nhận B', phone: '0901234568', address: '20 Trần Phú', city: 'Đà Nẵng', district: 'Hải Châu', ward: 'Thạch Thang' };
const user = { _id: 'customer-a', name: 'Khách A', phone: '0901234567', email: 'a@example.test' };
const cart = [{ _id: 'cart-a', product: { _id: 'shoe-a', name: 'Sneaker', price: 200000 }, quantity: 1 }];
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve;const promise = new Promise(r => { resolve = r; });return { promise, resolve }; };
before(async () => {
  const root = path.join(__dirname, '..', 'src');
  const icons = new Set(['Profile', 'Checkout'].flatMap(name => fs.readFileSync(path.join(root, 'pages', name + '.jsx'), 'utf8').match(/\bFa[A-Z]\w*/g) || []));
  const plugin = { name: 'shipping-ui-mocks', setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^react-router-dom$|^react-icons\/fa$|context\/AuthContext(?:\.jsx)?$|utils\/api(?:\.js)?$|(?:VoucherSelector|VnpayPaymentButton)(?:\.jsx)?$/ }, args => ({ path: args.path, namespace: 'shipping-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'shipping-mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState=x=>globalThis.__shippingTest.state(x);export const useRef=x=>globalThis.__shippingTest.ref(x);export const useEffect=(x,d)=>globalThis.__shippingTest.effect(x,d);' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment="fragment";export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;' };
      if (args.path === 'react-router-dom') return { contents: 'export const Link="a";export const useLocation=()=>({key:"test",search:""});export const useNavigate=()=>()=>{};' };
      if (args.path === 'react-icons/fa') return { contents: [...icons].map(name => `export const ${name}=()=>null;`).join('') };
      if (args.path.includes('AuthContext')) return { contents: 'export const useAuth=()=>globalThis.__shippingTest.auth;' };
      if (/VoucherSelector|VnpayPaymentButton/.test(args.path)) return { contents: 'export default ()=>null;' };
      return { contents: 'const api=new Proxy({},{get:(_,n)=>(...a)=>globalThis.__shippingTest.request(n,a)});export const cartAPI=api,ordersAPI=api,vouchersAPI=api;' };
    });
  } };
  const build = await esbuild.build({ stdin: { contents: "export {default as Checkout} from './pages/Checkout.jsx';export {default as Profile} from './pages/Profile.jsx';export * as helpers from './utils/shippingAddress.js';", resolveDir: root, loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, plugins: [plugin], logLevel: 'silent' });
  const module = { exports: {} };new Function('module', 'exports', build.outputFiles[0].text)(module, module.exports);({ Checkout, Profile, helpers } = module.exports);
});
const setup = (saved = original) => {
  const h = { values: [], refs: [], effects: [], pending: [], cursor: 0, refCursor: 0, effectCursor: 0, calls: [],
    state(initial) { const index = this.cursor++;if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }]; },
    ref(initial) { return this.refs[this.refCursor++] ||= { current: initial }; },
    effect(create, deps) { const index = this.effectCursor++, old = this.effects[index];if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) this.pending.push({ index, create, deps }); },
    flush() { for (const effect of this.pending.splice(0)) { this.effects[effect.index]?.cleanup?.();this.effects[effect.index] = { deps: effect.deps, cleanup: effect.create() }; } },
    render(component = Checkout) { this.cursor = 0;this.refCursor = 0;this.effectCursor = 0;this.pending = [];return component(); },
    async request(name, args) { this.calls.push({ name, args });return { data: name === 'createOrder' ? { _id: 'order-a', paymentMethod: 'COD', totalPrice: 230000 } : cart }; },
    async start(component = Checkout) { this.render(component);this.flush();await settle();return this.render(component); },
    input(name, component = Checkout) { return nodes(this.render(component)).find(node => node.type === 'input' && node.props.name === name); },
    fill(address, component = Checkout) { for (const [name, value] of Object.entries(address)) { const fieldName = component === Profile ? 'shippingAddress.' + name : name;const input = this.input(fieldName, component);assert(input, fieldName);input.props.onChange({ target: { name: fieldName, value } }); } },
    async proceed() { await nodes(this.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); },
    button(label, component = Checkout) { return nodes(this.render(component)).find(node => node.type === 'button' && text(node).includes(label)); },
  };
  h.auth = { user: { ...user, ...(saved ? { shippingAddress: { ...saved } } : {}) }, loading: false, updateProfile: async changes => {
    h.calls.push({ name: 'updateProfile', args: [changes] });h.auth.user = { ...h.auth.user, ...changes };return { success: true, data: h.auth.user };
  } };
  globalThis.__shippingTest = h;return h;
};

test('saved addresses prefill checkout and use the saved recipient without a profile write', async () => {
  const h = setup();const tree = await h.start();
  assert.match(text(tree), /Bạn có muốn thay đổi thông tin giao hàng không/);
  assert.match(text(tree), /10 Nguyễn Huệ/);assert.equal(h.input('address'), undefined);
  await h.proceed();assert.equal(h.values[3], 2);await h.button('Đặt giày').props.onClick();
  assert.equal(h.calls.some(call => call.name === 'updateProfile'), false);
  assert.deepEqual(h.calls.find(call => call.name === 'createOrder').args[0].shippingAddress, { ...original, notes: '' });
});

test('a one-order replacement changes the order snapshot while preserving the account default', async () => {
  const h = setup();await h.start();
  nodes(h.render()).find(node => node.type === 'input' && node.props.name === 'changeShipping' && node.props.value === 'yes').props.onChange();
  h.fill(other);await h.proceed();await h.button('Đặt giày').props.onClick();
  assert.deepEqual(h.calls.find(call => call.name === 'createOrder').args[0].shippingAddress, { ...other, notes: '' });
  assert.deepEqual(h.auth.user.shippingAddress, original);assert.equal(h.calls.some(call => call.name === 'updateProfile'), false);
});

test('choosing No after editing restores the default and hides replacement fields', async () => {
  const h = setup();await h.start();
  nodes(h.render()).find(node => node.props.name === 'changeShipping' && node.props.value === 'yes').props.onChange();h.fill(other);
  nodes(h.render()).find(node => node.props.name === 'changeShipping' && node.props.value === 'no').props.onChange();
  assert.equal(h.input('address'), undefined);await h.proceed();await h.button('Đặt giày').props.onClick();
  assert.equal(h.calls.find(call => call.name === 'createOrder').args[0].shippingAddress.address, original.address);
});

test('the first checkout address saves once before confirmation and excludes delivery notes', async () => {
  const h = setup(null);await h.start();h.fill(other);
  const wait = deferred();h.auth.updateProfile = async changes => { h.calls.push({ name: 'updateProfile', args: [changes] });return wait.promise; };
  const first = h.proceed();await h.proceed();assert.equal(h.calls.filter(call => call.name === 'updateProfile').length, 1);
  assert.equal(h.values[3], 1);assert.equal(h.button('Đang lưu địa chỉ').props.disabled, true);
  assert.deepEqual(h.calls.find(call => call.name === 'updateProfile').args[0], { shippingAddress: other, onlyIfAddressMissing: true });
  h.auth.user = { ...h.auth.user, shippingAddress: other };wait.resolve({ success: true, data: h.auth.user });await first;
  assert.equal(h.values[3], 2);assert.equal(h.calls.some(call => call.name === 'createOrder'), false);
});

test('invalid or failed first-address saves keep the draft and cannot advance checkout', async () => {
  const h = setup(null);await h.start();await h.proceed();assert.equal(h.calls.some(call => call.name === 'updateProfile'), false);assert.equal(h.values[3], 1);
  h.fill(other);h.auth.updateProfile = async () => ({ success: false, message: 'Tài khoản đã có địa chỉ, vui lòng tải lại' });await h.proceed();
  assert.equal(h.values[3], 1);assert.match(text(h.render()), /Tài khoản đã có địa chỉ/);assert.equal(h.input('address').props.value, other.address);
});

test('switching accounts during an address save discards the old result and address', async () => {
  const h = setup(null);await h.start();h.fill(other);const wait = deferred();h.auth.updateProfile = async () => wait.promise;
  const pending = h.proceed();h.auth.user = { ...user, _id: 'customer-b', shippingAddress: original };h.render();h.flush();
  wait.resolve({ success: true, data: { ...user, shippingAddress: other } });await pending;await settle();
  assert.equal(h.values[3], 1);assert.deepEqual(h.values[9], { ...original, notes: '' });assert.equal(h.auth.user._id, 'customer-b');
});

test('Profile can save an address, cancel an edit and reject an incomplete address', async () => {
  const h = setup();await h.start(Profile);h.button('Chỉnh sửa thông tin', Profile).props.onClick();h.fill(other, Profile);
  await nodes(h.render(Profile)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls.find(call => call.name === 'updateProfile').args[0], { shippingAddress: other });
  assert.deepEqual(h.auth.user.shippingAddress, other);
  const cancel = setup();await cancel.start(Profile);cancel.button('Chỉnh sửa thông tin', Profile).props.onClick();cancel.fill(other, Profile);cancel.button('Hủy', Profile).props.onClick();
  assert.deepEqual(cancel.values[5].shippingAddress, original);assert.equal(cancel.calls.some(call => call.name === 'updateProfile'), false);
  const invalid = setup(null);await invalid.start(Profile);invalid.button('Chỉnh sửa thông tin', Profile).props.onClick();invalid.fill({ address: 'Only a street' }, Profile);
  await nodes(invalid.render(Profile)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(invalid.calls.some(call => call.name === 'updateProfile'), false);assert.match(text(invalid.render(Profile)), /tỉnh \/ thành phố/);
});

test('address helpers whitelist saved fields and retain the existing contact for a new account', () => {
  assert.deepEqual(helpers.cleanShippingAddress({ ...other, notes: 'Leave at reception', isAdmin: true }), other);
  assert.equal(helpers.shippingAddressOf(user).name, user.name);assert.equal(helpers.hasShippingAddress(null), false);
  assert.equal(helpers.hasShippingAddress(original), true);assert.throws(() => helpers.cleanShippingAddress({ ...other, phone: '123' }));
});

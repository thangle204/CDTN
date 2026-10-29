const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
let helpers, AdminVouchers, Vouchers, VoucherSelector, VoucherCard, Checkout;
const deferred = () => { let resolve, reject;const promise = new Promise((a, b) => { resolve = a;reject = b; });return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const code = { _id: 'voucher-a', __v: 4, code: 'SAVE10', description: 'Original', type: 'percent', discount: 10, minOrder: 500000, maxUses: 10, usedCount: 0,
  startDate: '2026-10-01T03:12:45.123Z', endDate: '2026-10-28T03:10:22.123Z', isActive: true };
const setup = (values = []) => {
  const h = { values: [...values], refs: [], effectSlots: [], pending: [], cursor: 0, refCursor: 0, effectCursor: 0, calls: [], navigation: [],
    auth: { user: { _id: 'owner-a', name: 'A' }, loading: false }, location: { pathname: '/offers', key: 'one', search: '' },
    state(initial) { const index = this.cursor++;if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;
      return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }]; },
    ref(initial) { return this.refs[this.refCursor++] ||= { current: initial }; },
    effect(create, dependencies) { const index = this.effectCursor++, old = this.effectSlots[index];
      if (!old || !dependencies || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) this.pending.push({ index, create, dependencies }); },
    flush() { const work = this.pending;this.pending = [];for (const item of work) { this.effectSlots[item.index]?.cleanup?.();this.effectSlots[item.index] = { dependencies: item.dependencies, cleanup: item.create() }; } },
    unmount() { this.effectSlots.forEach(item => item?.cleanup?.()); },
    async request(name, args) { this.calls.push({ name, args });return { data: [] }; },
    render(Component, props) { this.cursor = 0;this.refCursor = 0;this.effectCursor = 0;this.pending = [];return Component(props); },
  };
  globalThis.__voucherTest = h;return h;
};
const load = async (entry, exportNames) => {
  const result = await esbuild.build({ entryPoints: [path.join(__dirname, '..', 'src', entry)], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'voucher-ui-mocks', setup(build) {
      build.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^react-router-dom$|^react-icons\/fa$|utils\/api(?:\.js)?$|context\/AuthContext(?:\.jsx)?$|VnpayPaymentButton(?:\.jsx)?$/ }, args => ({ path: args.path, namespace: 'voucher-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'voucher-mock' }, args => {
        if (args.path === 'react') return { contents: 'export const useState=x=>globalThis.__voucherTest.state(x);export const useRef=x=>globalThis.__voucherTest.ref(x);export const useEffect=(x,d)=>globalThis.__voucherTest.effect(x,d);' };
        if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment="fragment";export const jsx=(type,props,key)=>({type,props:props||{},key});export const jsxs=jsx;' };
        if (args.path === 'react-router-dom') return { contents: 'export const Link="a";export const useLocation=()=>globalThis.__voucherTest.location;export const useNavigate=()=>(...a)=>globalThis.__voucherTest.navigation.push(a);' };
        if (args.path === 'react-icons/fa') return { contents: ['FaMapMarkerAlt','FaCreditCard','FaShoppingBag','FaCheckCircle','FaTag','FaTimes'].map(name => `export const ${name}=()=>null;`).join('') };
        if (args.path.includes('AuthContext')) return { contents: 'export const useAuth=()=>globalThis.__voucherTest.auth;' };
        if (args.path.includes('VnpayPaymentButton')) return { contents: 'export default ()=>null;' };
        return { contents: 'const api=new Proxy({},{get:(_,n)=>(...args)=>globalThis.__voucherTest.request(n,args)});export const vouchersAPI=api,cartAPI=api,ordersAPI=api;' };
      });
    } }],
  });
  const module = { exports: {} };new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);return exportNames ? module.exports : module.exports.default;
};
before(async () => {
  helpers = await load('utils/vouchers.js', true);AdminVouchers = await load('components/AdminVouchers.jsx');Vouchers = await load('pages/Vouchers.jsx');
  VoucherSelector = await load('components/VoucherSelector.jsx');VoucherCard = await load('components/VoucherCard.jsx');Checkout = await load('pages/Checkout.jsx');
});

test('description-only edits retain exact timestamps and submit only a version and changed words', () => {
  const form = helpers.voucherForm(code);form.description = 'New description';
  assert.deepEqual(helpers.voucherPayload(form, code), { version: 4, description: 'New description' });
});

test('voucher dates use UTC+7 even when the browser timezone differs and reject invalid calendar dates', () => {
  assert.equal(helpers.voucherDateInput('2026-10-28T03:10:22.123Z'), '2026-10-28T10:10');
  assert.equal(helpers.voucherDateISO('2026-10-28T17:05'), '2026-10-28T10:05:00.000Z');
  assert.throws(() => helpers.voucherDateISO('2026-02-30T17:05'));assert.throws(() => helpers.voucherDateISO('2026-10-28'));
});

test('editing a calendar field submits that timestamp without changing the other calendar field', () => {
  const form = helpers.voucherForm(code);form.endDate = '2026-10-29T12:30';
  assert.deepEqual(helpers.voucherPayload(form, code), { version: 4, endDate: '2026-10-29T05:30:00.000Z' });
});

test('new first-order campaigns normalize caps, customer limits and expiry without creating a campaign automatically', () => {
  const form = { ...helpers.voucherForm(), code: ' new10 ', description: 'New', discount: '10', type: 'percent', maxDiscount: '100000', perCustomerLimit: '9', eligibility: 'first_order', endDate: '2027-01-01T12:00' };
  const payload = helpers.voucherPayload(form);assert.equal(payload.code, 'NEW10');assert.equal(payload.maxDiscount, 100000);assert.equal(payload.perCustomerLimit, 1);
  form.maxDiscount = '-1';assert.throws(() => helpers.voucherPayload(form));
});

test('a stale admin save keeps the dialog and entered text while showing the API conflict', async () => {
  const h = setup([[code], false]);let tree = h.render(AdminVouchers);
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Chỉnh sửa').props.onClick();tree = h.render(AdminVouchers);
  nodes(tree).find(node => node.props.name === 'description').props.onChange({ target: { name: 'description', value: 'Edited' } });
  h.request = async (name, args) => { h.calls.push({ name, args });throw { response: { status: 409, data: { message: 'Chương trình vừa thay đổi' } } }; };
  await nodes(h.render(AdminVouchers)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = h.render(AdminVouchers);assert(text(tree).includes('Chương trình vừa thay đổi'));assert(nodes(tree).some(node => node.props.role === 'dialog'));
  assert.deepEqual(h.calls[0].args[1], { version: 4, description: 'Edited' });
});

test('rapid admin submit starts one update and the status switch sends its displayed version', async () => {
  const h = setup([[code], false]), waiting = deferred();
  h.request = async (name, args) => { h.calls.push({ name, args });return name === 'updateVoucher' ? waiting.promise : { data: [code] }; };
  let tree = h.render(AdminVouchers);nodes(tree).find(node => node.type === 'button' && text(node) === 'Chỉnh sửa').props.onClick();
  tree = h.render(AdminVouchers);const submit = nodes(tree).find(node => node.type === 'form').props.onSubmit;
  const first = submit({ preventDefault() {} });await submit({ preventDefault() {} });assert.equal(h.calls.filter(call => call.name === 'updateVoucher').length, 1);
  waiting.resolve({ data: code });await first;
  tree = h.render(AdminVouchers);await nodes(tree).find(node => node.type === 'button' && text(node) === 'Ngừng áp dụng').props.onClick();
  assert.deepEqual(h.calls.find(call => call.name === 'toggleVoucher').args, [code._id, { version: 4 }]);
});

test('private cards expose no save action and a held voucher directs its owner to orders', () => {
  setup();let tree = VoucherCard({ voucher: { ...code, visibility: 'private', state: 'held', eligible: false }, onSave() {}, onChoose() {} });
  assert.equal(nodes(tree).filter(node => node.type === 'button').length, 1);assert.equal(nodes(tree).find(node => node.type === 'button').props.disabled, true);
  assert(nodes(tree).some(node => node.props.to === '/my-orders'));assert.equal(text(tree).includes('Lưu mã'), false);
});

test('voucher selection requires an explicit click and disabled cards cannot advertise an applicable discount', () => {
  setup();let chosen = null;
  const tree = VoucherCard({ voucher: { ...code, eligible: true, savings: 50000 }, onChoose: value => { chosen = value; }, recommended: true });
  assert.equal(chosen, null);nodes(tree).find(node => node.type === 'button').props.onClick();assert.equal(chosen, code.code);
  assert(text(tree).includes('Tiết kiệm nhất'));assert(text(tree).includes('50.000'));
});

test('personal wallet refreshes eligible grants with POST and ignores a response after unmount', async () => {
  const h = setup(), waiting = deferred();h.request = async (name, args) => { h.calls.push({ name, args });return waiting.promise; };
  h.render(Vouchers, { mine: true });h.flush();assert.equal(h.calls[0].name, 'refreshMyVouchers');h.unmount();
  waiting.resolve({ data: [code] });await settle();assert.deepEqual(h.values[0], []);
});

test('a late wallet save cannot update the next account before its effects have run', async () => {
  const h = setup([[code], false]), waiting = deferred();h.request = async () => waiting.promise;
  let tree = h.render(Vouchers, { mine: false });const save = nodes(tree).find(node => node.type === VoucherCard || node.type?.name === 'VoucherCard').props.onSave;
  const operation = save(code);h.auth = { ...h.auth, user: { _id: 'owner-b' } };h.render(Vouchers, { mine: false });
  waiting.resolve({ data: { message: 'Saved for A' } });await operation;assert.equal(h.values[3], '');assert.equal(h.values[0][0].walletId, undefined);
});

test('an out-of-order recommendation response cannot overwrite a new cart or account', async () => {
  const h = setup(), first = deferred(), second = deferred();let calls = 0;
  h.request = async () => (++calls === 1 ? first.promise : second.promise);
  h.render(VoucherSelector, { userId: 'a', subtotal: 500000 });h.flush();
  h.render(VoucherSelector, { userId: 'b', subtotal: 900000 });
  first.resolve({ data: [{ code: 'OLD' }] });await settle();assert.deepEqual(h.values[0], []);
  h.flush();second.resolve({ data: [{ code: 'CURRENT', eligible: true }] });await settle();assert.equal(h.values[0][0].code, 'CURRENT');
});

test('checkout ignores a late voucher quote or error from a different account and blocks simultaneous apply requests', async () => {
  const cart = [{ _id: 'cart', product: { _id: 'shoe', price: 500000 }, quantity: 1 }];
  const h = setup([cart, false, false, 1, '', [], '', null, '', false, null, {}, 'COD']), waiting = deferred();
  h.request = async (name, args) => { h.calls.push({ name, args });return waiting.promise; };
  let tree = h.render(Checkout);const choose = nodes(tree).find(node => node.type?.name === 'VoucherSelector').props.onChoose;
  const operation = choose('OLD');await choose('OTHER');assert.equal(h.calls.length, 1);
  h.auth = { ...h.auth, user: { _id: 'new-owner' } };h.render(Checkout);h.values[7] = { voucher: { code: 'CURRENT' }, totalPrice: 500000 };
  waiting.reject({ response: { data: { message: 'Old quote failed' } } });await operation;
  assert.equal(h.values[7].voucher.code, 'CURRENT');assert.equal(h.values[8], '');
});

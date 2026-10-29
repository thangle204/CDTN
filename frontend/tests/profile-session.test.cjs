const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

let AuthProvider, Profile;
const sourceRoot = path.join(__dirname, '..', 'src');
const userA = { _id: 'customer-a', name: 'Customer A', phone: '0901234567', email: 'a@example.test', isAdmin: true };
const userB = { _id: 'customer-b', name: 'Customer B', phone: '0901234568', email: 'b@example.test', isAdmin: false };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).includes(label));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };
const response = data => ({ data });
const errorResponse = message => ({ response: { status: 409, data: { message } } });

before(async () => {
  const icons = [...new Set(fs.readFileSync(path.join(sourceRoot, 'pages/Profile.jsx'), 'utf8').match(/\bFa[A-Z]\w*/g))];
  const plugin = {
    name: 'real-profile-provider-mocks',
    setup(build) {
      build.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^react-router-dom$|^react-icons\/fa$|utils\/api(?:\.js)?$/ }, args => ({ path: args.path, namespace: 'profile-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'profile-mock' }, args => {
        if (args.path === 'react-router-dom') return { contents: 'export const Link="a";' };
        if (args.path === 'react') return { contents: `
          export const createContext=()=>({Provider:'provider'});
          export const useContext=()=>globalThis.__profileSessionTest.auth;
          export const useState=initial=>globalThis.__profileSessionTest.active.state(initial);
          export const useRef=initial=>globalThis.__profileSessionTest.active.ref(initial);
          export const useEffect=(create,dependencies)=>globalThis.__profileSessionTest.active.effect(create,dependencies);
        ` };
        if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment="fragment"; export const jsx=(type,props)=>({type,props:props||{}}); export const jsxs=jsx;' };
        if (args.path === 'react-icons/fa') return { contents: icons.map(name => `export const ${name}=()=>null;`).join('\n') };
        return { contents: 'const api=new Proxy({},{get:(_,name)=>(...args)=>globalThis.__profileSessionTest.request(name,args)}); export const authAPI=api,customersAPI=api;' };
      });
    },
  };
  const build = await esbuild.build({
    stdin: { contents: "export { AuthProvider } from './context/AuthContext.jsx'; export { default as Profile } from './pages/Profile.jsx';", resolveDir: sourceRoot, loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [plugin], logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', build.outputFiles[0].text)(module, module.exports);
  ({ AuthProvider, Profile } = module.exports);
});

const createScope = () => ({
  hooks: [], cursor: 0, effects: [], mounted: true, writesAfterUnmount: 0,
  state(initial) {
    const index = this.cursor++;
    const slot = this.hooks[index] ||= { value: typeof initial === 'function' ? initial() : initial };
    return [slot.value, next => {
      if (!this.mounted) this.writesAfterUnmount += 1;
      slot.value = typeof next === 'function' ? next(slot.value) : next;
    }];
  },
  ref(initial) { const index = this.cursor++; return (this.hooks[index] ||= { value: { current: initial } }).value; },
  effect(create, dependencies) {
    const index = this.cursor++;
    const previous = this.hooks[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
      const slot = this.hooks[index] = { dependencies };
      this.effects.push(() => { previous?.cleanup?.(); slot.cleanup = create(); });
    }
  },
  flushEffects() { this.effects.splice(0).forEach(effect => effect()); },
  unmount() { this.hooks.forEach(slot => slot.cleanup?.()); this.mounted = false; },
});

const setup = async () => {
  const storage = new Map([['token', 'token-a'], ['user', JSON.stringify(userA)]]);
  const h = globalThis.__profileSessionTest = {
    provider: createScope(), profile: createScope(), active: null, auth: null, requests: [], storage, storageWrites: [],
    request(name, args) { const pending = deferred(); this.requests.push({ name, args, ...pending }); return pending.promise; },
    calls(name) { return this.requests.filter(request => request.name === name); },
    value() {
      this.active = this.provider;
      this.provider.cursor = 0;
      this.auth = AuthProvider({ children: 'children' }).props.value;
      this.provider.flushEffects();
      return this.auth;
    },
    renderProfile() {
      this.value();
      this.active = this.profile;
      this.profile.cursor = 0;
      const tree = Profile();
      this.profile.flushEffects();
      return tree;
    },
    setInput(name, value) {
      const input = nodes(this.renderProfile()).find(node => node.type === 'input' && node.props.name === name);
      assert.ok(input, `Missing profile input ${name}`);
      input.props.onChange({ target: { name, value } });
    },
    startUpdate(name = 'Customer A edited') {
      this.renderProfile();
      button(this.renderProfile(), 'Chỉnh sửa thông tin').props.onClick();
      this.setInput('name', name);
      return nodes(this.renderProfile()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    },
  };
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { h.storageWrites.push({ key, value }); storage.set(key, String(value)); },
    removeItem: key => { h.storageWrites.push({ key, removed: true }); storage.delete(key); },
  };
  h.value();
  h.calls('getProfile')[0].resolve(response(userA));
  await settle();
  h.value();
  return h;
};
const assertSession = (h, user, token) => {
  assert.deepEqual(h.value().user, user);
  assert.equal(h.storage.get('token') ?? null, token);
  assert.deepEqual(h.storage.has('user') ? JSON.parse(h.storage.get('user')) : null, user);
};
const loginAs = async (h, user = userB, token = 'token-b') => {
  const result = h.value().login(user.email, 'password');
  h.calls('login').at(-1).resolve(response({ ...user, token }));
  assert.equal((await result).success, true);
  h.value();
};

test('real Profile and AuthProvider save the current profile with its captured token', async () => {
  const h = await setup();
  const pending = h.startUpdate();
  assert.deepEqual(h.calls('updateProfile')[0].args, [{ name: 'Customer A edited', phone: userA.phone }, { token: 'token-a' }]);
  const updated = { ...userA, name: 'Customer A edited' };
  h.calls('updateProfile')[0].resolve(response({ ...updated, token: 'token-a' }));
  await pending;
  assertSession(h, updated, 'token-a');
  assert.match(text(h.renderProfile()), /Cập nhật thông tin thành công/);
});

test('late real Profile success after unmount, logout and login B cannot replace user or token B', async () => {
  const h = await setup();
  const pending = h.startUpdate();
  h.profile.unmount();
  h.value().logout();
  await loginAs(h);
  const writes = h.storageWrites.length;
  h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Late A', token: 'rotated-token-a' }));
  await pending;
  assertSession(h, userB, 'token-b');
  assert.equal(h.storageWrites.length, writes);
  assert.equal(h.profile.writesAfterUnmount, 0);
});

test('a late profile response cannot resurrect a logged-out session', async () => {
  const h = await setup();
  const pending = h.value().updateProfile({ name: 'Late A' });
  h.value().logout();
  const writes = h.storageWrites.length;
  h.calls('updateProfile')[0].resolve(response({ ...userA, token: 'token-a' }));
  assert.equal((await pending).stale, true);
  assertSession(h, null, null);
  assert.equal(h.storageWrites.length, writes);
});

test('logout and login to the same account with the same token still invalidates the old update', async () => {
  const h = await setup();
  const pending = h.value().updateProfile({ name: 'Late old-session A' });
  h.value().logout();
  await loginAs(h, userA, 'token-a');
  h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Late old-session A', token: 'token-a' }));
  assert.equal((await pending).stale, true);
  assertSession(h, userA, 'token-a');
});

test('real Profile password change accepts token rotation in the still-current session', async () => {
  const h = await setup();
  h.renderProfile();
  button(h.renderProfile(), 'Chỉnh sửa thông tin').props.onClick();
  button(h.renderProfile(), 'Đổi mật khẩu').props.onClick();
  h.setInput('currentPassword', 'old-password');
  h.setInput('newPassword', 'new-password');
  h.setInput('confirmPassword', 'new-password');
  const pending = nodes(h.renderProfile()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls('updateProfile')[0].args, [{ currentPassword: 'old-password', newPassword: 'new-password' }, { token: 'token-a' }]);
  h.calls('updateProfile')[0].resolve(response({ ...userA, token: 'rotated-token-a' }));
  await pending;
  assertSession(h, userA, 'rotated-token-a');
  assert.match(text(h.renderProfile()), /Đổi mật khẩu thành công/);
});

test('newer profile request wins when responses arrive in reverse order', async () => {
  const h = await setup();
  const older = h.value().updateProfile({ name: 'Older' });
  const newer = h.value().updateProfile({ name: 'Newer' });
  const updated = { ...userA, name: 'Newer' };
  h.calls('updateProfile')[1].resolve(response({ ...updated, token: 'token-a' }));
  assert.equal((await newer).success, true);
  h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Older', token: 'old-response-token' }));
  assert.equal((await older).stale, true);
  assertSession(h, updated, 'token-a');
});

test('an older response is ignored even when it arrives while the newer update is still pending', async () => {
  const h = await setup();
  const older = h.value().updateProfile({ name: 'Older' });
  const newer = h.value().updateProfile({ name: 'Newer' });
  h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Older', token: 'old-response-token' }));
  assert.equal((await older).stale, true);
  assertSession(h, userA, 'token-a');
  const updated = { ...userA, name: 'Newer' };
  h.calls('updateProfile')[1].resolve(response({ ...updated, token: 'token-a' }));
  assert.equal((await newer).success, true);
  assertSession(h, updated, 'token-a');
});

test('late Profile errors cannot contaminate the form or loading state for a different account', async () => {
  const h = await setup();
  const older = h.startUpdate();
  h.value().logout();
  await loginAs(h);
  h.renderProfile();
  button(h.renderProfile(), 'Chỉnh sửa thông tin').props.onClick();
  h.setInput('name', 'Customer B edited');
  const newer = nodes(h.renderProfile()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  h.calls('updateProfile')[0].reject(errorResponse('Private A failure'));
  await older;
  assert.equal(h.profile.hooks[2].value, true);
  assert.equal(h.profile.hooks[3].value, '');
  assert.equal(h.profile.hooks[4].value, '');
  h.calls('updateProfile')[1].resolve(response({ ...userB, name: 'Customer B edited', token: 'token-b' }));
  await newer;
  assert.equal(h.profile.hooks[2].value, false);
  assertSession(h, { ...userB, name: 'Customer B edited' }, 'token-b');
});

test('current Profile errors remain visible and preserve its session and editable form', async () => {
  const h = await setup();
  const pending = h.startUpdate();
  h.calls('updateProfile')[0].reject(errorResponse('Current update failed'));
  await pending;
  assertSession(h, userA, 'token-a');
  assert.match(text(h.renderProfile()), /Current update failed/);
  assert.equal(h.profile.hooks[0].value, true);
  assert.equal(h.profile.hooks[2].value, false);
});

test('provider unmount discards pending profile success and failure without any writes', async () => {
  for (const outcome of ['success', 'failure']) {
    const h = await setup();
    const pending = h.value().updateProfile({ name: 'Unmounted' });
    h.provider.unmount();
    const writes = h.storageWrites.length;
    if (outcome === 'success') h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Unmounted', token: 'new-token' }));
    else h.calls('updateProfile')[0].reject(errorResponse('Unmounted failure'));
    assert.equal((await pending).stale, true);
    assert.equal(h.storageWrites.length, writes);
    assert.equal(h.provider.writesAfterUnmount, 0);
  }
});

test('an account switch already in progress takes precedence over a pending profile response', async () => {
  const h = await setup();
  const profile = h.value().updateProfile({ name: 'Old A' });
  const login = h.value().login(userB.email, 'password');
  h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Old A', token: 'token-a' }));
  assert.equal((await profile).stale, true);
  h.calls('login')[0].resolve(response({ ...userB, token: 'token-b' }));
  assert.equal((await login).success, true);
  assertSession(h, userB, 'token-b');
});

test('external token replacement invalidates a pending profile update without replacing stored credentials', async () => {
  const h = await setup();
  const pending = h.value().updateProfile({ name: 'Old A' });
  localStorage.setItem('token', 'token-b');
  localStorage.setItem('user', JSON.stringify(userB));
  const writes = h.storageWrites.length;
  h.calls('updateProfile')[0].resolve(response({ ...userA, name: 'Old A', token: 'token-a' }));
  assert.equal((await pending).stale, true);
  assert.equal(h.storage.get('token'), 'token-b');
  assert.deepEqual(JSON.parse(h.storage.get('user')), userB);
  assert.equal(h.storageWrites.length, writes);
});

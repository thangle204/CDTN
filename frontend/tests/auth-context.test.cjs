const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

let AuthProvider;
const mockPlugin = {
  name: 'auth-provider-test-mocks',
  setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onResolve({ filter: /utils\/api(?:\.js)?$/ }, () => ({ path: 'api', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      if (args.path === 'react') return { contents: `
        export const createContext = () => ({ Provider: 'auth-provider' });
        export const useContext = () => globalThis.__authProviderTest.value();
        export const useState = initial => globalThis.__authProviderTest.state(initial);
        export const useRef = initial => globalThis.__authProviderTest.ref(initial);
        export const useEffect = (effect, dependencies) => globalThis.__authProviderTest.effect(effect, dependencies);
        export const useCallback = (callback, dependencies) => globalThis.__authProviderTest.memo(() => callback, dependencies);
        export const useMemo = (factory, dependencies) => globalThis.__authProviderTest.memo(factory, dependencies);
      ` };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;' };
      if (args.path === 'api') return { contents: 'export const authAPI = new Proxy({}, { get: (_, name) => (...args) => globalThis.__authProviderTest.request(name, args) }); export const customersAPI = authAPI;' };
    });
  },
};

before(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'context', 'AuthContext.jsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    plugins: [mockPlugin], logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  AuthProvider = module.exports.AuthProvider;
});

const sameDependencies = (left, right) => Array.isArray(left) && Array.isArray(right)
  && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => {
  // Flush the provider's await/catch/finally chain without timing or network dependencies.
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};
const userA = { _id: 'customer-a', name: 'Khách A', email: 'a@example.test', isAdmin: true };
const userB = { _id: 'customer-b', name: 'Khách B', email: 'b@example.test', isAdmin: false };
const userC = { _id: 'customer-c', name: 'Khách C', email: 'c@example.test', isAdmin: true };
const tokenA = 'token-a';
const tokenB = 'token-b';
const tokenC = 'token-c';
const response = data => ({ data });
const failure = status => ({ response: { status, data: { message: `Request failed: ${status}` } } });

const setup = ({ token = tokenA, storedUser = userA } = {}) => {
  const storage = new Map();
  if (token) storage.set('token', token);
  if (token && storedUser) storage.set('user', JSON.stringify(storedUser));
  const harness = {
    hooks: [], cursor: 0, pendingEffects: [], requests: [], storage, storageWrites: [], mounted: true,
    writesAfterUnmount: 0,
    state(initial) {
      const index = this.cursor++;
      if (!this.hooks[index]) this.hooks[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
      const slot = this.hooks[index];
      assert.equal(slot.kind, 'state');
      return [slot.value, next => {
        if (!this.mounted) this.writesAfterUnmount += 1;
        slot.value = typeof next === 'function' ? next(slot.value) : next;
      }];
    },
    ref(initial) {
      const index = this.cursor++;
      if (!this.hooks[index]) this.hooks[index] = { kind: 'ref', value: { current: initial } };
      assert.equal(this.hooks[index].kind, 'ref');
      return this.hooks[index].value;
    },
    memo(factory, dependencies) {
      const index = this.cursor++;
      const previous = this.hooks[index];
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        this.hooks[index] = { kind: 'memo', value: factory(), dependencies };
      }
      assert.equal(this.hooks[index].kind, 'memo');
      return this.hooks[index].value;
    },
    effect(create, dependencies) {
      const index = this.cursor++;
      const previous = this.hooks[index];
      if (!previous) this.hooks[index] = { kind: 'effect', create, dependencies, cleanup: undefined };
      else assert.equal(previous.kind, 'effect');
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        const slot = this.hooks[index];
        this.pendingEffects.push(() => {
          if (typeof slot.cleanup === 'function') slot.cleanup();
          slot.create = create;
          slot.dependencies = dependencies;
          slot.cleanup = create();
        });
      }
    },
    request(name, args) {
      const pending = deferred();
      this.requests.push({ name, args, ...pending });
      return pending.promise;
    },
    render() {
      assert.equal(this.mounted, true);
      this.cursor = 0;
      const tree = AuthProvider({ children: 'children' });
      this.currentValue = tree.props.value;
      const effects = this.pendingEffects.splice(0);
      effects.forEach(effect => effect());
      return this.currentValue;
    },
    value() { return this.render(); },
    calls(name) { return this.requests.filter(request => request.name === name); },
    strictReplay() {
      const effects = this.hooks.filter(slot => slot.kind === 'effect');
      effects.forEach(slot => { if (typeof slot.cleanup === 'function') slot.cleanup(); });
      effects.forEach(slot => { slot.cleanup = slot.create(); });
    },
    unmount() {
      this.hooks.filter(slot => slot.kind === 'effect').forEach(slot => {
        if (typeof slot.cleanup === 'function') slot.cleanup();
      });
      this.mounted = false;
    },
  };
  globalThis.__authProviderTest = harness;
  globalThis.localStorage = {
    getItem: key => storage.get(String(key)) ?? null,
    setItem: (key, value) => {
      harness.storageWrites.push({ operation: 'set', key: String(key), value: String(value) });
      storage.set(String(key), String(value));
    },
    removeItem: key => {
      harness.storageWrites.push({ operation: 'remove', key: String(key) });
      storage.delete(String(key));
    },
  };
  harness.render();
  return harness;
};

const assertSession = (h, profile, token) => {
  const value = h.value();
  assert.deepEqual(value.user, profile);
  assert.equal(value.isAdmin, profile?.isAdmin === true);
  assert.equal(h.storage.get('token') ?? null, token);
  assert.deepEqual(h.storage.has('user') ? JSON.parse(h.storage.get('user')) : null, profile);
};
const loginAs = async (h, profile = userB, token = tokenB) => {
  const result = h.value().login(profile.email, 'password');
  h.calls('login').at(-1).resolve(response({ ...profile, token }));
  assert.equal((await result).success, true);
  await settle();
};

test('startup without a stored token finishes loading without requesting a profile', async () => {
  const h = setup({ token: null });
  await settle();
  assert.equal(h.calls('getProfile').length, 0);
  assertSession(h, null, null);
  assert.equal(h.value().loading, false);
});

test('current restoration stores the profile and derives administrator status', async () => {
  const h = setup();
  assert.equal(h.value().loading, true);
  assert.equal(h.calls('getProfile').length, 1);
  h.calls('getProfile')[0].resolve(response(userA));
  await settle();
  assertSession(h, userA, tokenA);
  assert.equal(h.value().loading, false);
});

test('current 401 and 403 restoration failures clear the session and finish loading', async () => {
  for (const status of [401, 403]) {
    const h = setup();
    h.calls('getProfile')[0].reject(failure(status));
    await settle();
    assertSession(h, null, null);
    assert.equal(h.value().loading, false);
  }
});

test('a transient restoration failure keeps stored credentials and finishes loading', async () => {
  const h = setup();
  h.calls('getProfile')[0].reject(failure(503));
  await settle();
  assert.equal(h.value().user, null);
  assert.equal(h.storage.get('token'), tokenA);
  assert.deepEqual(JSON.parse(h.storage.get('user')), userA);
  assert.equal(h.value().loading, false);
});

test('late profile A success cannot overwrite a successful login B or its permissions', async () => {
  const h = setup();
  const restoring = h.calls('getProfile')[0];
  await loginAs(h);
  assertSession(h, userB, tokenB);
  assert.equal(h.value().loading, false);
  const writes = h.storageWrites.length;
  restoring.resolve(response(userA));
  await settle();
  assertSession(h, userB, tokenB);
  assert.equal(h.storageWrites.length, writes);
  assert.equal(h.value().loading, false);
});

test('late 401 and 403 from profile A cannot log out the newly logged-in B', async () => {
  for (const status of [401, 403]) {
    const h = setup();
    const restoring = h.calls('getProfile')[0];
    await loginAs(h);
    const writes = h.storageWrites.length;
    restoring.reject(failure(status));
    await settle();
    assertSession(h, userB, tokenB);
    assert.equal(h.storageWrites.length, writes);
    assert.equal(h.value().loading, false);
  }
});

test('logout during restoration finishes loading and late success cannot restore the session', async () => {
  const h = setup();
  h.value().logout();
  assertSession(h, null, null);
  assert.equal(h.value().loading, false);
  const writes = h.storageWrites.length;
  h.calls('getProfile')[0].resolve(response(userA));
  await settle();
  assertSession(h, null, null);
  assert.equal(h.storageWrites.length, writes);
});

test('late restoration rejection after logout leaves the cleared session unchanged', async () => {
  for (const status of [401, 403]) {
    const h = setup();
    h.value().logout();
    assert.equal(h.value().loading, false);
    const writes = h.storageWrites.length;
    h.calls('getProfile')[0].reject(failure(status));
    await settle();
    assertSession(h, null, null);
    assert.equal(h.storageWrites.length, writes);
  }
});

test('explicit updateUser invalidates a pending restoration even when the token stays the same', async () => {
  const h = setup();
  const updated = { ...userA, name: 'Tên A vừa chỉnh sửa', isAdmin: false };
  h.value().updateUser(updated);
  assertSession(h, updated, tokenA);
  assert.equal(h.value().loading, false);
  const writes = h.storageWrites.length;
  h.calls('getProfile')[0].resolve(response(userA));
  await settle();
  assertSession(h, updated, tokenA);
  assert.equal(h.storageWrites.length, writes);
});

test('login completed after an explicit logout cannot sign the user back in', async () => {
  const h = setup({ token: null });
  const result = h.value().login(userB.email, 'password');
  h.value().logout();
  const writes = h.storageWrites.length;
  h.calls('login')[0].resolve(response({ ...userB, token: tokenB }));
  assert.equal((await result).success, false);
  await settle();
  assertSession(h, null, null);
  assert.equal(h.storageWrites.length, writes);
  assert.equal(h.value().loading, false);
});

test('login rejection after logout cannot restart restoration of the previous token', async () => {
  const h = setup();
  const result = h.value().login(userB.email, 'wrong-password');
  h.value().logout();
  const writes = h.storageWrites.length;
  h.calls('login')[0].reject(failure(401));
  assert.equal((await result).success, false);
  await settle();
  assertSession(h, null, null);
  assert.equal(h.value().loading, false);
  assert.equal(h.calls('getProfile').length, 1);
  assert.equal(h.storageWrites.length, writes);
  h.calls('getProfile')[0].resolve(response(userA));
  await settle();
  assertSession(h, null, null);
});

test('a newer login attempt wins when the older response arrives last', async () => {
  const h = setup({ token: null });
  const older = h.value().login(userB.email, 'password');
  const newer = h.value().login(userC.email, 'password');
  h.calls('login')[1].resolve(response({ ...userC, token: tokenC }));
  assert.equal((await newer).success, true);
  h.calls('login')[0].resolve(response({ ...userB, token: tokenB }));
  assert.equal((await older).success, false);
  await settle();
  assertSession(h, userC, tokenC);
});

test('profile restoration completing while login is pending does not cancel the explicit login', async () => {
  const h = setup();
  const result = h.value().login(userB.email, 'password');
  h.calls('getProfile')[0].resolve(response(userA));
  await settle();
  h.calls('login')[0].resolve(response({ ...userB, token: tokenB }));
  assert.equal((await result).success, true);
  await settle();
  assertSession(h, userB, tokenB);
  assert.equal(h.value().loading, false);
});

test('an expired restoration token does not cancel a newer explicit login awaiting its response', async () => {
  for (const status of [401, 403]) {
    const h = setup();
    const result = h.value().login(userB.email, 'password');
    h.calls('getProfile')[0].reject(failure(status));
    await settle();
    h.calls('login')[0].resolve(response({ ...userB, token: tokenB }));
    assert.equal((await result).success, true);
    await settle();
    assertSession(h, userB, tokenB);
    assert.equal(h.value().loading, false);
  }
});

test('unmount discards profile success and failures without storage or state writes', async () => {
  for (const outcome of ['success', 401, 403]) {
    const h = setup();
    h.unmount();
    const writes = h.storageWrites.length;
    if (outcome === 'success') h.calls('getProfile')[0].resolve(response(userA));
    else h.calls('getProfile')[0].reject(failure(outcome));
    await settle();
    assert.equal(h.storageWrites.length, writes);
    assert.equal(h.writesAfterUnmount, 0);
    assert.equal(h.storage.get('token'), tokenA);
  }
});

test('unmount discards an in-flight login without storage or state writes', async () => {
  const h = setup({ token: null });
  const result = h.value().login(userB.email, 'password');
  h.unmount();
  const writes = h.storageWrites.length;
  h.calls('login')[0].resolve(response({ ...userB, token: tokenB }));
  assert.equal((await result).success, false);
  await settle();
  assert.equal(h.storageWrites.length, writes);
  assert.equal(h.writesAfterUnmount, 0);
  assert.equal(h.storage.has('token'), false);
});

test('StrictMode cleanup and setup ignore the discarded profile response and finish the live restore', async () => {
  const h = setup();
  const discarded = h.calls('getProfile')[0];
  h.strictReplay();
  assert.equal(h.calls('getProfile').length, 2);
  discarded.resolve(response({ ...userA, name: 'Discarded profile' }));
  await settle();
  assert.equal(h.value().user, null);
  assert.equal(h.value().loading, true);
  assert.equal(h.storageWrites.length, 0);
  h.calls('getProfile')[1].resolve(response(userA));
  await settle();
  assertSession(h, userA, tokenA);
  assert.equal(h.value().loading, false);
});

test('a discarded StrictMode auth rejection cannot clear the active restoration token', async () => {
  for (const status of [401, 403]) {
    const h = setup();
    const discarded = h.calls('getProfile')[0];
    h.strictReplay();
    discarded.reject(failure(status));
    await settle();
    assert.equal(h.storage.get('token'), tokenA);
    assert.equal(h.value().loading, true);
    assert.equal(h.storageWrites.length, 0);
    h.calls('getProfile')[1].resolve(response(userA));
    await settle();
    assertSession(h, userA, tokenA);
    assert.equal(h.value().loading, false);
  }
});

test('a token changed outside the provider makes the old profile response stale', async () => {
  for (const outcome of ['success', 401, 403]) {
    const h = setup();
    localStorage.setItem('token', tokenB);
    localStorage.setItem('user', JSON.stringify(userB));
    const writes = h.storageWrites.length;
    if (outcome === 'success') h.calls('getProfile')[0].resolve(response(userA));
    else h.calls('getProfile')[0].reject(failure(outcome));
    await settle();
    assert.equal(h.value().user, null);
    assert.equal(h.storage.get('token'), tokenB);
    assert.deepEqual(JSON.parse(h.storage.get('user')), userB);
    assert.equal(h.storageWrites.length, writes);
    assert.equal(h.value().loading, false);
  }
});

test('a failed explicit login reports its message without changing the stored session', async () => {
  const h = setup({ token: null });
  const result = h.value().login(userB.email, 'wrong-password');
  h.calls('login')[0].reject(failure(401));
  const returned = await result;
  assert.equal(returned.success, false);
  assert.equal(returned.message, 'Request failed: 401');
  assertSession(h, null, null);
  assert.equal(h.value().loading, false);
});

test('a failed latest login with an existing token restarts guarded restoration of that session', async () => {
  const h = setup();
  const discarded = h.calls('getProfile')[0];
  const result = h.value().login(userB.email, 'wrong-password');
  assert.equal(h.value().loading, false);
  h.calls('login')[0].reject(failure(401));
  const returned = await result;
  assert.equal(returned.success, false);
  assert.equal(returned.message, 'Request failed: 401');
  await settle();
  assert.equal(h.calls('getProfile').length, 2);
  assert.equal(h.value().loading, true);
  discarded.resolve(response({ ...userA, name: 'Discarded original restore' }));
  await settle();
  assert.equal(h.value().user, null);
  assert.equal(h.value().loading, true);
  h.calls('getProfile')[1].resolve(response(userA));
  await settle();
  assertSession(h, userA, tokenA);
  assert.equal(h.value().loading, false);
});

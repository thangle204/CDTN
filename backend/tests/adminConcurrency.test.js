import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdminGuard from '../models/adminGuardModel.js';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import { toggleCustomerActive, toggleCustomerAdmin } from '../controllers/customerController.js';
import { ADMIN_ROLE_GUARD_ID, withAdminRoleGuard } from '../utils/adminGuard.js';

// All persistence is replaced with local document snapshots and atomic stubs.
// No connection string, real database or persistent account is used here.
const firstId = '000000000000000000000001';
const secondId = '000000000000000000000002';
const staffId = '000000000000000000000003';
const account = (_id, overrides = {}) => ({ _id, name: _id, isAdmin: true, isActive: true, authVersion: 0, ...overrides });
const request = (caller, target, accountType = 'customer') => ({
  user: { ...caller }, params: { id: target }, accountType, body: {},
});
const response = () => ({ body: undefined, json(body) { this.body = body; return this; } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

const installGuard = (t, initialOwner = null) => {
  const state = { owner: initialOwner, claims: [], releases: [] };
  t.mock.method(AdminGuard, 'findOneAndUpdate', async (filter, update, options) => {
    state.claims.push({ filter, update, options });
    assert.deepEqual(filter, { _id: ADMIN_ROLE_GUARD_ID, token: null });
    assert.deepEqual(options, { upsert: true, new: true });
    assert.ok(update.$set.startedAt instanceof Date);
    if (state.owner !== null) throw Object.assign(new Error('Duplicate singleton key'), { code: 11000 });
    state.owner = update.$set.token;
    return { _id: ADMIN_ROLE_GUARD_ID, ...update.$set };
  });
  t.mock.method(AdminGuard, 'updateOne', async (filter, update) => {
    state.releases.push({ filter, update });
    assert.equal(filter._id, ADMIN_ROLE_GUARD_ID);
    assert.deepEqual(update, { $set: { token: null, startedAt: null } });
    if (state.owner !== filter.token) return { matchedCount: 0 };
    state.owner = null;
    return { matchedCount: 1 };
  });
  return state;
};

const installAccounts = (t, customerRows, staffRows = []) => {
  const customers = new Map(customerRows.map(row => [row._id, { ...row }]));
  const staff = new Map(staffRows.map(row => [row._id, { ...row }]));
  const snapshot = (rows, id) => {
    const row = rows.get(String(id));
    if (!row) return null;
    const copy = { ...row };
    copy.save = async () => {
      const { save, ...stored } = copy;
      rows.set(copy._id, stored);
      return copy;
    };
    return copy;
  };
  t.mock.method(Customer, 'findById', async id => snapshot(customers, id));
  t.mock.method(Staff, 'findById', async id => snapshot(staff, id));
  const count = rows => [...rows.values()].filter(row => row.isAdmin && row.isActive !== false).length;
  t.mock.method(Customer, 'countDocuments', async filter => {
    assert.deepEqual(filter, { isAdmin: true, isActive: { $ne: false } });
    return count(customers);
  });
  t.mock.method(Staff, 'countDocuments', async filter => {
    assert.deepEqual(filter, { isAdmin: true, isActive: { $ne: false } });
    return count(staff);
  });
  return { customers, staff, activeAdmins: () => count(customers) + count(staff) };
};

test('two administrators demoting each other cannot both pass the shared database guard', async (t) => {
  const first = account(firstId);
  const second = account(secondId);
  const state = installGuard(t);
  const rows = installAccounts(t, [first, second]);
  const counting = deferred();
  const continueCount = deferred();
  t.mock.method(Customer, 'countDocuments', async () => {
    counting.resolve();
    await continueCount.promise;
    return rows.activeAdmins();
  });

  const firstResponse = response();
  const demoteSecond = toggleCustomerAdmin(request(first, secondId), firstResponse);
  await counting.promise;
  const secondResponse = response();
  await assert.rejects(toggleCustomerAdmin(request(second, firstId), secondResponse), error => error.status === 409);
  assert.equal(secondResponse.body, undefined);
  continueCount.resolve();
  await demoteSecond;
  assert.equal(firstResponse.body.isAdmin, false);
  assert.equal(rows.activeAdmins(), 1);
  assert.equal(rows.customers.get(firstId).isAdmin, true);
  assert.equal(rows.customers.get(secondId).authVersion, 1);
  assert.equal(state.owner, null);

  // The second request may already have passed protect/admin before the first
  // request finished. Retrying that stale snapshot must refresh authorization.
  await assert.rejects(toggleCustomerAdmin(request(second, firstId), response()), error => error.status === 401);
  assert.equal(rows.activeAdmins(), 1);
  assert.equal(state.owner, null);
});

test('Customer and Staff active administrators are counted under the same guard', async (t) => {
  const customer = account(firstId);
  const staffAdmin = account(staffId);
  const state = installGuard(t);
  const rows = installAccounts(t, [customer], [staffAdmin, account('inactive-staff', { isActive: false })]);
  const result = response();
  await toggleCustomerAdmin(request(staffAdmin, firstId, 'staff'), result);
  assert.equal(result.body.isAdmin, false);
  assert.equal(rows.customers.get(firstId).authVersion, 1);
  assert.equal(rows.activeAdmins(), 1);
  assert.equal(rows.staff.get(staffId).isAdmin, true);
  assert.equal(state.owner, null);
});

test('last administrator, self-demotion and inactive promotion failures release the guard', async (t) => {
  const caller = account(firstId);
  const target = account(secondId);
  const state = installGuard(t);
  const rows = installAccounts(t, [caller, target]);
  t.mock.method(Customer, 'countDocuments', async () => 1);
  await assert.rejects(toggleCustomerAdmin(request(caller, secondId), response()), error => error.status === 400);
  assert.equal(rows.customers.get(secondId).isAdmin, true);
  assert.equal(state.owner, null);
  await assert.rejects(toggleCustomerAdmin(request(caller, firstId), response()), error => error.status === 400);
  assert.equal(state.owner, null);
  rows.customers.set(secondId, account(secondId, { isAdmin: false, isActive: false }));
  await assert.rejects(toggleCustomerAdmin(request(caller, secondId), response()), error => error.status === 400);
  assert.equal(state.owner, null);
  assert.equal(state.releases.length, 3);
});

test('guard refreshes revoked, inactive and non-admin callers before executing any role mutation', async (t) => {
  const caller = account(firstId);
  const state = installGuard(t);
  const rows = installAccounts(t, [caller]);
  let operations = 0;
  for (const [overrides, expectedStatus] of [
    [{ authVersion: 1 }, 401], [{ isActive: false }, 401], [{ isAdmin: false }, 403],
  ]) {
    rows.customers.set(firstId, { ...caller, ...overrides });
    await assert.rejects(withAdminRoleGuard(request(caller, secondId), async () => { operations++; }), error => error.status === expectedStatus);
    assert.equal(state.owner, null);
  }
  assert.equal(operations, 0);
});

test('busy guard claims never enter the operation or release another request owner', async (t) => {
  const state = installGuard(t, 'existing-owner');
  const lookup = t.mock.method(Customer, 'findById', () => { throw new Error('No account lookup allowed'); });
  let operations = 0;
  await assert.rejects(withAdminRoleGuard(request(account(firstId), secondId), async () => { operations++; }), error => error.status === 409);
  assert.equal(operations, 0);
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(state.owner, 'existing-owner');
  assert.equal(state.releases.length, 0);
});

test('failed role writes release only the owned guard and preserve the original failure', async (t) => {
  const caller = account(firstId);
  const state = installGuard(t);
  installAccounts(t, [caller]);
  const failure = new Error('Mocked write failed');
  await assert.rejects(withAdminRoleGuard(request(caller, secondId), async () => { throw failure; }), error => error === failure);
  assert.equal(state.owner, null);
  assert.equal(state.releases[0].filter.token, state.claims[0].update.$set.token);
  assert.equal(typeof state.releases[0].filter.token, 'string');
});

test('a release cannot clear a guard belonging to a different owner', async (t) => {
  const caller = account(firstId);
  const state = installGuard(t);
  installAccounts(t, [caller]);
  await assert.rejects(withAdminRoleGuard(request(caller, secondId), async () => { state.owner = 'another-owner'; }), error => error.status === 503);
  assert.equal(state.owner, 'another-owner');
  assert.notEqual(state.releases[0].filter.token, 'another-owner');
});

test('a failed guard release returns unavailable before the controller sends success', async (t) => {
  const caller = account(firstId);
  installGuard(t);
  const rows = installAccounts(t, [caller, account(secondId, { isAdmin: false })]);
  t.mock.method(AdminGuard, 'updateOne', async () => { throw new Error('Mocked connection loss'); });
  const result = response();
  await assert.rejects(toggleCustomerAdmin(request(caller, secondId), result), error => error.status === 503);
  assert.equal(result.body, undefined);
  assert.equal(rows.customers.get(secondId).isAdmin, true);
});

test('promotion and deactivation share the same guard and cannot produce an inactive administrator', async (t) => {
  const caller = account(firstId);
  const target = account(secondId, { isAdmin: false });
  const state = installGuard(t);
  const rows = installAccounts(t, [caller, target]);
  const writing = deferred();
  const continueWrite = deferred();
  t.mock.method(Customer, 'findById', async id => {
    const row = rows.customers.get(String(id));
    if (!row) return null;
    const copy = { ...row };
    copy.save = async () => {
      writing.resolve();
      await continueWrite.promise;
      const { save, ...stored } = copy;
      rows.customers.set(copy._id, stored);
      return copy;
    };
    return copy;
  });
  const promotion = toggleCustomerAdmin(request(caller, secondId), response());
  await writing.promise;
  await assert.rejects(toggleCustomerActive(request(caller, secondId), response()), error => error.status === 409);
  continueWrite.resolve();
  await promotion;
  await assert.rejects(toggleCustomerActive(request(caller, secondId), response()), error => error.status === 400);
  assert.equal(rows.customers.get(secondId).isAdmin, true);
  assert.equal(rows.customers.get(secondId).isActive, true);
  assert.equal(state.owner, null);
});

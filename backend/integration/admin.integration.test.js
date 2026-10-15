import { test } from 'node:test';
import assert from 'node:assert/strict';
import Customer from '../models/customerModel.js';
import Staff from '../models/staffModel.js';
import AdminGuard from '../models/adminGuardModel.js';
import { ADMIN_ROLE_GUARD_ID } from '../utils/adminGuard.js';
import { setupIntegration } from './setup.js';

const activeAdminCount = async () => {
  const counts = await Promise.all([
    Customer.countDocuments({ isAdmin: true, isActive: { $ne: false } }),
    Staff.countDocuments({ isAdmin: true, isActive: { $ne: false } }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
};

const assertGuardReleased = async () => {
  const guard = await AdminGuard.findById(ADMIN_ROLE_GUARD_ID).lean();
  assert.ok(guard, 'Role changes persist the shared database guard');
  assert.equal(guard.token, null, 'The persisted guard owner must be cleared');
  assert.equal(guard.startedAt, null);
};

test('administrator invariants through HTTP and real MongoDB', { timeout: 180000 }, async (t) => {
  const { request, createCustomer, createStaff, login, loginStaff } = await setupIntegration(t);
  const clearFixtures = async () => {
    // setupIntegration has already selected and marked this run's disposable
    // database. Only synthetic accounts and guards in that database are reset.
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), AdminGuard.deleteMany({})]);
  };

  await t.test('simultaneous mutual demotion leaves one administrator and rejects stale retry', async () => {
    await clearFixtures();
    const [first, second] = await Promise.all([
      createCustomer({ name: 'Integration Admin A', isAdmin: true }),
      createCustomer({ name: 'Integration Admin B', isAdmin: true }),
    ]);
    const [firstToken, secondToken] = await Promise.all([login(first), login(second)]);
    const responses = await Promise.all([
      request('PUT', `/api/customers/${second._id}/toggle-admin`, { token: firstToken }),
      request('PUT', `/api/customers/${first._id}/toggle-admin`, { token: secondToken }),
    ]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.ok(responses.every((response) => [200, 401, 409].includes(response.status)));
    assert.equal(await activeAdminCount(), 1);
    await assertGuardReleased();

    const [currentFirst, currentSecond] = await Promise.all([
      Customer.findById(first._id).lean(), Customer.findById(second._id).lean(),
    ]);
    const winner = currentFirst.isAdmin ? currentFirst : currentSecond;
    const loser = currentFirst.isAdmin ? currentSecond : currentFirst;
    const winnerToken = currentFirst.isAdmin ? firstToken : secondToken;
    const loserToken = currentFirst.isAdmin ? secondToken : firstToken;
    assert.equal(loser.authVersion, 1);
    assert.equal(winner.authVersion, 0);

    const stale = await request('PUT', `/api/customers/${winner._id}/toggle-admin`, { token: loserToken });
    assert.equal(stale.status, 401, 'Demotion revokes the former administrator session');
    assert.equal(await activeAdminCount(), 1);

    const selfDemotion = await request('PUT', `/api/customers/${winner._id}/toggle-admin`, { token: winnerToken });
    assert.equal(selfDemotion.status, 400, 'The last administrator cannot demote their own account');
    assert.equal(await activeAdminCount(), 1);
    await assertGuardReleased();

    const ordinaryToken = await login(loser);
    const unauthorized = await request('PUT', `/api/customers/${winner._id}/toggle-admin`, { token: ordinaryToken });
    assert.equal(unauthorized.status, 403, 'Logging in again does not restore removed administrator privileges');
    assert.equal(await activeAdminCount(), 1);
  });

  await t.test('Customer and Staff administrators participate in the same persisted invariant', async () => {
    await clearFixtures();
    const [customerAdmin, staffAdmin] = await Promise.all([
      createCustomer({ isAdmin: true }),
      createStaff({ name: 'Integration Staff Admin', isAdmin: true }),
    ]);
    await createStaff({ isAdmin: true, isActive: false });
    const staffToken = await loginStaff(staffAdmin);
    assert.equal(await activeAdminCount(), 2);

    const demote = await request('PUT', `/api/customers/${customerAdmin._id}/toggle-admin`, { token: staffToken });
    assert.equal(demote.status, 200, 'An active Staff administrator satisfies the remaining-admin condition');
    assert.equal(demote.body.isAdmin, false);
    assert.equal(await activeAdminCount(), 1);
    assert.equal((await Customer.findById(customerAdmin._id)).authVersion, 1);
    await assertGuardReleased();

    const inactiveCustomer = await createCustomer({ isActive: false, isAdmin: false });
    const promoteInactive = await request('PUT', `/api/customers/${inactiveCustomer._id}/toggle-admin`, { token: staffToken });
    assert.equal(promoteInactive.status, 400);
    assert.equal((await Customer.findById(inactiveCustomer._id)).isAdmin, false);
    assert.equal(await activeAdminCount(), 1);
    await assertGuardReleased();
  });

  await t.test('an occupied persisted guard rejects changes and never releases another owner', async () => {
    await clearFixtures();
    const [caller, target] = await Promise.all([
      createCustomer({ isAdmin: true }), createCustomer({ isAdmin: true }),
    ]);
    const token = await login(caller);
    const ownerToken = 'integration-existing-owner';
    await AdminGuard.create({ _id: ADMIN_ROLE_GUARD_ID, token: ownerToken, startedAt: new Date() });
    const response = await request('PUT', `/api/customers/${target._id}/toggle-admin`, { token });
    assert.equal(response.status, 409);
    assert.equal((await AdminGuard.findById(ADMIN_ROLE_GUARD_ID)).token, ownerToken);
    assert.equal((await Customer.findById(target._id)).isAdmin, true);
    assert.equal(await activeAdminCount(), 2);

    await AdminGuard.updateOne({ _id: ADMIN_ROLE_GUARD_ID, token: ownerToken }, { $set: { token: null, startedAt: null } });
    const retry = await request('PUT', `/api/customers/${target._id}/toggle-admin`, { token });
    assert.equal(retry.status, 200);
    assert.equal(await activeAdminCount(), 1);
    await assertGuardReleased();
  });

  await t.test('concurrent promotion and deactivation cannot create an inactive administrator', async () => {
    await clearFixtures();
    const [caller, target] = await Promise.all([
      createCustomer({ isAdmin: true }), createCustomer({ isAdmin: false }),
    ]);
    const token = await login(caller);
    const responses = await Promise.all([
      request('PUT', `/api/customers/${target._id}/toggle-admin`, { token }),
      request('PUT', `/api/customers/${target._id}/toggle-active`, { token }),
    ]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.ok(responses.every((response) => [200, 400, 409].includes(response.status)));
    const stored = await Customer.findById(target._id).lean();
    assert.equal(stored.isAdmin && stored.isActive === false, false);
    assert.ok(await activeAdminCount() >= 1);
    await assertGuardReleased();
  });
});

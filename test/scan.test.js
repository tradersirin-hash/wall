import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSeeIds, wallTiers } from '../src/engine/index.js';
import { JiraError, createJira, path } from '../src/server/jira.js';
import { compareWithJiraBrowse, scanProjects } from '../src/server/scan.js';
import { fakeJira } from './fixtures/rest.js';

const takenAt = '2026-11-23T09:00:00.000Z';

test('paths encode every interpolated value', () => {
  assert.equal(path`/rest/api/3/project/${'A B'}/role/${10}?q=${'x&y'}`, '/rest/api/3/project/A%20B/role/10?q=x%26y');
});

test('a scan builds a snapshot the engine can use', async () => {
  const fake = fakeJira();
  const snapshot = await scanProjects(createJira(fake.request), { projectKeys: ['FALCON'], takenAt, extraAccountIds: ['u-wall'] });
  assert.deepEqual(snapshot.problems, []);
  assert.deepEqual(snapshot.projects[0].roleActors, {
    10002: { userIds: ['u-eli', 'u-wall'], groupIds: [] },
    10100: { userIds: ['u-bea', 'u-gus'], groupIds: ['g-advisers'] },
  });
  const deal = snapshot.groups.find((g) => g.groupId === 'g-deal');
  assert.deepEqual(deal.memberIds, ['u-fay', 'u-gus', 'u-hal'], 'both pages of members are read');
  assert.equal(deal.complete, true);
  assert.deepEqual(snapshot.roles.map((r) => `${r.id}:${r.name}`), ['10001:Developers', '10002:Administrators', '10100:Walled']);
  assert.equal(snapshot.users.find((u) => u.accountId === 'u-hal').active, false);
  assert.equal(snapshot.users.find((u) => u.accountId === 'u-wall').accountType, 'app');
  assert.deepEqual(snapshot.globalChecks.filter((c) => c.has).map((c) => c.accountId), ['u-ada'], 'found through an admin-named group');
  assert.deepEqual(snapshot.adminCheck, { checked: 8, complete: true });
  assert.ok(!fake.calls.some((c) => c.includes('/role/10001')), 'roles that grant neither Browse nor Administer projects are not read');

  const tiers = wallTiers(snapshot, 'FALCON');
  assert.deepEqual(canSeeIds(tiers), ['u-bea', 'u-dan', 'u-eli', 'u-fay', 'u-gus', 'u-hal', 'u-wall']);
  assert.deepEqual(tiers.selfAdmit, ['u-ada']);
  assert.ok(tiers.canChange.some((p) => p.accountId === 'u-wall'), "Wall's own account can change who sees");
});

test("Jira's own Browse list confirms the model or shows the difference", async () => {
  const snapshot = await scanProjects(createJira(fakeJira().request), { projectKeys: ['FALCON'], takenAt });
  const result = compareWithJiraBrowse(wallTiers(snapshot, 'FALCON'), snapshot);
  assert.equal(result.available, true);
  assert.deepEqual(result.onlyInModel, ['u-hal'], 'Jira leaves inactive accounts out');
  assert.deepEqual(result.onlyInJira, []);
});

test('team-managed projects are recorded but not read further', async () => {
  const fake = fakeJira();
  const snapshot = await scanProjects(createJira(fake.request), { projectKeys: ['TEAM'], takenAt });
  assert.equal(snapshot.projects[0].style, 'next-gen');
  assert.equal(wallTiers(snapshot, 'TEAM').analysable, false);
  assert.ok(!fake.calls.some((c) => c.includes('permissionscheme')), 'no scheme is read for a team-managed project');
});

test('a failing read is reported as a problem, not hidden', async () => {
  const fake = fakeJira({ failures: { 'GET /rest/api/3/group/member?groupId=g-advisers&includeInactiveUsers=true&startAt=0&maxResults=50': 403 } });
  const snapshot = await scanProjects(createJira(fake.request), { projectKeys: ['FALCON'], takenAt });
  assert.deepEqual(snapshot.problems, [{ what: 'group falcon-advisers', status: 403 }]);
  assert.equal(snapshot.groups.find((g) => g.groupId === 'g-advisers').complete, false);
});

test('a missing project fails the scan with the status', async () => {
  await assert.rejects(
    scanProjects(createJira(fakeJira().request), { projectKeys: ['NOPE'], takenAt }),
    (error) => error instanceof JiraError && error.status === 404,
  );
});

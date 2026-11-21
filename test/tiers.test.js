import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Evidence, Power, canSeeIds, describeRoute, routeKey, unanalysableProjects, wallTiers } from '../src/engine/index.js';
import { ROLE, acmeSite } from './fixtures/sites.js';

const site = acmeSite();

test('tier 1 lists everyone who can browse the walled project, by every route', () => {
  const tiers = wallTiers(site, 'FALCON');
  assert.equal(tiers.analysable, true);
  assert.deepEqual(canSeeIds(tiers), ['u-bea', 'u-cem', 'u-dan', 'u-eli', 'u-fay', 'u-gus', 'u-hal', 'u-wall']);
  const by = Object.fromEntries(tiers.canSee.map((p) => [p.accountId, p]));
  assert.deepEqual(by['u-dan'].routes, [{ kind: 'role-group', roleId: ROLE.WALLED, roleName: 'Walled', groupId: 'g-advisers', groupName: 'falcon-advisers' }]);
  assert.deepEqual(by['u-gus'].routes.map(routeKey), ['group:g-deal', `role:${ROLE.WALLED}`]);
  assert.deepEqual(by['u-eli'].routes.map(routeKey), ['lead', `role:${ROLE.ADMINISTRATORS}`]);
  assert.equal(by['u-hal'].active, false);
  assert.equal(by['u-wall'].accountType, 'app');
  assert.equal(by['u-bea'].evidence, Evidence.PROVEN_STATIC);
  assert.equal(tiers.counts.canSeeInactive, 1);
  assert.equal(tiers.counts.canSeeApps, 1);
});

test('tier 2 names who can change who sees, and how', () => {
  const tiers = wallTiers(site, 'FALCON');
  const by = Object.fromEntries(tiers.canChange.map((p) => [p.principal, p]));
  assert.deepEqual(Object.keys(by).sort(), ['class:group-admins', 'class:org-admins', 'user:u-ada', 'user:u-eli', 'user:u-ivo', 'user:u-wall']);
  assert.deepEqual(by['user:u-ada'].powers.map((p) => p.power), [Power.EDIT_SCHEME]);
  assert.equal(by['user:u-ada'].evidence, Evidence.PROVEN_STATIC);
  assert.equal(by['user:u-ivo'].evidence, Evidence.CONFIRMED_BY_JIRA, 'Ivo is known only from the permission check');
  assert.deepEqual(by['user:u-eli'].powers.map((p) => p.power), [Power.EDIT_ROLE_MEMBERS]);
  assert.deepEqual(
    by['user:u-eli'].powers[0].roles.map((r) => r.roleName),
    ['Administrators', 'Walled', 'Wall Keeper'],
  );
  assert.deepEqual(by['class:group-admins'].powers[0].groups.map((g) => g.groupName), ['falcon-advisers', 'falcon-deal-team']);
  assert.equal(by['class:group-admins'].evidence, Evidence.UNKNOWN);
  assert.equal(by['class:org-admins'].powers[0].power, Power.GRANT_SELF_ADMIN);
  assert.equal(by['user:u-eli'].canSee, true);
  assert.equal(by['user:u-ada'].canSee, false);
});

test('admins who cannot see the project yet could admit themselves', () => {
  const tiers = wallTiers(site, 'FALCON');
  assert.deepEqual(tiers.selfAdmit.sort(), ['u-ada', 'u-ivo']);
  assert.equal(tiers.counts.selfAdmit, 2);
});

test('a shared permission scheme is flagged', () => {
  assert.deepEqual(wallTiers(site, 'FALCON').sharedScheme, ['ARCHIVE']);
  assert.deepEqual(wallTiers(site, 'ARCHIVE').sharedScheme, ['FALCON']);
});

test('a project that lets classes of people in is not sealed', () => {
  const tiers = wallTiers(site, 'LEAK');
  assert.equal(tiers.sealed, false);
  assert.deepEqual(
    tiers.openings.map((o) => `${o.tier}:${o.principal}`).sort(),
    ['can-change:class:app-role:jira-software', 'can-see:class:anyone', 'can-see:class:logged-in'],
  );
  assert.deepEqual(tiers.conditional.map((c) => c.principal), ['cond:reporter']);
  assert.deepEqual(canSeeIds(tiers), ['u-bea']);
  // No role grants Browse, so project admins cannot change who sees; no group grants Browse either.
  assert.deepEqual(tiers.canChange.map((p) => p.principal).sort(), ['class:org-admins', 'user:u-ada', 'user:u-ivo']);
});

test('FALCON is sealed and team-managed projects are reported, not analysed', () => {
  assert.equal(wallTiers(site, 'FALCON').sealed, true);
  const team = wallTiers(site, 'TEAM');
  assert.equal(team.analysable, false);
  assert.match(team.reason, /Team-managed/);
  assert.deepEqual(unanalysableProjects(site).map((p) => p.key), ['TEAM']);
  assert.equal(wallTiers(site, 'NOPE').found, false);
});

test('projects can be looked up by id as well as key', () => {
  assert.equal(wallTiers(site, '10400').project.key, 'FALCON');
});

test('routes read as plain phrases', () => {
  assert.equal(
    describeRoute({ kind: 'role-group', roleId: '1', roleName: 'Walled', groupId: 'g', groupName: 'falcon-advisers' }),
    'group "falcon-advisers" in role "Walled"',
  );
  assert.equal(describeRoute({ kind: 'lead' }), 'being the project lead');
});

test("Jira's Browse list names the people a class grant lets in and confirms the rest", () => {
  const withList = { ...site, jiraBrowse: { LEAK: ['u-ada', 'u-bea', 'u-kim'], FALCON: ['u-bea', 'u-cem'] } };
  const leak = wallTiers(withList, 'LEAK');
  const by = Object.fromEntries(leak.canSee.map((p) => [p.accountId, p]));
  assert.deepEqual(Object.keys(by).sort(), ['u-ada', 'u-bea', 'u-kim']);
  assert.equal(by['u-bea'].evidence, Evidence.CONFIRMED_BY_JIRA);
  assert.equal(by['u-bea'].fromJiraList, undefined, 'Bea is explained by her direct grant');
  assert.equal(by['u-kim'].fromJiraList, true);
  assert.deepEqual(by['u-kim'].routes.map(routeKey), ['class:class:anyone', 'class:class:logged-in']);
  assert.equal(describeRoute(by['u-kim'].routes[1]), 'the grant to any logged-in user');
  assert.ok(!leak.selfAdmit.includes('u-ada'), 'an admin who can already see the project is not "outside"');

  const falcon = wallTiers(withList, 'FALCON');
  const bea = falcon.canSee.find((p) => p.accountId === 'u-bea');
  assert.equal(bea.evidence, Evidence.CONFIRMED_BY_JIRA);
  assert.equal(falcon.canSee.find((p) => p.accountId === 'u-dan').evidence, Evidence.PROVEN_STATIC, 'not in the list: no upgrade');
  assert.deepEqual(canSeeIds(falcon), canSeeIds(wallTiers(site, 'FALCON')), 'everyone in the list is explained by the model');
});

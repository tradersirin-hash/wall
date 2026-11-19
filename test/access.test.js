import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMINISTER,
  compareWithJira,
  describeEntry,
  diffAccess,
  explainAccess,
  isoTime,
  permissionCheckRequest,
  sampleAccounts,
  wallTiers,
  weakerEvidence,
  withGlobalChecks,
  Evidence,
} from '../src/engine/index.js';
import { ROLE, acmeSite, withGroupMember, withRoleUser } from './fixtures/sites.js';

const site = acmeSite();

test('explain gives one sentence per path', () => {
  const dan = explainAccess(site, { accountId: 'u-dan', projectKey: 'FALCON' });
  assert.equal(dan.answer, 'yes');
  assert.equal(dan.paths.length, 1);
  assert.equal(
    dan.paths[0].sentence,
    'Dan can "Browse projects" in FALCON because Dan is in group "falcon-advisers", that group is in project role "Walled" in FALCON, and scheme "Falcon Scheme" grants it to that role.',
  );
  const gus = explainAccess(site, { accountId: 'u-gus', projectKey: 'FALCON' });
  assert.equal(gus.paths.length, 2);
  assert.match(gus.summary, /2 paths/);
});

test('explain says no for an outsider and depends for a class grant', () => {
  assert.equal(explainAccess(site, { accountId: 'u-kim', projectKey: 'FALCON' }).answer, 'no');
  const leak = explainAccess(site, { accountId: 'u-kim', projectKey: 'LEAK' });
  assert.equal(leak.answer, 'depends');
  assert.ok(leak.conditionalPaths.some((p) => p.principal === 'class:anyone'));
  const hal = explainAccess(site, { accountId: 'u-hal', projectKey: 'FALCON' });
  assert.equal(hal.inactive, true);
  assert.match(hal.summary, /inactive/);
});

test('scan-to-scan diff finds who gained Browse and only where it changed', () => {
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const diff = diffAccess(site, after);
  assert.deepEqual(
    diff.gained.map((e) => `${e.projectKey}:${e.accountId}`),
    ['FALCON:u-ada'],
    'ARCHIVE is on the same scheme, but Ada could already see it as its lead',
  );
  assert.equal(describeEntry(diff.gained[0]), 'Ada gained "Browse projects" in FALCON.');
  assert.equal(diff.summary.unchanged, false);
  assert.equal(diffAccess(site, site).summary.unchanged, true);
});

test('diff reports losses too', () => {
  const after = withRoleUser(site, 'FALCON', ROLE.WALLED, 'u-kim');
  const back = diffAccess(after, site, { projectKeys: ['FALCON'] });
  assert.deepEqual(back.lost.map((e) => e.accountId), ['u-kim']);
});

test('permission check request and comparison with Jira', () => {
  const body = permissionCheckRequest(site, 'u-bea', { projectKeys: ['FALCON', 'OPS', 'TEAM'], globalPermissions: [ADMINISTER] });
  assert.deepEqual(body, {
    accountId: 'u-bea',
    projectPermissions: [{ permissions: ['BROWSE_PROJECTS'], projects: [10400, 10000] }],
    globalPermissions: ['ADMINISTER'],
  });
  const agree = compareWithJira(site, 'u-bea', { projectKeys: ['FALCON', 'OPS'], globalPermissions: [ADMINISTER] }, {
    projectPermissions: [{ permission: 'BROWSE_PROJECTS', projects: [10400, 10000] }],
    globalPermissions: [],
  });
  assert.equal(agree.evidence, Evidence.CONFIRMED_BY_JIRA);
  assert.equal(agree.mismatches.length, 0);
  assert.ok(agree.confirmed.some((c) => c.projectKey === 'OPS' && c.throughClass));

  const hal = compareWithJira(site, 'u-hal', { projectKeys: ['FALCON'] }, { projectPermissions: [{ permission: 'BROWSE_PROJECTS', projects: [] }] });
  assert.equal(hal.evidence, Evidence.PROVEN_STATIC);
  assert.equal(hal.mismatches[0].likelyReason, 'The account is inactive.');

  const ada = compareWithJira(site, 'u-ada', { projectKeys: [], globalPermissions: [ADMINISTER] }, { projectPermissions: [], globalPermissions: ['ADMINISTER'] });
  assert.deepEqual(ada.globalChecks, [{ accountId: 'u-ada', permission: 'ADMINISTER', has: true, predicted: true, agrees: true }]);
});

test('global checks stored in the snapshot add Jira admins to tier 2', () => {
  const updated = withGlobalChecks(site, [{ accountId: 'u-kim', permission: ADMINISTER, has: true }], '2026-12-02T00:00:00.000Z');
  const kim = wallTiers(updated, 'FALCON').canChange.find((p) => p.accountId === 'u-kim');
  assert.equal(kim.evidence, Evidence.CONFIRMED_BY_JIRA);
  assert.equal(site.globalChecks.length, 2, 'input not changed');
});

test('sampling takes admins first and is deterministic', () => {
  const tiers = wallTiers(site, 'FALCON');
  assert.deepEqual(sampleAccounts(tiers, 4), ['u-ada', 'u-eli', 'u-ivo', 'u-wall']);
  assert.deepEqual(sampleAccounts(tiers, 4), sampleAccounts(tiers, 4));
});

test('evidence order and time normalisation', () => {
  assert.equal(weakerEvidence(Evidence.CONFIRMED_BY_JIRA, Evidence.CONDITIONAL), Evidence.CONDITIONAL);
  assert.equal(isoTime('2026-12-02T10:15:00.000+0000'), '2026-12-02T10:15:00.000Z');
  assert.equal(isoTime('2026-12-02T13:15:00+0300'), '2026-12-02T10:15:00.000Z');
  assert.equal(isoTime(null), null);
  assert.throws(() => isoTime('yesterday'));
});

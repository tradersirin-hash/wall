import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeKind, attributeCrossing, normaliseAuditRecords, wallTiers } from '../src/engine/index.js';
import { auditRecords } from './fixtures/audit.js';
import { ROLE, acmeSite, changed, withGroupMember, withRoleUser } from './fixtures/sites.js';

const site = acmeSite();

test('audit records are classified and normalised', () => {
  const changes = normaliseAuditRecords(auditRecords(), site);
  const kinds = Object.fromEntries(changes.map((c) => [c.id, c.kind]));
  assert.deepEqual(kinds, {
    2001: ChangeKind.GROUP_MEMBER_ADDED,
    2002: ChangeKind.ROLE_ACTORS_CHANGED,
    2003: ChangeKind.ROLE_ACTORS_CHANGED,
    2004: ChangeKind.GROUP_MEMBER_ADDED,
    2005: ChangeKind.SCHEME_CHANGED,
    2006: ChangeKind.OTHER,
    2007: ChangeKind.GROUP_MEMBER_ADDED,
  });
  assert.equal(changes.find((c) => c.id === '2007').mirrorOf, '2001', 'the author-less copy of a REST change is marked');
  assert.equal(changes.find((c) => c.id === '2004').mirrorOf, undefined, 'a change made in Atlassian Administration is not a mirror');
  assert.equal(changes[0].id, '2004', 'oldest first');
  const roleChange = changes.find((c) => c.id === '2002');
  assert.deepEqual(roleChange.users.added.map((u) => u.accountId), ['u-kim']);
  assert.equal(roleChange.project.id, '10400');
  const groupsChange = changes.find((c) => c.id === '2003');
  assert.deepEqual(groupsChange.groups.added.map((g) => g.groupId), ['g-staff']);
  const kim = changes.find((c) => c.id === '2004');
  assert.deepEqual(kim.users.added, [{ accountId: 'u-kim', name: 'Kim' }]);
  assert.equal(kim.at, '2026-12-01T08:00:00.000Z');
});

test('a self-admission through a group is attributed exactly', () => {
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const tiers = wallTiers(after, 'FALCON');
  const ada = tiers.canSee.find((p) => p.accountId === 'u-ada');
  const result = attributeCrossing(ada, normaliseAuditRecords(auditRecords(), after), {
    project: tiers.project,
    schemeId: tiers.scheme.id,
    until: '2026-12-03T00:00:00.000Z',
    snapshot: after,
  });
  assert.equal(result.found, true);
  assert.equal(result.confidence, 'exact');
  assert.equal(result.actorAccountId, 'u-ada');
  assert.equal(result.selfAdmitted, true);
  assert.equal(result.auditRecordId, '2001');
  assert.equal(
    result.sentence,
    'Ada added themselves to group "falcon-deal-team" on 2026-12-02 10:15 UTC, which gives access through group "falcon-deal-team".',
  );
});

test('a role addition by a project admin is attributed to that admin', () => {
  const after = withRoleUser(site, 'FALCON', ROLE.WALLED, 'u-kim');
  const tiers = wallTiers(after, 'FALCON');
  const kim = tiers.canSee.find((p) => p.accountId === 'u-kim');
  const result = attributeCrossing(kim, normaliseAuditRecords(auditRecords(), after), { project: tiers.project, schemeId: tiers.scheme.id, snapshot: after });
  assert.equal(result.confidence, 'exact');
  assert.equal(result.actorAccountId, 'u-eli');
  assert.equal(result.selfAdmitted, false);
  assert.match(result.sentence, /^Eli added Kim to role "Walled" on 2026-12-02 11:00 UTC/);
});

test('a group added to a role is attributed at group level', () => {
  const after = changed(site, (s) => s.projects.find((p) => p.key === 'FALCON').roleActors[ROLE.WALLED].groupIds.push('g-staff'));
  const tiers = wallTiers(after, 'FALCON');
  const kim = tiers.canSee.find((p) => p.accountId === 'u-kim');
  const result = attributeCrossing(kim, normaliseAuditRecords(auditRecords(), after), { project: tiers.project, schemeId: tiers.scheme.id, snapshot: after });
  assert.equal(result.confidence, 'exact');
  assert.equal(result.actorAccountId, 'u-ivo');
  assert.match(result.sentence, /Ivo added group "jira-software-users" to role "Walled"/);
});

test('the time window and a missing record are handled honestly', () => {
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const tiers = wallTiers(after, 'FALCON');
  const ada = tiers.canSee.find((p) => p.accountId === 'u-ada');
  const changes = normaliseAuditRecords(auditRecords(), after);
  const before = attributeCrossing(ada, changes, { project: tiers.project, schemeId: tiers.scheme.id, until: '2026-12-02T10:00:00.000Z' });
  assert.equal(before.found, false);
  assert.equal(before.confidence, 'none');
  assert.match(before.sentence, /No matching record/);
  const after2 = attributeCrossing(ada, changes, { project: tiers.project, schemeId: tiers.scheme.id, since: '2026-12-02T10:30:00+0000' });
  assert.equal(after2.found, false);
});

test('a change made in Atlassian Administration is timed but nobody is named', () => {
  // Such changes reach Jira's audit log with the author shown as "JIRA".
  const records = auditRecords().map((r) => (r.id === 2001 ? { ...r, authorAccountId: undefined, authorKey: 'JIRA' } : r));
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const tiers = wallTiers(after, 'FALCON');
  const ada = tiers.canSee.find((p) => p.accountId === 'u-ada');
  const result = attributeCrossing(ada, normaliseAuditRecords(records, after), { project: tiers.project, schemeId: tiers.scheme.id, snapshot: after });
  assert.equal(result.found, true);
  assert.equal(result.actorVisible, false);
  assert.equal(result.actorAccountId, null);
  assert.equal(result.selfAdmitted, false);
  assert.equal(
    result.sentence,
    'Ada was added to group "falcon-deal-team" on 2026-12-02 10:15 UTC outside Jira (for example in Atlassian Administration), which gives access through group "falcon-deal-team". Jira\'s audit log does not name who made it; the organization audit log does.',
  );
  const jiraAuthor = normaliseAuditRecords([{ ...auditRecords()[0], authorAccountId: 'JIRA' }], after)[0];
  assert.equal(jiraAuthor.actorAccountId, null);
});

test('a group addition that does not name the person is only a partial match', () => {
  const records = auditRecords()
    .filter((r) => r.id !== 2007)
    .map((r) => (r.id === 2001 ? { ...r, associatedItems: [{ id: 'key-unknown', name: 'key-unknown', typeName: 'USER' }] } : r));
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const tiers = wallTiers(after, 'FALCON');
  const ada = tiers.canSee.find((p) => p.accountId === 'u-ada');
  const result = attributeCrossing(ada, normaliseAuditRecords(records, after), { project: tiers.project, schemeId: tiers.scheme.id, snapshot: after });
  assert.equal(result.confidence, 'partial');
  assert.match(result.sentence, /closest matching change/);
});

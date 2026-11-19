import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, appendAll, bindLabIds, driftReport, labScenario, ledgerState, verifyChain, wallTiers } from '../src/engine/index.js';

const now = '2026-12-10T12:00:00.000Z';
const people = [
  { accountId: 'p-admin', displayName: 'Judge', accountType: 'atlassian' },
  { accountId: 'p-1', displayName: 'Aylin', accountType: 'atlassian' },
  { accountId: 'p-bot', displayName: 'Automation', accountType: 'app' },
  { accountId: 'p-2', displayName: 'Ben', accountType: 'atlassian' },
  { accountId: 'p-3', displayName: 'Chen', accountType: 'atlassian' },
  { accountId: 'p-4', displayName: 'Dara', accountType: 'atlassian' },
];
const ids = { projectId: '20001', roleId: '30001', groupId: 'grp-lab' };

/** The snapshot Lab mode would leave on the site, built from the plan. */
function labSnapshot(plan) {
  return {
    users: people,
    groups: [{ groupId: ids.groupId, name: LAB.groupName, memberIds: plan.group.members }],
    roles: [{ id: ids.roleId, name: LAB.roleName }],
    schemes: [
      {
        id: '900',
        name: plan.scheme.name,
        grants: [
          { id: '1', permission: 'BROWSE_PROJECTS', holder: { type: 'projectRole', parameter: ids.roleId } },
          { id: '2', permission: 'BROWSE_PROJECTS', holder: { type: 'group', parameter: ids.groupId } },
          { id: '3', permission: 'ADMINISTER_PROJECTS', holder: { type: 'user', parameter: 'p-admin' } },
        ],
      },
    ],
    projects: [{ id: ids.projectId, key: LAB.projectKey, name: LAB.projectName, style: 'classic', schemeId: '900', roleActors: { [ids.roleId]: { userIds: plan.role.members, groupIds: [] } } }],
  };
}

test('with enough people, the Lab shows every state the drift check knows', () => {
  const plan = labScenario({ now, adminAccountId: 'p-admin', people });
  assert.deepEqual(plan.peopleUsed, ['p-1', 'p-2', 'p-3', 'p-4'], 'app accounts and the admin are skipped');
  assert.deepEqual(plan.role.members, ['p-1', 'p-3']);
  assert.deepEqual(plan.group.members, ['p-2', 'p-4']);
  const records = appendAll([], bindLabIds(plan.ledgerInputs, ids));
  assert.equal(verifyChain(records).ok, true);
  assert.equal(ledgerState(records).wall.projectId, ids.projectId);

  const report = driftReport({ tiers: wallTiers(labSnapshot(plan), LAB.projectKey), records, at: now });
  assert.deepEqual(report.unrecorded.map((u) => u.accountId), ['p-4']);
  assert.deepEqual(report.overstay.map((o) => o.accountId), ['p-2']);
  assert.deepEqual(report.awaitingAcknowledgement.map((a) => a.accountId), ['p-3']);
  assert.equal(report.stale.length, 0);
  assert.equal(report.status, 'drift');
});

test('on a one-person site the Lab falls back to personas with ended crossings', () => {
  const plan = labScenario({ now, adminAccountId: 'p-admin', people: [people[0]] });
  assert.equal(plan.unrecorded, null);
  assert.deepEqual(plan.role.members, []);
  assert.equal(plan.personas.length, 3);
  const records = appendAll([], bindLabIds(plan.ledgerInputs, ids));
  assert.equal(verifyChain(records).ok, true);
  const state = ledgerState(records);
  assert.ok(state.crossings.every((c) => c.endedAt), 'personas never hold access');
  assert.match(plan.liveMoment, /add yourself/);
});

test('Lab inputs are in time order and marked as sample data', () => {
  const plan = labScenario({ now, adminAccountId: 'p-admin', people });
  const times = plan.ledgerInputs.map((i) => i.at);
  assert.deepEqual(times, [...times].sort());
  assert.match(plan.ledgerInputs[0].data.subject, /sample data, not a real deal/);
  assert.match(plan.project.description, /Wall Lab/);
});

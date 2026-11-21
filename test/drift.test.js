import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecordType,
  appendAll,
  appendRecord,
  driftFlagInputs,
  driftReport,
  ledgerState,
  normaliseAuditRecords,
  recordDriftInput,
  verifyChain,
  wallTiers,
} from '../src/engine/index.js';
import { auditRecords } from './fixtures/audit.js';
import { T, falconLedger } from './fixtures/ledger.js';
import { ROLE, acmeSite, changed, withGroupMember } from './fixtures/sites.js';

const site = acmeSite();
const ledger = falconLedger();

test('a wall whose ledger matches Jira is intact', () => {
  const report = driftReport({ tiers: wallTiers(site, 'FALCON'), records: ledger, at: '2026-11-25T00:00:00.000Z' });
  assert.equal(report.status, 'intact');
  assert.deepEqual(report.unrecorded, []);
  assert.deepEqual(report.overstay, []);
  assert.deepEqual(report.stale, []);
  assert.deepEqual(report.apps.map((a) => a.accountId), ['u-wall']);
  assert.deepEqual(report.awaitingAcknowledgement.map((a) => a.crossingId), ['X-GUS']);
  assert.equal(report.summary.recorded, 7);
  assert.equal(report.ledgerHead.seq, 13);
});

test('extra routes are reported: ending the crossing alone would not remove access', () => {
  const report = driftReport({ tiers: wallTiers(site, 'FALCON'), records: ledger, at: T.check });
  const extra = Object.fromEntries(report.extraRoutes.map((e) => [e.accountId, e]));
  assert.deepEqual(Object.keys(extra), ['u-eli', 'u-gus']);
  assert.equal(
    extra['u-gus'].sentence,
    'Gus was brought over through role "Walled" but can also see the project through group "falcon-deal-team"; ending the crossing alone will not remove access.',
  );
  assert.equal(extra['u-gus'].recordedRoutePresent, true);
});

test('an expired crossing that still has access is an overstay; a late acknowledgement is overdue', () => {
  const report = driftReport({ tiers: wallTiers(site, 'FALCON'), records: ledger, at: T.check });
  assert.equal(report.status, 'drift');
  assert.deepEqual(report.overstay.map((o) => o.crossingId), ['X-FAY']);
  assert.deepEqual(report.unacknowledged.map((u) => u.crossingId), ['X-GUS']);
  assert.equal(report.unacknowledged[0].dueAt, '2026-11-26T09:00:00.000Z');
});

test('the live moment: an admin adds themselves and Wall names them', () => {
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const report = driftReport({
    tiers: wallTiers(after, 'FALCON'),
    records: ledger,
    at: '2026-12-02T10:20:00.000Z',
    changes: normaliseAuditRecords(auditRecords(), after),
    snapshot: after,
  });
  assert.equal(report.status, 'drift');
  assert.equal(report.unrecorded.length, 1);
  const ada = report.unrecorded[0];
  assert.equal(ada.accountId, 'u-ada');
  assert.equal(ada.attribution.confidence, 'exact');
  assert.equal(ada.attribution.selfAdmitted, true);
  assert.equal(report.summary.selfAdmitted, 1);
  assert.equal(report.summary.attributed, 1);
});

test('drift is flagged in the ledger once, then recorded after the fact', () => {
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const tiers = wallTiers(after, 'FALCON');
  const changes = normaliseAuditRecords(auditRecords(), after);
  const at = '2026-12-02T10:20:00.000Z';
  const report = driftReport({ tiers, records: ledger, at, changes, snapshot: after });

  const flags = driftFlagInputs(report, ledger, { by: 'u-wall' });
  assert.equal(flags.length, 1);
  const flagged = appendAll(ledger, flags);
  assert.equal(ledgerState(flagged).flags[0].attribution.actorAccountId, 'u-ada');
  assert.equal(driftFlagInputs(report, flagged, { by: 'u-wall' }).length, 0, 'not flagged twice');

  const input = recordDriftInput(report.unrecorded[0], {
    by: 'u-eli',
    at: '2026-12-02T12:00:00.000Z',
    reason: 'Reviews the deal as group general counsel; access approved after the fact.',
    approverAccountId: 'u-eli',
  });
  assert.equal(input.data.obtainedAt, '2026-12-02T10:15:00.000Z', 'obtained when the audit log says');
  assert.deepEqual(input.data.route, { kind: 'group', groupId: 'g-deal', groupName: 'falcon-deal-team' });
  const recorded = appendAll(flagged, [input]);
  assert.equal(verifyChain(recorded).ok, true);
  const later = driftReport({ tiers, records: recorded, at: '2026-12-02T12:05:00.000Z', changes, snapshot: after });
  assert.deepEqual(later.unrecorded, []);
});

test('access removed outside Wall leaves a stale crossing', () => {
  const after = changed(site, (s) => {
    const actors = s.projects.find((p) => p.key === 'FALCON').roleActors[ROLE.WALLED];
    actors.userIds = actors.userIds.filter((id) => id !== 'u-cem');
  });
  const report = driftReport({ tiers: wallTiers(after, 'FALCON'), records: ledger, at: '2026-11-25T00:00:00.000Z' });
  assert.deepEqual(report.stale.map((s) => s.crossingId), ['X-CEM']);
  assert.equal(report.status, 'intact', 'less access than recorded is not a breach');
});

test('someone whose crossing ended and who can still see is unrecorded again', () => {
  const ended = appendAll(ledger, [{ type: RecordType.CROSSING_ENDED, by: 'u-eli', at: '2026-11-26T00:00:00.000Z', data: { crossingId: 'X-HAL', cause: 'removed' } }]);
  const report = driftReport({ tiers: wallTiers(site, 'FALCON'), records: ended, at: '2026-11-26T01:00:00.000Z' });
  assert.deepEqual(report.unrecorded.map((u) => [u.accountId, u.previousCrossingId, u.active]), [['u-hal', 'X-HAL', false]]);
});

test('openings make the wall drift even with a perfect ledger', () => {
  const tiers = wallTiers(site, 'LEAK');
  const records = appendAll([], [
    { type: RecordType.WALL_RAISED, by: 'u-ada', at: T.raised, wallId: '10102', data: { projectKey: 'LEAK', projectId: '10102', subject: 'Leaky deal' } },
    { type: RecordType.CROSSING_GRANTED, by: 'u-ada', at: T.bea, data: { accountId: 'u-bea', route: { kind: 'direct' }, reason: 'Deal lead.', approverAccountId: 'u-ada' } },
  ]);
  const report = driftReport({ tiers, records, at: T.check });
  assert.equal(report.unrecorded.length, 0);
  assert.equal(report.status, 'drift');
  assert.equal(report.summary.openings, 3);
});

test('accounts can be ignored, for example Wall itself', () => {
  const after = withGroupMember(site, 'g-deal', 'u-ada');
  const report = driftReport({ tiers: wallTiers(after, 'FALCON'), records: ledger, at: '2026-11-25T00:00:00.000Z', ignoreAccountIds: ['u-ada', 'u-wall'] });
  assert.deepEqual(report.unrecorded, []);
  assert.deepEqual(report.apps, []);
  assert.equal(appendRecord(ledger, { type: RecordType.DRIFT_FLAGGED, by: 'u-wall', at: T.check, data: { accountId: 'u-ada', routes: [] } }).data.attribution, null);
});

test('the recorded count counts people with an open crossing, not apps', () => {
  const report = driftReport({ tiers: wallTiers(site, 'FALCON'), records: ledger, at: '2026-11-25T00:00:00.000Z' });
  assert.equal(report.summary.people, 7);
  assert.equal(report.summary.recorded, 7);
  const empty = driftReport({ tiers: wallTiers(site, 'FALCON'), records: ledger.slice(0, 1), at: '2026-11-25T00:00:00.000Z' });
  assert.equal(empty.summary.recorded, 0);
  assert.equal(empty.summary.unrecorded, 7);
});

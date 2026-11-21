import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENESIS_HASH,
  LedgerError,
  RecordType,
  appendAll,
  appendRecord,
  crossingStatus,
  hashRecord,
  insidersAt,
  ledgerState,
  raiseWallInputs,
  statementHash,
  verifyChain,
  wallTiers,
} from '../src/engine/index.js';
import { T, deal, falconInputs, falconLedger, walled } from './fixtures/ledger.js';
import { acmeSite } from './fixtures/sites.js';

const ledger = falconLedger();

function rejects(records, input, code, options) {
  assert.throws(
    () => appendRecord(records, input, options),
    (error) => error instanceof LedgerError && error.code === code,
    `expected ${code}`,
  );
}

/** Seal a record without any validation, as someone editing the database would. */
function forge(prev, fields) {
  const record = { format: 'wall-ledger/1', wallId: prev.wallId, seq: prev.seq + 1, prevHash: prev.hash, ...fields };
  return { ...record, hash: hashRecord(record) };
}

test('records chain from the genesis hash and verify', () => {
  assert.equal(ledger.length, 14);
  assert.equal(ledger[0].prevHash, GENESIS_HASH);
  for (let i = 1; i < ledger.length; i += 1) assert.equal(ledger[i].prevHash, ledger[i - 1].hash);
  const check = verifyChain(ledger);
  assert.equal(check.ok, true, JSON.stringify(check.problems));
  assert.deepEqual(check.head, { seq: 13, hash: ledger[13].hash });
  assert.match(ledger[13].hash, /^[0-9a-f]{64}$/);
});

test('the chain survives a JSON round trip (how it is stored)', () => {
  const stored = JSON.parse(JSON.stringify(ledger));
  assert.equal(verifyChain(stored).ok, true);
  assert.equal(hashRecord(stored[5]), ledger[5].hash);
});

test('appending is pure and deterministic', () => {
  const inputs = falconInputs();
  const a = appendAll([], inputs);
  const b = appendAll([], inputs);
  assert.deepEqual(a, b);
  const before = [...ledger];
  appendRecord(ledger, { type: RecordType.CROSSING_ENDED, by: 'u-eli', at: T.check, data: { crossingId: 'X-FAY', cause: 'expired' } });
  assert.deepEqual(ledger, before);
});

test('state: crossings, statuses and who was inside when', () => {
  const state = ledgerState(ledger);
  assert.equal(state.wall.projectKey, 'FALCON');
  assert.equal(state.wall.identifiedAt, '2026-11-20T08:30:00.000Z');
  assert.equal(state.crossings.length, 7);
  assert.equal(state.openByAccount.size, 7);
  const status = Object.fromEntries(state.crossings.map((c) => [c.crossingId, crossingStatus(c, T.check)]));
  assert.deepEqual(status, {
    'X-ELI': 'active',
    'X-BEA': 'active',
    'X-CEM': 'active',
    'X-DAN': 'active',
    'X-FAY': 'expired',
    'X-GUS': 'awaiting-acknowledgement',
    'X-HAL': 'active',
  });
  assert.equal(insidersAt(state, T.raised).length, 0);
  assert.deepEqual(insidersAt(state, '2026-11-21T00:00:00.000Z').map((c) => c.accountId), ['u-eli', 'u-bea']);
  assert.equal(insidersAt(state, T.check).length, 7);
});

test('a crossing can be extended and ended; the end shows in the state', () => {
  const extended = appendAll(ledger, [
    { type: RecordType.CROSSING_EXTENDED, by: 'u-eli', at: '2026-11-29T09:00:00.000Z', data: { crossingId: 'X-FAY', expiresAt: '2026-12-15T18:00:00.000Z', approverAccountId: 'u-eli', reason: 'Model revisions after due diligence.' } },
  ]);
  let state = ledgerState(extended);
  assert.equal(crossingStatus(state.byId.get('X-FAY'), T.check), 'active');
  assert.equal(state.byId.get('X-FAY').extensions.length, 1);
  const ended = appendAll(extended, [{ type: RecordType.CROSSING_ENDED, by: 'u-eli', at: T.check, data: { crossingId: 'X-FAY', cause: 'removed', note: 'Model delivered.' } }]);
  state = ledgerState(ended);
  assert.equal(crossingStatus(state.byId.get('X-FAY'), T.check), 'ended');
  assert.equal(state.openByAccount.has('u-fay'), false);
  assert.equal(state.byId.get('X-FAY').endRecordedAt, T.check);
  // Fay can be brought over again with a new crossing.
  const again = appendRecord(ended, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at: '2026-12-05T09:00:00.000Z', data: { accountId: 'u-fay', route: deal, reason: 'Second round of modelling.', approverAccountId: 'u-eli' } });
  assert.equal(again.data.crossingId, 'X0016');
  assert.equal(verifyChain([...ended, again]).ok, true);
});

test('an edited record breaks its own hash', () => {
  const tampered = structuredClone(ledger);
  tampered[3].data.reason = 'Nothing to see here.';
  const check = verifyChain(tampered);
  assert.equal(check.ok, false);
  assert.deepEqual(check.problems.map((p) => [p.index, p.code]), [[3, 'hash-mismatch']]);
});

test('an edited and re-hashed record breaks the link to the next record', () => {
  const tampered = structuredClone(ledger);
  tampered[3].data.reason = 'Nothing to see here.';
  tampered[3].hash = hashRecord(tampered[3]);
  const check = verifyChain(tampered);
  assert.deepEqual(check.problems.map((p) => [p.index, p.code]), [[4, 'broken-link']]);
});

test('a removed record leaves a gap and a broken link', () => {
  const cut = ledger.filter((r) => r.seq !== 5);
  const codes = verifyChain(cut).problems.map((p) => p.code);
  assert.ok(codes.includes('seq-gap'));
  assert.ok(codes.includes('broken-link'));
  assert.ok(codes.includes('invalid:unknown-crossing'), 'the acknowledgement now points at a missing crossing');
});

test('swapped records are caught', () => {
  const swapped = [...ledger];
  [swapped[7], swapped[8]] = [swapped[8], swapped[7]];
  const codes = verifyChain(swapped).problems.map((p) => p.code);
  assert.ok(codes.includes('seq-gap'));
  assert.ok(codes.includes('broken-link'));
});

test('records cut off the end are only caught against an anchor', () => {
  const anchor = { seq: 13, hash: ledger[13].hash };
  const short = ledger.slice(0, 10);
  assert.equal(verifyChain(short).ok, true);
  const check = verifyChain(short, { anchor });
  assert.equal(check.ok, false);
  assert.equal(check.problems[0].code, 'truncated');
  assert.equal(verifyChain(ledger, { anchor }).anchored, true);
});

test('a rebuilt chain verifies on its own but not against the anchor', () => {
  const anchor = { seq: 13, hash: ledger[13].hash };
  const inputs = falconInputs();
  inputs[3] = { ...inputs[3], data: { ...inputs[3].data, reason: 'Rewritten history.' } };
  const rebuilt = appendAll([], inputs);
  assert.equal(verifyChain(rebuilt).ok, true);
  const check = verifyChain(rebuilt, { anchor });
  assert.equal(check.ok, false);
  assert.equal(check.problems[0].code, 'anchor-mismatch');
});

test('a forged record with valid hashes still fails the replay of the rules', () => {
  const last = ledger[ledger.length - 1];
  const forged = forge(last, { type: RecordType.CROSSING_ACKNOWLEDGED, at: T.check, by: 'u-eli', data: { crossingId: 'X-GUS', acknowledgedAt: T.check } });
  const check = verifyChain([...ledger, forged]);
  assert.equal(check.ok, false);
  assert.deepEqual(check.problems.map((p) => p.code), ['invalid:ack-by-other']);
});

test('the rules every record must pass', () => {
  const at = T.check;
  rejects([], { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, wallId: '10400', data: {} }, 'no-wall');
  rejects(ledger, { type: RecordType.WALL_RAISED, by: 'u-eli', at, data: { projectKey: 'X', projectId: '1', subject: 'Again' } }, 'already-raised');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-kim', at, data: { accountId: 'u-kim', route: walled, reason: 'I want in.', approverAccountId: 'u-kim' } }, 'self-approval');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: walled, reason: '', approverAccountId: 'u-eli' } }, 'missing-field');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: walled, reason: 'Needed.' } }, 'missing-field');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-bea', route: walled, reason: 'Again.', approverAccountId: 'u-eli' } }, 'already-open');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: { kind: 'magic' }, reason: 'Needed.', approverAccountId: 'u-eli' } }, 'bad-route');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: { kind: 'role' }, reason: 'Needed.', approverAccountId: 'u-eli' } }, 'bad-route');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: walled, reason: 'Needed.', approverAccountId: 'u-eli', obtainedAt: '2027-01-01T00:00:00Z' } }, 'future-time');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: walled, reason: 'Needed.', approverAccountId: 'u-eli', expiresAt: '2026-11-01T00:00:00Z' } }, 'bad-expiry');
  rejects(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at, data: { accountId: 'u-kim', route: walled, reason: 'Needed.', approverAccountId: 'u-eli', crossingId: 'X-BEA' } }, 'duplicate-crossing');
  rejects(ledger, { type: RecordType.CROSSING_ACKNOWLEDGED, by: 'u-eli', at, data: { crossingId: 'X-GUS' } }, 'ack-by-other');
  rejects(ledger, { type: RecordType.CROSSING_ACKNOWLEDGED, by: 'u-bea', at, data: { crossingId: 'X-BEA' } }, 'already-acknowledged');
  rejects(ledger, { type: RecordType.CROSSING_ACKNOWLEDGED, by: 'u-kim', at, data: { crossingId: 'X-NONE' } }, 'unknown-crossing');
  rejects(ledger, { type: RecordType.CROSSING_ACKNOWLEDGED, by: 'u-gus', at, data: { crossingId: 'X-GUS', statementHash: 'abc' } }, 'bad-hash');
  rejects(ledger, { type: RecordType.CROSSING_ENDED, by: 'u-eli', at, data: { crossingId: 'X-BEA', cause: 'bored' } }, 'bad-cause');
  rejects(ledger, { type: RecordType.CROSSING_ENDED, by: 'u-eli', at, data: { crossingId: 'X-BEA', cause: 'removed', endedAt: '2026-11-01T00:00:00Z' } }, 'bad-end');
  rejects(ledger, { type: RecordType.CROSSING_EXTENDED, by: 'u-eli', at, data: { crossingId: 'X-BEA', expiresAt: '2026-11-01T00:00:00Z', approverAccountId: 'u-eli', reason: 'More time.' } }, 'bad-expiry');
  rejects(ledger, { type: RecordType.CROSSING_EXTENDED, by: 'u-bea', at, data: { crossingId: 'X-BEA', expiresAt: '2027-03-01T00:00:00Z', approverAccountId: 'u-bea', reason: 'More time.' } }, 'self-approval');
  rejects(ledger, { type: RecordType.CROSSING_ENDED, by: 'u-eli', at: '2026-11-01T00:00:00Z', data: { crossingId: 'X-BEA', cause: 'removed' } }, 'time-reversed');
  rejects(ledger, { type: RecordType.WALL_LOWERED, by: 'u-eli', at, data: { reason: 'Deal announced.' } }, 'open-crossings');
  rejects(ledger, { type: 'crossing.teleported', by: 'u-eli', at, data: {} }, 'unknown-type');
  rejects(ledger, { type: RecordType.CROSSING_ENDED, by: 'u-eli', at: 'soon', data: { crossingId: 'X-BEA', cause: 'removed' } }, 'bad-time');
  rejects(ledger, { type: RecordType.CROSSING_ENDED, by: 'u-eli', at, wallId: '999', data: { crossingId: 'X-BEA', cause: 'removed' } }, 'wrong-wall');
});

test('self-approval can be allowed explicitly', () => {
  const record = appendRecord(ledger, { type: RecordType.CROSSING_GRANTED, by: 'u-kim', at: T.check, data: { accountId: 'u-kim', route: walled, reason: 'Sole admin of a small team.', approverAccountId: 'u-kim' } }, { allowSelfApproval: true });
  assert.equal(record.data.approverAccountId, 'u-kim');
  assert.equal(verifyChain([...ledger, record], { allowSelfApproval: true }).ok, true);
  assert.equal(verifyChain([...ledger, record]).problems[0].code, 'invalid:self-approval');
});

test('a wall is lowered after every crossing has ended, and then stays closed', () => {
  const state = ledgerState(ledger);
  const ends = [...state.openByAccount.values()].map((c) => ({ type: RecordType.CROSSING_ENDED, by: 'u-eli', at: '2026-12-10T08:00:00.000Z', data: { crossingId: c.crossingId, cause: 'wall-lowered' } }));
  const lowered = appendAll(ledger, [...ends, { type: RecordType.WALL_LOWERED, by: 'u-eli', at: '2026-12-10T08:00:00.000Z', data: { reason: 'Acquisition announced to the market.' } }]);
  assert.equal(ledgerState(lowered).wall.lowered.reason, 'Acquisition announced to the market.');
  rejects(lowered, { type: RecordType.CROSSING_GRANTED, by: 'u-eli', at: '2026-12-11T08:00:00.000Z', data: { accountId: 'u-kim', route: walled, reason: 'Late.', approverAccountId: 'u-eli' } }, 'wall-lowered');
  const flag = appendRecord(lowered, { type: RecordType.DRIFT_FLAGGED, by: 'u-wall', at: '2026-12-11T08:00:00.000Z', data: { accountId: 'u-kim', routes: [walled] } });
  assert.equal(flag.type, RecordType.DRIFT_FLAGGED);
});

test('raising a wall over an existing project records everyone who already sees it', () => {
  const tiers = wallTiers(acmeSite(), 'FALCON');
  const inputs = raiseWallInputs(tiers, { by: 'u-eli', at: T.raised, subject: 'Project Falcon: proposed acquisition' });
  const records = appendAll([], inputs);
  const state = ledgerState(records);
  assert.equal(state.crossings.length, 7, 'the Wall app account is not a person');
  assert.ok(state.crossings.every((c) => c.baseline && !c.acknowledgedAt));
  assert.deepEqual(state.byId.get('X0003').route, { kind: 'role-group', roleId: '10100', roleName: 'Walled', groupId: 'g-advisers', groupName: 'falcon-advisers' });
  assert.equal(verifyChain(records).ok, true);
});

test('acknowledgement statements are hashed after Unicode normalisation', () => {
  assert.match(statementHash('I acknowledge my duties.'), /^[0-9a-f]{64}$/);
  assert.equal(statementHash('Café'), statementHash('Café'));
  const record = appendRecord(ledger, { type: RecordType.CROSSING_ACKNOWLEDGED, by: 'u-gus', at: T.check, data: { crossingId: 'X-GUS', statementHash: statementHash('I acknowledge my duties.') } });
  assert.equal(record.data.statementHash.length, 64);
});

test('no personal details beyond account ids are kept in records', () => {
  const record = appendRecord(ledger, {
    type: RecordType.CROSSING_GRANTED,
    by: 'u-eli',
    at: T.check,
    data: { accountId: 'u-kim', route: walled, reason: 'Needed.', approverAccountId: 'u-eli', displayName: 'Kim', insider: { firstName: 'Kim' } },
  });
  assert.equal('displayName' in record.data, false);
  assert.equal('insider' in record.data, false);
});

test('a wall over an open project records the people Jira lists, with the class route', () => {
  const site = acmeSite();
  const tiers = wallTiers({ ...site, jiraBrowse: { LEAK: ['u-bea', 'u-kim'] } }, 'LEAK');
  const records = appendAll([], raiseWallInputs(tiers, { by: 'u-ada', at: T.raised, subject: 'Leaky deal' }));
  assert.equal(verifyChain(records).ok, true);
  const kim = ledgerState(records).crossings.find((c) => c.accountId === 'u-kim');
  assert.deepEqual(kim.route, { kind: 'class', principal: 'class:anyone' });
});

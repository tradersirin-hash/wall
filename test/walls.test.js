import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordType, appendRecord } from '../src/engine/index.js';
import { createJira } from '../src/server/jira.js';
import { ConflictError, createMemoryStore } from '../src/server/store.js';
import { WallError, createWallService } from '../src/server/walls.js';
import { USERS, baseRoutes, fakeJira } from './fixtures/rest.js';

function clock(start) {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t).toISOString(),
    advance: (ms) => {
      t += ms;
    },
  };
}

const HOUR = 60 * 60 * 1000;
const noAudit = { 'GET /rest/api/3/auditing/record?*': { offset: 0, limit: 1000, total: 0, records: [] } };

function setup(routes = { ...baseRoutes(), ...noAudit }) {
  const fake = fakeJira({ routes });
  const store = createMemoryStore();
  const time = clock('2026-11-23T09:00:00.000Z');
  const service = createWallService({ jira: createJira(fake.request), store, now: time.now, appAccountId: async () => 'u-wall' });
  return { fake, store, time, service, routes };
}

test('candidate projects mark team-managed and walled ones', async () => {
  const { service } = setup();
  await service.raiseWall({ projectKey: 'FALCON', subject: 'Project Falcon: proposed acquisition', by: 'u-eli' });
  const { projects } = await service.candidateProjects();
  assert.deepEqual(projects.map((p) => [p.key, p.teamManaged, p.walled]), [['FALCON', false, true], ['TEAM', true, false]]);
});

test('raising a wall records everyone who can see the project as a baseline crossing', async () => {
  const { service, store } = setup();
  const result = await service.raiseWall({ projectKey: 'falcon', subject: 'Project Falcon: proposed acquisition', codeName: 'Falcon', by: 'u-eli' });
  assert.deepEqual(result, { wallId: '10400', projectKey: 'FALCON', records: 7, baseline: 6 });
  const walls = await service.listWalls();
  assert.equal(walls[0].status, 'raised');
  assert.equal(walls[0].lastScan.summary.counts.canSee, 7);
  const ledger = await store.readLedger('10400');
  assert.equal(ledger[0].type, RecordType.WALL_RAISED);
  assert.ok(ledger.slice(1).every((r) => r.data.baseline), 'the app account is not recorded as a person');
  await assert.rejects(service.raiseWall({ projectKey: 'FALCON', subject: 'Again', by: 'u-eli' }), (e) => e instanceof WallError && e.code === 'already-walled');
  await assert.rejects(service.raiseWall({ projectKey: 'TEAM', subject: 'Team project', by: 'u-eli' }), (e) => e.code === 'not-analysable');
  await assert.rejects(service.raiseWall({ projectKey: 'FALCON', subject: 'x' }), (e) => e.code === 'no-user');
});

test('a fresh wall reads as intact, verified and anchored', async () => {
  const { service, time } = setup();
  await service.raiseWall({ projectKey: 'FALCON', subject: 'Project Falcon: proposed acquisition', by: 'u-eli' });
  time.advance(HOUR);
  const view = await service.wallView('10400', { by: 'u-eli' });
  assert.equal(view.verification.ok, true);
  assert.equal(view.verification.anchored, true);
  assert.equal(view.drift.status, 'intact');
  assert.equal(view.crossings.length, 6);
  assert.ok(view.crossings.every((c) => c.status === 'awaiting-acknowledgement'));
  assert.deepEqual(view.tiers.selfAdmit, ['u-ada']);
  assert.equal(view.tiers.canSee.find((p) => p.accountId === 'u-dan').routeText[0], 'group "falcon-advisers" in role "Walled"');
  assert.equal('paths' in view.tiers.canSee[0], false, 'raw paths stay on the server');
  assert.deepEqual(view.jiraCheck.onlyInModel, ['u-hal']);
  assert.match(view.certificate.certificateHash, /^[0-9a-f]{64}$/);
  assert.equal(view.audit.error, null);
});

test('an admin who adds themselves is flagged, named, and written into the ledger once', async () => {
  const routes = { ...baseRoutes(), ...noAudit };
  const { service, store, time } = setup(routes);
  await service.raiseWall({ projectKey: 'FALCON', subject: 'Project Falcon: proposed acquisition', by: 'u-eli' });
  time.advance(HOUR);

  // Ada adds herself to falcon-deal-team through Jira; the audit log names her by user key.
  routes['GET /rest/api/3/group/member?groupId=g-deal&includeInactiveUsers=true&startAt=2&maxResults=50'].values.push(USERS['u-ada']);
  const at = time.now().replace('Z', '+0000');
  routes['GET /rest/api/3/auditing/record?*'] = {
    total: 2,
    records: [
      { id: 501, summary: 'User added to group', created: at, category: 'grup yönetimi', authorAccountId: 'u-ada', authorKey: 'key-ada', objectItem: { name: 'falcon-deal-team', typeName: 'GROUP' }, associatedItems: [{ id: 'key-ada', name: 'key-ada', typeName: 'USER' }] },
    ],
  };
  routes['GET /rest/api/3/user/bulk/migration?key=key-ada'] = [{ key: 'key-ada', accountId: 'u-ada' }];
  time.advance(60 * 1000);

  const view = await service.wallView('10400', { by: 'u-eli' });
  assert.equal(view.drift.status, 'drift');
  assert.equal(view.drift.unrecorded.length, 1);
  const ada = view.drift.unrecorded[0];
  assert.equal(ada.accountId, 'u-ada');
  assert.equal(ada.attribution.confidence, 'exact');
  assert.equal(ada.attribution.selfAdmitted, true);
  assert.equal(view.audit.keysMapped, 1);

  const first = await service.checkWalls();
  assert.deepEqual(first, [{ wallId: '10400', status: 'drift', flagged: 1 }]);
  const second = await service.checkWalls();
  assert.deepEqual(second, [{ wallId: '10400', status: 'drift', flagged: 0 }], 'flagged once');
  const ledger = await store.readLedger('10400');
  const flag = ledger.find((r) => r.type === RecordType.DRIFT_FLAGGED);
  assert.equal(flag.by, 'u-wall');
  assert.equal(flag.data.attribution.actorAccountId, 'u-ada');
});

test('an edited stored record is caught on the wall page', async () => {
  const { service, store } = setup();
  await service.raiseWall({ projectKey: 'FALCON', subject: 'Project Falcon: proposed acquisition', by: 'u-eli' });
  const raw = store._rawLedger('10400');
  const edited = JSON.parse(raw[2]);
  edited.data.reason = 'Changed later.';
  raw[2] = JSON.stringify(edited);
  const view = await service.wallView('10400', { by: 'u-eli' });
  assert.equal(view.verification.ok, false);
  assert.equal(view.verification.problems[0].code, 'hash-mismatch');
});

test('a failing audit read is shown, and the rest of the page still works', async () => {
  const routes = baseRoutes();
  const { service } = setup(routes);
  await service.raiseWall({ projectKey: 'FALCON', subject: 'Project Falcon: proposed acquisition', by: 'u-eli' });
  const view = await service.wallView('10400', { by: 'u-eli' });
  assert.equal(view.audit.error.status, 404);
  assert.equal(view.drift.status, 'intact');
});

test('the store refuses a second record with the same sequence number', async () => {
  const store = createMemoryStore();
  const first = appendRecord([], { type: RecordType.WALL_RAISED, by: 'u-eli', at: '2026-11-23T09:00:00Z', wallId: '1', data: { projectKey: 'A', projectId: '1', subject: 'Something secret' } });
  await store.appendRecord(first);
  await assert.rejects(store.appendRecord(first), (e) => e instanceof ConflictError);
  assert.deepEqual(await store.getAnchor('1'), { seq: 0, hash: first.hash });
});

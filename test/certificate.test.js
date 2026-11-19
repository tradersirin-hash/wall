import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCertificate, canonicalJson, snapshotHash, verifyCertificate, wallStateHash, wallTiers } from '../src/engine/index.js';
import { acmeSite, changed, withGroupMember } from './fixtures/sites.js';

const site = acmeSite();

test('canonical JSON sorts keys and drops undefined', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: 'x' }] }), '{"a":[2,{"c":"x"}],"b":1}');
});

test('the scan hash ignores order, names and scan time, but not access', () => {
  const shuffled = changed(site, (s) => {
    s.users.reverse();
    s.groups.reverse();
    s.groups[0].memberIds.reverse();
    s.users[0].displayName = 'Renamed';
    s.takenAt = '2027-01-01T00:00:00.000Z';
    s.schemes[0].grants.reverse();
  });
  assert.equal(snapshotHash(shuffled), snapshotHash(site));
  assert.notEqual(snapshotHash(withGroupMember(site, 'g-deal', 'u-ada')), snapshotHash(site));
  assert.match(snapshotHash(site), /^[0-9a-f]{64}$/);
});

test('the wall hash changes only when the wall changes', () => {
  const tiers = wallTiers(site, 'FALCON');
  const elsewhere = changed(site, (s) => s.groups.find((g) => g.groupId === 'g-staff').memberIds.pop());
  assert.equal(wallStateHash(wallTiers(elsewhere, 'FALCON')), wallStateHash(tiers));
  assert.notEqual(wallStateHash(wallTiers(withGroupMember(site, 'g-advisers', 'u-kim'), 'FALCON')), wallStateHash(tiers));
});

test('a certificate verifies, and any edit breaks it', () => {
  const tiers = wallTiers(site, 'FALCON');
  const cert = buildCertificate({
    snapshot: site,
    tiers,
    ledgerHead: { seq: 7, hash: 'a'.repeat(64) },
    issuedAt: '2026-12-01T09:05:00.000Z',
    issuedBy: 'u-eli',
  });
  assert.equal(cert.format, 'wall-certificate/1');
  assert.equal(cert.ledger.records, 8);
  assert.equal(verifyCertificate(cert), true);
  assert.equal(verifyCertificate({ ...cert, counts: { ...cert.counts, canSee: 3 } }), false);
  assert.equal(verifyCertificate(JSON.parse(JSON.stringify(cert))), true, 'survives a JSON round trip');
});

// SHA-256 certificates: a fixed, hashable statement of a wall's state at one time.
//
// A certificate binds together the scan (hash of the access-relevant parts of the
// snapshot), the two tiers, the ledger head and the drift summary. Anyone holding
// the certificate can recompute its hash; a later edit to any part breaks it.

import { createHash } from 'node:crypto';
import { routeKey } from './describe.js';

export const CERTIFICATE_FORMAT = 'wall-certificate/1';

/** JSON with object keys sorted at every level, so equal data gives equal text. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const byString = (key) => (x, y) => String(x[key]).localeCompare(String(y[key]));
const sortedStrings = (list = []) => [...list].map(String).sort();

function normaliseActors(actors) {
  return actors ? { userIds: sortedStrings(actors.userIds), groupIds: sortedStrings(actors.groupIds) } : undefined;
}

function normaliseGrants(grants = []) {
  return grants
    .map((g) => ({ permission: g.permission, type: g.holder.type, holder: String(g.holder.value ?? g.holder.parameter ?? '') }))
    .sort((x, y) => canonicalJson(x).localeCompare(canonicalJson(y)));
}

/**
 * The parts of a snapshot that decide access, in a fixed order. Scan time and
 * display names are left out, so two scans of an unchanged site hash the same.
 */
export function accessState(snapshot) {
  return {
    users: [...snapshot.users].map((u) => ({ accountId: u.accountId, active: u.active !== false })).sort(byString('accountId')),
    groups: [...snapshot.groups].map((g) => ({ groupId: g.groupId, memberIds: sortedStrings(g.memberIds) })).sort(byString('groupId')),
    roles: [...snapshot.roles].map((r) => ({ id: String(r.id) })).sort(byString('id')),
    schemes: [...snapshot.schemes].map((s) => ({ id: String(s.id), grants: normaliseGrants(s.grants) })).sort(byString('id')),
    projects: [...snapshot.projects]
      .map((p) => ({
        key: p.key,
        style: p.style ?? 'classic',
        schemeId: p.schemeId == null ? null : String(p.schemeId),
        leadAccountId: p.leadAccountId ?? null,
        roleActors: Object.fromEntries(
          Object.entries(p.roleActors ?? {})
            .map(([roleId, actors]) => [String(roleId), normaliseActors(actors)])
            .sort(([x], [y]) => x.localeCompare(y)),
        ),
      }))
      .sort(byString('key')),
    globalGrants: normaliseGrants(snapshot.globalGrants),
  };
}

export function snapshotHash(snapshot) {
  return sha256Hex(canonicalJson(accessState(snapshot)));
}

/** The hashable state of one wall: who can see it (and how), who can change that, and the openings. */
export function wallState(tiers) {
  return {
    project: tiers.project?.key ?? null,
    scheme: tiers.scheme?.id ?? null,
    canSee: (tiers.canSee ?? [])
      .map((p) => ({ accountId: p.accountId, routes: p.routes.map(routeKey).sort() }))
      .sort(byString('accountId')),
    canChange: (tiers.canChange ?? [])
      .map((p) => ({ principal: p.principal, powers: p.powers.map((x) => x.power).sort() }))
      .sort(byString('principal')),
    openings: (tiers.openings ?? []).map((o) => `${o.tier}:${o.principal}`).sort(),
  };
}

export function wallStateHash(tiers) {
  return sha256Hex(canonicalJson(wallState(tiers)));
}

/**
 * Build a certificate for one wall.
 * @param {{ snapshot: any, tiers: any, ledgerHead?: { seq: number, hash: string }|null,
 *           drift?: any, issuedAt: string, issuedBy?: string }} input
 */
export function buildCertificate({ snapshot, tiers, ledgerHead = null, drift = null, issuedAt, issuedBy }) {
  const body = {
    format: CERTIFICATE_FORMAT,
    project: tiers.project,
    issuedAt,
    issuedBy: issuedBy ?? null,
    scanTakenAt: snapshot.takenAt ?? null,
    hashes: {
      algorithm: 'SHA-256',
      scan: snapshotHash(snapshot),
      wall: wallStateHash(tiers),
      ledgerHead: ledgerHead?.hash ?? null,
    },
    ledger: ledgerHead ? { records: ledgerHead.seq + 1, headSeq: ledgerHead.seq } : null,
    counts: tiers.counts,
    sealed: tiers.sealed,
    drift: drift ? drift.summary : null,
  };
  return { ...body, certificateHash: sha256Hex(canonicalJson(body)) };
}

/** Recompute the certificate hash; true when the certificate has not been edited. */
export function verifyCertificate(certificate) {
  const { certificateHash, ...body } = certificate;
  return sha256Hex(canonicalJson(body)) === certificateHash;
}

// The wall service: raising a wall, reading a wall's state, and the scheduled check.
// Everything Jira- or storage-specific is injected (see index.js), so this runs in tests.

import {
  appendRecord,
  buildCertificate,
  crossingStatus,
  describeRoute,
  driftFlagInputs,
  driftReport,
  ledgerState,
  raiseWallInputs,
  snapshotHash,
  verifyChain,
  wallStateHash,
  wallTiers,
} from '../engine/index.js';
import { readAuditChanges } from './audit.js';
import { path } from './jira.js';
import { compareWithJiraBrowse, scanProjects } from './scan.js';
import { ConflictError } from './store.js';

export class WallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WallError';
    this.code = code;
  }
}

const MINUTE = 60 * 1000;

function person(snapshot, accountId) {
  const user = snapshot.users.find((u) => u.accountId === accountId);
  return { accountId, displayName: user?.displayName ?? accountId, active: user?.active !== false, accountType: user?.accountType ?? 'atlassian' };
}

/** Tiers without the raw paths, for the UI and for Rovo. */
function viewTiers(tiers) {
  return {
    project: tiers.project,
    scheme: tiers.scheme,
    sealed: tiers.sealed,
    counts: tiers.counts,
    sharedScheme: tiers.sharedScheme,
    selfAdmit: tiers.selfAdmit,
    openings: tiers.openings,
    conditional: tiers.conditional,
    canSee: tiers.canSee.map(({ paths, ...rest }) => ({ ...rest, routeText: rest.routes.map(describeRoute) })),
    canChange: tiers.canChange.map((p) => ({ ...p, powers: p.powers.map(({ paths, ...rest }) => rest) })),
  };
}

/**
 * @param {{ jira: ReturnType<import('./jira.js').createJira>, store: any, now: () => string,
 *           appAccountId?: () => Promise<string|null> }} deps
 */
export function createWallService({ jira, store, now, appAccountId = async () => null }) {
  async function scan(projectKey, by) {
    const extra = [by, await appAccountId()].filter(Boolean);
    const snapshot = await scanProjects(jira, { projectKeys: [projectKey], takenAt: now(), extraAccountIds: extra });
    return { snapshot, tiers: wallTiers(snapshot, projectKey) };
  }

  async function append(records, input) {
    // One retry on a conflict: someone else appended first, so rebuild on top of their record.
    for (let attempt = 0; ; attempt += 1) {
      const record = appendRecord(records, input);
      try {
        await store.appendRecord(record);
        records.push(record);
        return record;
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt > 0) throw error;
        records.splice(0, records.length, ...(await store.readLedger(record.wallId)));
      }
    }
  }

  // Everyone who could see the project when the wall was raised has a baseline crossing,
  // so only changes since then need explaining.
  async function auditFor(wall, snapshot) {
    const from = new Date(new Date(wall.raisedAt).getTime() - MINUTE).toISOString();
    try {
      const audit = await readAuditChanges(jira, { snapshot, from, to: now() });
      return { ...audit, error: null };
    } catch (error) {
      return { changes: [], snapshot, read: 0, total: null, keysMapped: 0, error: { status: error.status ?? null, message: error.message } };
    }
  }

  return {
    /** Company-managed projects, with the ones already walled marked. */
    async candidateProjects() {
      const walled = new Set((await store.listWalls()).map((w) => w.projectKey));
      const { items, complete } = await jira.paged((startAt) => path`/rest/api/3/project/search?startAt=${startAt}&maxResults=${50}&orderBy=${'name'}`, { limit: 500 });
      return {
        complete,
        projects: items.map((p) => ({
          id: String(p.id),
          key: p.key,
          name: p.name,
          teamManaged: p.simplified === true || p.style === 'next-gen',
          walled: walled.has(p.key),
        })),
      };
    },

    async listWalls() {
      const walls = await store.listWalls();
      const out = [];
      for (const wall of walls) out.push({ ...wall, lastScan: await store.latestScan(wall.wallId) });
      return out;
    },

    /** Raise a wall: scan the project, and record everyone who can already see it as a baseline crossing. */
    async raiseWall({ projectKey, subject, codeName, identifiedAt, by }) {
      if (!by) throw new WallError('no-user', 'A wall is raised by a signed-in person.');
      const key = String(projectKey ?? '').trim().toUpperCase();
      if (!key) throw new WallError('no-project', 'Choose a project.');
      if ((await store.listWalls()).some((w) => w.projectKey === key)) throw new WallError('already-walled', `${key} already has a wall.`);
      const { snapshot, tiers } = await scan(key, by);
      if (!tiers.found) throw new WallError('no-project', tiers.reason);
      if (!tiers.analysable) throw new WallError('not-analysable', tiers.reason);
      const at = now();
      const records = [];
      for (const input of raiseWallInputs(tiers, { by, at, subject, codeName, identifiedAt: identifiedAt || undefined })) {
        await append(records, input);
      }
      await store.insertWall({ wallId: tiers.project.id, projectKey: tiers.project.key, subject: records[0].data.subject, codeName: records[0].data.codeName ?? null, status: 'raised', raisedAt: at, updatedAt: at });
      await store.saveScan({ wallId: tiers.project.id, takenAt: snapshot.takenAt, scanHash: snapshotHash(snapshot), wallHash: wallStateHash(tiers), summary: { counts: tiers.counts, drift: null } });
      return { wallId: tiers.project.id, projectKey: tiers.project.key, records: records.length, baseline: records.length - 1 };
    },

    /** Everything the wall page shows: tiers, ledger, verification, drift with attribution. */
    async wallView(wallId, { by } = {}) {
      const wall = await store.getWall(wallId);
      if (!wall) throw new WallError('no-wall', `No wall ${wallId}.`);
      const records = await store.readLedger(wall.wallId);
      const anchor = await store.getAnchor(wall.wallId);
      const verification = verifyChain(records, { anchor });
      const { snapshot, tiers } = await scan(wall.projectKey, by);
      const app = await appAccountId();
      const audit = await auditFor(wall, snapshot);
      const at = now();
      const drift = tiers.analysable
        ? driftReport({ tiers, records, at, changes: audit.changes, snapshot: audit.snapshot, ignoreAccountIds: app ? [app] : [] })
        : null;
      const state = ledgerState(records);
      const certificate = tiers.analysable
        ? buildCertificate({ snapshot, tiers, ledgerHead: verification.head, drift, issuedAt: at, issuedBy: by ?? null })
        : null;
      return {
        wall,
        at,
        tiers: tiers.analysable ? viewTiers(tiers) : { analysable: false, reason: tiers.reason },
        jiraCheck: tiers.analysable ? compareWithJiraBrowse(tiers, snapshot) : null,
        verification: { ok: verification.ok, length: verification.length, head: verification.head, anchored: verification.anchored, problems: verification.problems },
        crossings: state.crossings.map((c) => ({
          crossingId: c.crossingId,
          ...person(snapshot, c.accountId),
          route: c.route,
          routeText: describeRoute(c.route),
          reason: c.reason,
          function: c.function,
          approver: c.approverAccountId ? person(snapshot, c.approverAccountId) : null,
          obtainedAt: c.obtainedAt,
          expiresAt: c.expiresAt,
          acknowledgedAt: c.acknowledgedAt,
          endedAt: c.endedAt,
          baseline: c.baseline,
          status: crossingStatus(c, at),
        })),
        records: records.map((r) => ({ seq: r.seq, type: r.type, at: r.at, by: r.by, hash: r.hash })),
        drift,
        audit: { read: audit.read, keysMapped: audit.keysMapped, error: audit.error },
        problems: snapshot.problems,
        adminCheck: snapshot.adminCheck,
        certificate,
        appAccountId: app,
      };
    },

    /**
     * Delete a wall and its whole ledger. Irreversible; the caller must type the
     * project key. Jira itself is not changed: nobody loses access.
     */
    async deleteWall(wallId, { confirmKey, by }) {
      if (!by) throw new WallError('no-user', 'A wall is deleted by a signed-in person.');
      const wall = await store.getWall(wallId);
      if (!wall) throw new WallError('no-wall', `No wall ${wallId}.`);
      if (String(confirmKey ?? '').trim().toUpperCase() !== wall.projectKey) {
        throw new WallError('not-confirmed', `Type ${wall.projectKey} to delete this wall.`);
      }
      const records = (await store.readLedger(wall.wallId)).length;
      await store.deleteWall(wall.wallId);
      return { wallId: wall.wallId, projectKey: wall.projectKey, recordsDeleted: records };
    },

    /** The scheduled check: for every raised wall, flag new unrecorded crossings in its ledger. */
    async checkWalls() {
      const results = [];
      const app = await appAccountId();
      for (const wall of await store.listWalls()) {
        if (wall.status !== 'raised') continue;
        try {
          const records = await store.readLedger(wall.wallId);
          const { snapshot, tiers } = await scan(wall.projectKey, null);
          if (!tiers.analysable) {
            results.push({ wallId: wall.wallId, skipped: tiers.reason });
            continue;
          }
          const audit = await auditFor(wall, snapshot);
          const at = now();
          const drift = driftReport({ tiers, records, at, changes: audit.changes, snapshot: audit.snapshot, ignoreAccountIds: app ? [app] : [] });
          const flags = driftFlagInputs(drift, records, { by: app ?? 'wall' });
          for (const input of flags) await append(records, input);
          await store.saveScan({ wallId: wall.wallId, takenAt: snapshot.takenAt, scanHash: snapshotHash(snapshot), wallHash: wallStateHash(tiers), summary: { counts: tiers.counts, drift: drift.summary } });
          await store.updateWall(wall.wallId, { status: wall.status, updatedAt: at });
          results.push({ wallId: wall.wallId, status: drift.status, flagged: flags.length });
        } catch (error) {
          results.push({ wallId: wall.wallId, error: error.message });
        }
      }
      return results;
    },
  };
}

// Scan-to-scan diff: effective access in chosen projects before and after.
//
// Drift against the ledger lives in drift.js; this module answers "what changed
// between two scans", which feeds the scheduled check and the attribution.

import { accessInProject, principalAccountId, principalKind } from './access.js';
import { describeClass } from './describe.js';
import { BROWSE, indexSnapshot, isAnalysable, permissionLabel } from './model.js';

/**
 * @typedef {{ projectKey: string, permission: string, permissionLabel: string, principal: string,
 *             kind: string, change: 'gained'|'lost', accountId: string|null, displayName: string }} DiffEntry
 */

/**
 * Compare effective access between two snapshots.
 * @param {import('./model.js').Snapshot} before
 * @param {import('./model.js').Snapshot} after
 * @param {{ projectKeys?: string[], permissions?: string[] }} [options]
 *   Defaults: every analysable project in either snapshot, Browse only.
 */
export function diffAccess(before, after, options = {}) {
  const b = indexSnapshot(before);
  const a = indexSnapshot(after);
  const permissions = options.permissions ?? [BROWSE];
  const keys =
    options.projectKeys ??
    [...new Set([...before.projects, ...after.projects].filter(isAnalysable).map((p) => p.key))].sort();

  const gained = [];
  const lost = [];
  const conditional = [];
  for (const key of keys) {
    const pb = b.projects.get(key);
    const pa = a.projects.get(key);
    for (const permission of permissions) {
      const hb = accessInProject(b, pb, permission);
      const ha = accessInProject(a, pa, permission);
      for (const principal of hb.keys()) {
        if (ha.has(principal)) continue;
        const entry = makeEntry(b, key, permission, principal, 'lost');
        (entry.kind === 'conditional' ? conditional : lost).push(entry);
      }
      for (const principal of ha.keys()) {
        if (hb.has(principal)) continue;
        const entry = makeEntry(a, key, permission, principal, 'gained');
        (entry.kind === 'conditional' ? conditional : gained).push(entry);
      }
    }
  }
  const sort = (x, y) =>
    x.projectKey.localeCompare(y.projectKey) || x.permission.localeCompare(y.permission) || x.principal.localeCompare(y.principal);
  gained.sort(sort);
  lost.sort(sort);
  conditional.sort(sort);
  return {
    gained,
    lost,
    conditional,
    summary: {
      gained: gained.length,
      lost: lost.length,
      conditional: conditional.length,
      projectsCompared: keys.length,
      unchanged: gained.length === 0 && lost.length === 0 && conditional.length === 0,
    },
  };
}

function makeEntry(index, projectKey, permission, principal, change) {
  const accountId = principalAccountId(principal);
  return {
    projectKey,
    permission,
    permissionLabel: permissionLabel(permission, index.snapshot),
    principal,
    kind: principalKind(principal),
    change,
    accountId,
    displayName: accountId ? index.users.get(accountId)?.displayName ?? accountId : describeClass(principal),
  };
}

/** One plain sentence for a diff entry. */
export function describeEntry(entry) {
  const verb = entry.change === 'gained' ? 'gained' : 'lost';
  return `${entry.displayName} ${verb} "${entry.permissionLabel}" in ${entry.projectKey}.`;
}

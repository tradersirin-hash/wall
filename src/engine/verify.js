// Checks against Jira's own permission check (POST /rest/api/3/permissions/check).
//
// The engine predicts, for a sampled account, whether it holds a permission in a
// project (and whether it is a Jira admin). Jira answers the same question.
// Agreement upgrades the evidence to Confirmed-by-Jira; disagreement is listed
// with the most likely reason.

import { accessInProject, globalHolders, userPrincipal } from './access.js';
import { BROWSE, Evidence, indexSnapshot, isAnalysable } from './model.js';

/**
 * Request body for the permission check of one account.
 * @param {import('./model.js').Snapshot} snapshot
 * @param {string} accountId
 * @param {{ permissions?: string[], projectKeys: string[], globalPermissions?: string[] }} query
 */
export function permissionCheckRequest(snapshot, accountId, { permissions = [BROWSE], projectKeys, globalPermissions = [] }) {
  const keys = new Set(projectKeys);
  const projects = snapshot.projects.filter((p) => keys.has(p.key) && isAnalysable(p)).map((p) => Number(p.id));
  const body = { accountId, projectPermissions: [{ permissions: [...permissions], projects }] };
  if (globalPermissions.length) body.globalPermissions = [...globalPermissions];
  return body;
}

/** What the snapshot predicts: permission -> { projectKey -> 'yes' | 'class' | 'no' }. */
export function predictAccess(snapshot, accountId, permissions, projectKeys) {
  const index = indexSnapshot(snapshot);
  const principal = userPrincipal(accountId);
  const out = {};
  for (const permission of permissions) {
    out[permission] = {};
    for (const key of projectKeys) {
      const project = index.projects.get(key);
      if (!project) continue;
      const holders = accessInProject(index, project, permission);
      if (holders.has(principal)) out[permission][key] = 'yes';
      else if ([...holders.keys()].some((p) => p.startsWith('class:'))) out[permission][key] = 'class';
      else out[permission][key] = 'no';
    }
  }
  return out;
}

/**
 * Compare the prediction with Jira's answer for one account.
 * @param {any} jiraResponse body of POST /rest/api/3/permissions/check
 */
export function compareWithJira(snapshot, accountId, { permissions = [BROWSE], projectKeys, globalPermissions = [] }, jiraResponse) {
  const prediction = predictAccess(snapshot, accountId, permissions, projectKeys);
  const idToKey = new Map(snapshot.projects.map((p) => [String(p.id), p.key]));
  const granted = {};
  for (const entry of jiraResponse?.projectPermissions ?? []) {
    granted[entry.permission] = new Set((entry.projects ?? []).map((id) => idToKey.get(String(id))).filter(Boolean));
  }
  const user = snapshot.users.find((u) => u.accountId === accountId);
  const confirmed = [];
  const mismatches = [];
  for (const permission of permissions) {
    for (const key of projectKeys) {
      const predicted = prediction[permission]?.[key];
      if (predicted === undefined) continue;
      const jiraSays = granted[permission]?.has(key) ?? false;
      if (predicted === 'yes' && jiraSays) confirmed.push({ permission, projectKey: key, has: true });
      else if (predicted === 'no' && !jiraSays) confirmed.push({ permission, projectKey: key, has: false });
      else if (predicted === 'class') confirmed.push({ permission, projectKey: key, has: jiraSays, throughClass: true });
      else mismatches.push({ permission, projectKey: key, predicted, jira: jiraSays, likelyReason: mismatchReason(predicted, jiraSays, user) });
    }
  }

  const index = indexSnapshot(snapshot);
  const jiraGlobal = new Set(jiraResponse?.globalPermissions ?? []);
  const globalChecks = [];
  for (const permission of globalPermissions) {
    const predicted = globalHolders(index, permission).has(userPrincipal(accountId));
    const has = jiraGlobal.has(permission);
    globalChecks.push({ accountId, permission, has, predicted, agrees: predicted === has });
    if (predicted && !has) {
      mismatches.push({ permission, projectKey: null, predicted: 'yes', jira: false, likelyReason: mismatchReason('yes', false, user) });
    }
  }

  return {
    accountId,
    evidence: mismatches.length === 0 ? Evidence.CONFIRMED_BY_JIRA : Evidence.PROVEN_STATIC,
    checked: confirmed.length + mismatches.length,
    confirmed,
    mismatches,
    globalChecks,
  };
}

function mismatchReason(predicted, jiraSays, user) {
  if (predicted === 'yes' && !jiraSays) {
    if (user?.active === false) return 'The account is inactive.';
    return 'The account may lack product access, or the scan is older than the change in Jira.';
  }
  return 'Jira grants it through something the scan does not hold (for example a newer change, a global grant or product access).';
}

/**
 * Store the global answers of a permission check in a snapshot, so Jira admins
 * that the scan could not see through group grants still appear in tier 2.
 * Returns a new snapshot; the input is not changed.
 */
export function withGlobalChecks(snapshot, checks, checkedAt) {
  const kept = (snapshot.globalChecks ?? []).filter(
    (c) => !checks.some((n) => n.accountId === c.accountId && n.permission === c.permission),
  );
  const added = checks.map((c) => ({ accountId: c.accountId, permission: c.permission, has: c.has, checkedAt: checkedAt ?? null }));
  return { ...snapshot, globalChecks: [...kept, ...added] };
}

/**
 * Pick accounts to verify with Jira: tier 2 people first (the admins), then tier 1
 * people, up to `limit`. Deterministic so the record can be reproduced.
 */
export function sampleAccounts(tiers, limit = 10) {
  const picked = [];
  const add = (id) => {
    if (id && !picked.includes(id) && picked.length < limit) picked.push(id);
  };
  for (const p of tiers.canChange ?? []) add(p.accountId);
  for (const p of tiers.canSee ?? []) add(p.accountId);
  return picked;
}

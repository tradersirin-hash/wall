// Effective access: who holds a permission in a project, and by which path.
//
// Principals are strings so that sets can be compared cheaply:
//   user:<accountId>            a concrete account
//   class:anyone                anyone, including anonymous visitors
//   class:logged-in             any logged-in user (application role without a key)
//   class:app-role:<key>        users with access to one product
//   cond:reporter, cond:assignee
//   cond:user-field:<id>, cond:group-field:<id>, cond:portal-customer
//   unknown:<type>:<parameter>  a holder type Wall does not model

import { Evidence, HolderType, indexSnapshot, isAnalysable, resolveGroup, resolveProject, strongerEvidence } from './model.js';

/** @typedef {import('./model.js').Snapshot} Snapshot */

/**
 * One way a principal reaches a permission.
 * @typedef {{ evidence: string, steps: Step[] }} Path
 * @typedef {{ kind: string, [k: string]: any }} Step
 * @typedef {{ principal: string, evidence: string, paths: Path[] }} Holding
 */

export function userPrincipal(accountId) {
  return `user:${accountId}`;
}

export function principalAccountId(principal) {
  return principal.startsWith('user:') ? principal.slice(5) : null;
}

/** Classify a principal for display and for the diff buckets. */
export function principalKind(principal) {
  if (principal.startsWith('user:')) return 'user';
  if (principal.startsWith('class:')) return 'class';
  if (principal.startsWith('cond:')) return 'conditional';
  return 'unknown';
}

function holderParam(holder) {
  return holder.value ?? holder.parameter;
}

function addPath(out, principal, path) {
  const existing = out.get(principal);
  if (existing) {
    existing.paths.push(path);
    existing.evidence = strongerEvidence(existing.evidence, path.evidence);
  } else {
    out.set(principal, { principal, evidence: path.evidence, paths: [path] });
  }
}

function expandActors(index, actors, roleStep, grantStep, out) {
  for (const accountId of actors?.userIds ?? []) {
    addPath(out, userPrincipal(accountId), {
      evidence: Evidence.PROVEN_STATIC,
      steps: [{ ...roleStep, via: 'user' }, grantStep],
    });
  }
  for (const groupId of actors?.groupIds ?? []) {
    const group = resolveGroup(index, groupId);
    for (const accountId of group?.memberIds ?? []) {
      addPath(out, userPrincipal(accountId), {
        evidence: Evidence.PROVEN_STATIC,
        steps: [
          { kind: 'member', groupId: group.groupId, groupName: group.name },
          { ...roleStep, via: 'group', groupId: group.groupId, groupName: group.name },
          grantStep,
        ],
      });
    }
  }
}

/**
 * Add every principal that one grant reaches in one project.
 * @param {ReturnType<typeof indexSnapshot>} index
 */
export function expandGrant(index, project, scheme, grant, out) {
  const holder = grant.holder;
  const param = holderParam(holder);
  const grantStep = {
    kind: 'grant',
    schemeId: String(scheme.id),
    schemeName: scheme.name,
    grantId: String(grant.id),
    permission: grant.permission,
    holderType: holder.type,
  };
  const single = (principal, evidence, extra = []) => addPath(out, principal, { evidence, steps: [...extra, grantStep] });

  switch (holder.type) {
    case HolderType.USER:
      single(userPrincipal(param), Evidence.PROVEN_STATIC, [{ kind: 'direct', accountId: param }]);
      break;
    case HolderType.GROUP: {
      const group = resolveGroup(index, holder.value) ?? resolveGroup(index, holder.parameter);
      for (const accountId of group?.memberIds ?? []) {
        single(userPrincipal(accountId), Evidence.PROVEN_STATIC, [
          { kind: 'member', groupId: group.groupId, groupName: group.name },
        ]);
      }
      break;
    }
    case HolderType.PROJECT_ROLE: {
      const roleId = String(param);
      const role = index.roles.get(roleId);
      const roleStep = { kind: 'role', roleId, roleName: role?.name ?? roleId, projectKey: project.key };
      expandActors(index, project.roleActors?.[roleId], roleStep, grantStep, out);
      break;
    }
    case HolderType.PROJECT_LEAD:
      if (project.leadAccountId) {
        single(userPrincipal(project.leadAccountId), Evidence.PROVEN_STATIC, [
          { kind: 'lead', projectKey: project.key, accountId: project.leadAccountId },
        ]);
      }
      break;
    case HolderType.ANYONE:
      single('class:anyone', Evidence.PROVEN_STATIC, [{ kind: 'class', name: 'anyone' }]);
      break;
    case HolderType.APPLICATION_ROLE:
      if (param) {
        single(`class:app-role:${param}`, Evidence.UNKNOWN, [{ kind: 'class', name: 'app-role', key: param }]);
      } else {
        single('class:logged-in', Evidence.UNKNOWN, [{ kind: 'class', name: 'logged-in' }]);
      }
      break;
    case HolderType.REPORTER:
      single('cond:reporter', Evidence.CONDITIONAL, [{ kind: 'condition', name: 'reporter' }]);
      break;
    case HolderType.ASSIGNEE:
      single('cond:assignee', Evidence.CONDITIONAL, [{ kind: 'condition', name: 'assignee' }]);
      break;
    case HolderType.USER_CUSTOM_FIELD:
      single(`cond:user-field:${param}`, Evidence.CONDITIONAL, [{ kind: 'condition', name: 'user-field', field: param }]);
      break;
    case HolderType.GROUP_CUSTOM_FIELD:
      single(`cond:group-field:${param}`, Evidence.CONDITIONAL, [{ kind: 'condition', name: 'group-field', field: param }]);
      break;
    case HolderType.PORTAL_CUSTOMER:
      single('cond:portal-customer', Evidence.CONDITIONAL, [{ kind: 'condition', name: 'portal-customer' }]);
      break;
    default:
      single(`unknown:${holder.type}:${param ?? ''}`, Evidence.UNKNOWN, [{ kind: 'unknown', type: holder.type }]);
  }
}

/**
 * All principals holding `permission` in `project`, with their evidence and paths.
 * @returns {Map<string, Holding>}
 */
export function accessInProject(index, project, permission) {
  const out = new Map();
  if (!project || !isAnalysable(project)) return out;
  const scheme = index.schemes.get(String(project.schemeId));
  if (!scheme) return out;
  for (const grant of scheme.grants) {
    if (grant.permission === permission) expandGrant(index, project, scheme, grant, out);
  }
  return out;
}

/**
 * Holders of a global permission (for example ADMINISTER). Grants are listed in
 * `snapshot.globalGrants`; accounts confirmed by Jira's permission check are
 * listed in `snapshot.globalChecks` and upgrade or add a path.
 * @returns {Map<string, Holding>}
 */
export function globalHolders(index, permission) {
  const out = new Map();
  const snapshot = index.snapshot;
  for (const grant of snapshot.globalGrants ?? []) {
    if (grant.permission !== permission) continue;
    const step = { kind: 'global', permission, holderType: grant.holder.type };
    const param = holderParam(grant.holder);
    if (grant.holder.type === HolderType.GROUP) {
      const group = resolveGroup(index, param);
      for (const accountId of group?.memberIds ?? []) {
        addPath(out, userPrincipal(accountId), {
          evidence: Evidence.PROVEN_STATIC,
          steps: [{ kind: 'member', groupId: group.groupId, groupName: group.name }, step],
        });
      }
    } else if (grant.holder.type === HolderType.USER) {
      addPath(out, userPrincipal(param), { evidence: Evidence.PROVEN_STATIC, steps: [{ kind: 'direct', accountId: param }, step] });
    }
  }
  for (const check of snapshot.globalChecks ?? []) {
    if (check.permission !== permission || !check.has) continue;
    addPath(out, userPrincipal(check.accountId), {
      evidence: Evidence.CONFIRMED_BY_JIRA,
      steps: [{ kind: 'check', permission, checkedAt: check.checkedAt ?? null }],
    });
  }
  return out;
}

/** Every permission key that appears in any scheme of the snapshot. */
export function permissionKeys(snapshot) {
  const keys = new Set();
  for (const s of snapshot.schemes) for (const g of s.grants) keys.add(g.permission);
  return [...keys].sort();
}

/** Projects Wall cannot analyse, with the reason. */
export function unanalysableProjects(snapshot) {
  return snapshot.projects
    .filter((p) => !isAnalysable(p))
    .map((p) => ({ key: p.key, name: p.name, reason: 'Team-managed project: access is not set by a permission scheme' }));
}

/** Holders of `permission` in the project with this key, or an empty map. */
export function holdersOf(snapshot, projectKey, permission) {
  const index = indexSnapshot(snapshot);
  return accessInProject(index, resolveProject(index, projectKey), permission);
}

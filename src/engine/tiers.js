// The two tiers of a walled project.
//
// Tier 1, "can see": everyone who holds Browse projects in the project.
// Tier 2, "can change who sees": everyone who can put a person into tier 1:
//   - Jira admins (global Administer Jira): edit the permission scheme and any role;
//   - project admins (Administer projects): edit the members of the roles that grant Browse;
//   - whoever manages the groups that grant Browse (organization side, not visible to apps);
//   - organization admins, who can always give themselves product admin (not visible to apps).

import { accessInProject, globalHolders, principalAccountId, principalKind, unanalysableProjects } from './access.js';
import { describeClass, routesOf } from './describe.js';
import {
  ADMINISTER,
  ADMINISTER_PROJECTS,
  BROWSE,
  Evidence,
  HolderType,
  indexSnapshot,
  isAnalysable,
  projectsUsingScheme,
  resolveGroup,
  resolveProject,
  strongerEvidence,
} from './model.js';

export const Power = Object.freeze({
  EDIT_SCHEME: 'edit-permission-scheme',
  EDIT_ROLE_MEMBERS: 'edit-role-members',
  EDIT_GROUP_MEMBERS: 'edit-group-members',
  GRANT_SELF_ADMIN: 'grant-self-admin',
});

const POWER_TEXT = {
  [Power.EDIT_SCHEME]: 'can edit the permission scheme and any project role',
  [Power.EDIT_ROLE_MEMBERS]: 'can add people to the roles that grant Browse',
  [Power.EDIT_GROUP_MEMBERS]: 'can add people to the groups that grant Browse',
  [Power.GRANT_SELF_ADMIN]: 'can make themselves a Jira admin',
};

export function describePower(power) {
  return POWER_TEXT[power] ?? power;
}

/** Groups and roles through which Browse reaches people in the project. */
function browseContainers(index, project, scheme) {
  const roleIds = new Set();
  const groupIds = new Set();
  for (const grant of scheme.grants) {
    if (grant.permission !== BROWSE) continue;
    const param = grant.holder.value ?? grant.holder.parameter;
    if (grant.holder.type === HolderType.PROJECT_ROLE) {
      roleIds.add(String(param));
      for (const gid of project.roleActors?.[String(param)]?.groupIds ?? []) {
        const group = resolveGroup(index, gid);
        groupIds.add(group?.groupId ?? gid);
      }
    }
    if (grant.holder.type === HolderType.GROUP) {
      const group = resolveGroup(index, param);
      groupIds.add(group?.groupId ?? param);
    }
  }
  return {
    roles: [...roleIds].sort().map((id) => ({ roleId: id, roleName: index.roles.get(id)?.name ?? id })),
    groups: [...groupIds].sort().map((id) => ({ groupId: id, groupName: resolveGroup(index, id)?.name ?? id })),
  };
}

function personEntry(index, accountId) {
  const user = index.users.get(accountId);
  return {
    accountId,
    displayName: user?.displayName ?? accountId,
    active: user?.active !== false,
    accountType: user?.accountType ?? 'atlassian',
    known: Boolean(user),
  };
}

function addPower(map, principal, power, evidence, detail) {
  let entry = map.get(principal);
  if (!entry) {
    entry = { principal, evidence, powers: [] };
    map.set(principal, entry);
  }
  entry.evidence = strongerEvidence(entry.evidence, evidence);
  if (!entry.powers.some((p) => p.power === power)) entry.powers.push({ power, evidence, ...detail });
}

/**
 * Compute both tiers of one project.
 * @param {import('./model.js').Snapshot} snapshot
 * @param {string} projectKey key or id
 */
export function wallTiers(snapshot, projectKey) {
  const index = indexSnapshot(snapshot);
  const project = resolveProject(index, projectKey);
  if (!project) return { found: false, reason: `Project ${projectKey} is not in the snapshot.` };
  if (!isAnalysable(project)) {
    const why = unanalysableProjects(snapshot).find((p) => p.key === project.key)?.reason;
    return { found: true, analysable: false, projectKey: project.key, reason: why ?? 'Project cannot be analysed.' };
  }
  const scheme = index.schemes.get(String(project.schemeId));
  if (!scheme) {
    return { found: true, analysable: false, projectKey: project.key, reason: `Permission scheme ${project.schemeId} is not in the snapshot.` };
  }

  // Tier 1.
  const browse = accessInProject(index, project, BROWSE);
  const canSee = [];
  const openings = [];
  const conditional = [];
  for (const holding of browse.values()) {
    const kind = principalKind(holding.principal);
    if (kind === 'user') {
      canSee.push({
        principal: holding.principal,
        ...personEntry(index, principalAccountId(holding.principal)),
        evidence: holding.evidence,
        routes: routesOf(holding),
        paths: holding.paths,
      });
    } else if (kind === 'class' || kind === 'unknown') {
      openings.push({ principal: holding.principal, label: describeClass(holding.principal), tier: 'can-see', evidence: holding.evidence });
    } else {
      conditional.push({ principal: holding.principal, label: describeClass(holding.principal), evidence: holding.evidence });
    }
  }

  // Tier 2.
  const containers = browseContainers(index, project, scheme);
  const powers = new Map();
  for (const holding of globalHolders(index, ADMINISTER).values()) {
    addPower(powers, holding.principal, Power.EDIT_SCHEME, holding.evidence, { via: 'Administer Jira', paths: holding.paths });
  }
  const projectAdmins = accessInProject(index, project, ADMINISTER_PROJECTS);
  for (const holding of projectAdmins.values()) {
    const kind = principalKind(holding.principal);
    if (kind === 'class' || kind === 'unknown') {
      openings.push({ principal: holding.principal, label: describeClass(holding.principal), tier: 'can-change', evidence: holding.evidence });
      continue;
    }
    if (kind !== 'user' || containers.roles.length === 0) continue;
    addPower(powers, holding.principal, Power.EDIT_ROLE_MEMBERS, holding.evidence, {
      via: 'Administer projects',
      roles: containers.roles,
      paths: holding.paths,
    });
  }
  if (containers.groups.length) {
    addPower(powers, 'class:group-admins', Power.EDIT_GROUP_MEMBERS, Evidence.UNKNOWN, { groups: containers.groups });
  }
  addPower(powers, 'class:org-admins', Power.GRANT_SELF_ADMIN, Evidence.UNKNOWN, {});

  const seeIds = new Set(canSee.map((p) => p.accountId));
  const canChange = [...powers.values()].map((entry) => {
    const accountId = principalAccountId(entry.principal);
    const base = accountId ? personEntry(index, accountId) : { label: describeClass(entry.principal) };
    return { principal: entry.principal, ...base, evidence: entry.evidence, powers: entry.powers, canSee: accountId ? seeIds.has(accountId) : null };
  });

  const nameOf = (x) => x.displayName ?? x.label ?? x.principal;
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b)) || a.principal.localeCompare(b.principal);
  canSee.sort(byName);
  canChange.sort((a, b) => Number(Boolean(b.accountId)) - Number(Boolean(a.accountId)) || byName(a, b));
  openings.sort((a, b) => a.principal.localeCompare(b.principal));
  conditional.sort((a, b) => a.principal.localeCompare(b.principal));

  const selfAdmit = canChange.filter((p) => p.accountId && !p.canSee).map((p) => p.accountId);
  const sharedScheme = projectsUsingScheme(snapshot, scheme.id)
    .filter((p) => p.key !== project.key)
    .map((p) => p.key)
    .sort();

  return {
    found: true,
    analysable: true,
    project: { key: project.key, id: String(project.id), name: project.name ?? project.key },
    scheme: { id: String(scheme.id), name: scheme.name },
    canSee,
    canChange,
    openings,
    conditional,
    containers,
    selfAdmit,
    sharedScheme,
    counts: {
      canSee: canSee.length,
      canSeeInactive: canSee.filter((p) => !p.active).length,
      canSeeApps: canSee.filter((p) => p.accountType === 'app').length,
      canChangePeople: canChange.filter((p) => p.accountId).length,
      selfAdmit: selfAdmit.length,
      openings: openings.length,
    },
    sealed: openings.length === 0,
  };
}

/** Account ids in tier 1 (can see), as a sorted array. */
export function canSeeIds(tiers) {
  return (tiers.canSee ?? []).map((p) => p.accountId).sort();
}

// Core vocabulary and the indexed view of a snapshot.
//
// A snapshot is the normalised result of one scan of a Jira site. Every engine
// function takes a snapshot (plain JSON, safe to store in SQL) and never calls
// Jira itself. Jira's REST API says "project"; Jira's UI may say "space".

/**
 * @typedef {{ accountId: string, displayName?: string, active?: boolean, accountType?: string }} User
 * @typedef {{ groupId: string, name: string, memberIds: string[], complete?: boolean }} Group
 * @typedef {{ userIds: string[], groupIds: string[] }} Actors
 * @typedef {{ id: string, name: string, description?: string }} Role
 * @typedef {{ type: string, parameter?: string, value?: string }} Holder
 * @typedef {{ id: string, permission: string, holder: Holder }} Grant
 * @typedef {{ id: string, name: string, description?: string, grants: Grant[] }} Scheme
 * @typedef {{ id: string, key: string, name?: string, style?: string, schemeId: string|null,
 *             leadAccountId?: string, roleActors?: Record<string, Actors> }} Project
 * @typedef {{ accountId: string, permission: string, has: boolean, checkedAt?: string }} GlobalCheck
 * @typedef {{ version?: number, takenAt?: string, users: User[], groups: Group[], roles: Role[],
 *             schemes: Scheme[], projects: Project[], globalGrants?: Grant[],
 *             globalChecks?: GlobalCheck[], permissions?: { key: string, name?: string }[] }} Snapshot
 */

/** Project permission that decides who can see a project. */
export const BROWSE = 'BROWSE_PROJECTS';

/** Project permission that lets a holder manage the project's role members. */
export const ADMINISTER_PROJECTS = 'ADMINISTER_PROJECTS';

/** Global permission "Administer Jira": edit permission schemes, roles and project settings. */
export const ADMINISTER = 'ADMINISTER';

/**
 * How Wall knows a fact. Access paths use the first four, ordered by strength.
 * Recorded and Observed are separate axes: the ledger and the Teamwork Graph.
 */
export const Evidence = Object.freeze({
  CONFIRMED_BY_JIRA: 'confirmed-by-jira',
  PROVEN_STATIC: 'proven-static',
  CONDITIONAL: 'conditional',
  UNKNOWN: 'unknown',
  RECORDED: 'recorded',
  OBSERVED: 'observed',
});

const EVIDENCE_STRENGTH = {
  [Evidence.CONFIRMED_BY_JIRA]: 3,
  [Evidence.PROVEN_STATIC]: 2,
  [Evidence.CONDITIONAL]: 1,
  [Evidence.UNKNOWN]: 0,
};

function strength(level) {
  return EVIDENCE_STRENGTH[level] ?? -1;
}

/** The weaker of two access evidence levels (a path is only as strong as its weakest step). */
export function weakerEvidence(a, b) {
  return strength(a) <= strength(b) ? a : b;
}

/** The stronger of two access evidence levels (a principal is as strong as its best path). */
export function strongerEvidence(a, b) {
  return strength(a) >= strength(b) ? a : b;
}

export const HolderType = Object.freeze({
  ANYONE: 'anyone',
  APPLICATION_ROLE: 'applicationRole',
  ASSIGNEE: 'assignee',
  GROUP: 'group',
  GROUP_CUSTOM_FIELD: 'groupCustomField',
  PROJECT_LEAD: 'projectLead',
  PROJECT_ROLE: 'projectRole',
  REPORTER: 'reporter',
  PORTAL_CUSTOMER: 'sd.customer.portal.only',
  USER: 'user',
  USER_CUSTOM_FIELD: 'userCustomField',
});

/** Groups that hold app (non-human) accounts. */
export const NON_HUMAN_GROUPS = new Set(['atlassian-addons-admin', 'atlassian-addons']);

/** Project styles Wall can analyse. Team-managed projects have no permission scheme. */
export const ANALYSABLE_STYLES = new Set(['classic', 'company-managed', undefined, null, '']);

const PERMISSION_LABELS = {
  ADMINISTER: 'Administer Jira',
  ADMINISTER_PROJECTS: 'Administer projects',
  BROWSE_PROJECTS: 'Browse projects',
  CREATE_ISSUES: 'Create work items',
  EDIT_ISSUES: 'Edit work items',
  DELETE_ISSUES: 'Delete work items',
  ASSIGN_ISSUES: 'Assign work items',
  ASSIGNABLE_USER: 'Assignable user',
  TRANSITION_ISSUES: 'Transition work items',
  ADD_COMMENTS: 'Add comments',
  SET_ISSUE_SECURITY: 'Set work item security',
};

/** A readable label for a permission key, preferring the names stored in the snapshot. */
export function permissionLabel(key, snapshot) {
  const stored = snapshot?.permissions?.find((p) => p.key === key)?.name;
  if (stored) return stored;
  if (PERMISSION_LABELS[key]) return PERMISSION_LABELS[key];
  const words = key.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True when the project can be analysed (company-managed). */
export function isAnalysable(project) {
  return ANALYSABLE_STYLES.has(project.style) && project.schemeId != null;
}

/**
 * Build lookup maps over a snapshot. Cheap; call once per engine operation.
 * @param {Snapshot} snapshot
 */
export function indexSnapshot(snapshot) {
  const users = new Map(snapshot.users.map((u) => [u.accountId, u]));
  const groups = new Map(snapshot.groups.map((g) => [g.groupId, g]));
  const groupsByName = new Map(snapshot.groups.map((g) => [g.name, g]));
  const roles = new Map(snapshot.roles.map((r) => [String(r.id), r]));
  const rolesByName = new Map(snapshot.roles.map((r) => [r.name, r]));
  const schemes = new Map(snapshot.schemes.map((s) => [String(s.id), s]));
  const projects = new Map(snapshot.projects.map((p) => [p.key, p]));
  const projectsById = new Map(snapshot.projects.map((p) => [String(p.id), p]));
  const memberships = new Map();
  for (const g of snapshot.groups) {
    for (const id of g.memberIds) {
      if (!memberships.has(id)) memberships.set(id, new Set());
      memberships.get(id).add(g.groupId);
    }
  }
  return { snapshot, users, groups, groupsByName, roles, rolesByName, schemes, projects, projectsById, memberships };
}

/** Resolve the group a grant or actor refers to, by id first and then by name. */
export function resolveGroup(index, idOrName) {
  if (idOrName == null) return undefined;
  return index.groups.get(idOrName) ?? index.groupsByName.get(idOrName);
}

/** Resolve a project by key or id. */
export function resolveProject(index, keyOrId) {
  if (keyOrId == null) return undefined;
  return index.projects.get(keyOrId) ?? index.projectsById.get(String(keyOrId));
}

/** Analysable projects that use the given scheme. */
export function projectsUsingScheme(snapshot, schemeId) {
  return snapshot.projects.filter((p) => String(p.schemeId) === String(schemeId) && isAnalysable(p));
}

/** A stable identifier for a holder, used to compare grants. */
export function holderKey(holder) {
  return `${holder.type}:${holder.value ?? holder.parameter ?? ''}`;
}

/**
 * Normalise a timestamp to ISO 8601 UTC with milliseconds ("2026-12-03T14:02:00.000Z").
 * Accepts Jira's "+0000" offsets. Returns null for empty input; throws on garbage.
 */
export function isoTime(value) {
  if (value == null || value === '') return null;
  const text = typeof value === 'string' ? value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : value;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a valid time: ${value}`);
  return date.toISOString();
}

/** A display name for an account, falling back to the account id. */
export function displayNameOf(index, accountId) {
  return index.users.get(accountId)?.displayName ?? accountId;
}

// Audit-log attribution: who made the change that let a person over the wall.
//
// Input is the `records` array of GET /rest/api/3/auditing/record. Jira does not
// document the summary strings it writes, so the classification lives in one
// rule table (AUDIT_RULES). What a Jira Cloud site wrote on 21 November 2026:
//   - summaries are English ("User added to group", "User removed from group",
//     "Project roles changed", "User removed from project", "Permission scheme
//     updated", "Permission scheme added to project", "Permission scheme copied",
//     "Group created"), but `category` and some values (a grant's Type) follow the
//     reader's language, so rules never use them;
//   - adding someone on a project's People screen is a "Project roles changed"
//     record; removing them there is "User removed from project" (PROJECT item, the
//     user by key);
//   - a scheme grant is "Permission scheme updated" with changedValues Permission,
//     Type and Value ("" to "Browse Projects", "" to the group name); a scheme switch
//     is "Permission scheme added to project" with the new SCHEME as associated item;
//   - role changes: objectItem PROJECT_ROLE with id, associatedItems PROJECT with
//     id and name, one changedValues entry per record ("Users", account id in
//     changedTo for an addition or changedFrom for a removal), author account id;
//   - group membership: objectItem GROUP with a name and no id, associatedItems USER
//     whose id is the user's key (not the account id); a change made through Jira's
//     REST API is written twice, once with the author and once, a second later,
//     without one (a mirror from the identity platform).

import { describeRoute, routeKey } from './describe.js';
import { indexSnapshot, isoTime, resolveGroup } from './model.js';

export const ChangeKind = Object.freeze({
  GROUP_MEMBER_ADDED: 'group-member-added',
  GROUP_MEMBER_REMOVED: 'group-member-removed',
  ROLE_ACTORS_CHANGED: 'role-actors-changed',
  PROJECT_ACCESS_ADDED: 'project-access-added',
  PROJECT_ACCESS_REMOVED: 'project-access-removed',
  SCHEME_CHANGED: 'permission-scheme-changed',
  PROJECT_SCHEME_CHANGED: 'project-scheme-changed',
  PROJECT_LEAD_CHANGED: 'project-lead-changed',
  OTHER: 'other',
});

/**
 * Ordered rules: the first match wins. `summary` is tested case-insensitively;
 * `types` lists item types of which at least one must be present.
 */
export const AUDIT_RULES = [
  { kind: ChangeKind.GROUP_MEMBER_ADDED, summary: /(user|member)s? (was |were )?added to (a )?group|added (a )?(user|member)s? to (a )?group/i },
  { kind: ChangeKind.GROUP_MEMBER_REMOVED, summary: /(user|member)s? (was |were )?removed from (a )?group|removed (a )?(user|member)s? from (a )?group/i },
  { kind: ChangeKind.PROJECT_ACCESS_REMOVED, summary: /user removed from project/i, types: ['PROJECT'] },
  { kind: ChangeKind.PROJECT_ACCESS_ADDED, summary: /user added to project/i, types: ['PROJECT'] },
  { kind: ChangeKind.ROLE_ACTORS_CHANGED, summary: /project role|role (actors?|members?)/i, types: ['PROJECT_ROLE', 'PROJECT'] },
  { kind: ChangeKind.PROJECT_SCHEME_CHANGED, summary: /permission scheme.*(project|associat)|project.*permission scheme/i, types: ['PROJECT'] },
  { kind: ChangeKind.SCHEME_CHANGED, summary: /permission/i, types: ['PERMISSION_SCHEME', 'SCHEME'] },
  { kind: ChangeKind.PROJECT_LEAD_CHANGED, summary: /project (updated|lead)|lead changed/i, types: ['PROJECT'], fields: /lead/i },
];

/**
 * Changes made in Atlassian Administration (for example group membership) reach
 * Jira's audit log with the author shown as "JIRA": the real person is only in
 * the organization audit log, which apps cannot read. Such changes have no actor.
 */
function visibleActor(authorAccountId) {
  if (authorAccountId == null || authorAccountId === '') return null;
  return /^jira$/i.test(String(authorAccountId)) ? null : String(authorAccountId);
}

function items(record) {
  return [record.objectItem, ...(record.associatedItems ?? [])].filter(Boolean);
}

function itemsOfType(record, ...types) {
  const wanted = new Set(types);
  return items(record).filter((i) => wanted.has(String(i.typeName ?? '').toUpperCase()));
}

function splitList(value) {
  if (value == null || value === '') return [];
  return String(value)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve a user mentioned in an audit record (by account id, then user key, then display name). */
function userRef(index, idOrName, name) {
  const byId = idOrName ? index.users.get(idOrName) ?? index.usersByKey.get(idOrName) : undefined;
  if (byId) return { accountId: byId.accountId, name: byId.displayName ?? byId.accountId };
  const label = name ?? idOrName;
  const matches = index.snapshot.users.filter((u) => u.displayName === label);
  if (matches.length === 1) return { accountId: matches[0].accountId, name: label };
  return { accountId: null, key: idOrName ?? null, name: label ?? null, ambiguous: matches.length > 1 };
}

function groupRef(index, idOrName, name) {
  const group = resolveGroup(index, idOrName) ?? resolveGroup(index, name);
  return { groupId: group?.groupId ?? null, groupName: group?.name ?? name ?? idOrName ?? null };
}

function classify(record) {
  const summary = String(record.summary ?? '');
  const types = new Set(items(record).map((i) => String(i.typeName ?? '').toUpperCase()));
  const fields = (record.changedValues ?? []).map((c) => String(c.fieldName ?? '')).join(' ');
  for (const rule of AUDIT_RULES) {
    if (!rule.summary.test(summary)) continue;
    if (rule.types && !rule.types.some((t) => types.has(t))) continue;
    if (rule.fields && !rule.fields.test(fields) && !/lead/i.test(summary)) continue;
    return rule.kind;
  }
  return ChangeKind.OTHER;
}

function listDelta(changedValues, fieldPattern) {
  const added = [];
  const removed = [];
  for (const c of changedValues ?? []) {
    if (!fieldPattern.test(String(c.fieldName ?? ''))) continue;
    const from = new Set(splitList(c.changedFrom));
    const to = new Set(splitList(c.changedTo));
    for (const v of to) if (!from.has(v)) added.push(v);
    for (const v of from) if (!to.has(v)) removed.push(v);
  }
  return { added, removed };
}

/** The grant a "Permission scheme updated" record adds or removes, from its Permission, Type and Value fields. */
function schemeGrant(changedValues) {
  const field = (pattern) => (changedValues ?? []).find((c) => pattern.test(String(c.fieldName ?? '')));
  const value = field(/^value$/i);
  if (!value) return null;
  const permission = field(/^permission$/i);
  const type = field(/^type$/i);
  const added = Boolean(value.changedTo) && !value.changedFrom;
  return {
    change: added ? 'added' : 'removed',
    permission: (added ? permission?.changedTo : permission?.changedFrom) ?? null,
    type: (added ? type?.changedTo : type?.changedFrom) ?? null,
    value: (added ? value.changedTo : value.changedFrom) ?? null,
  };
}

/**
 * Turn one audit record into a change Wall can match against an access route.
 * @param {any} record one element of `records` from GET /rest/api/3/auditing/record
 * @param {ReturnType<typeof indexSnapshot>} index
 */
export function normaliseAuditRecord(record, index) {
  const kind = classify(record);
  const change = {
    id: String(record.id),
    at: isoTime(record.created),
    actorAccountId: visibleActor(record.authorAccountId),
    authorKey: record.authorKey ?? null,
    summary: record.summary ?? '',
    category: record.category ?? null,
    kind,
    users: { added: [], removed: [] },
    groups: { added: [], removed: [] },
    group: null,
    role: null,
    project: null,
    scheme: null,
  };
  const project = itemsOfType(record, 'PROJECT')[0];
  if (project) change.project = { id: project.id != null ? String(project.id) : null, name: project.name ?? null };
  const role = itemsOfType(record, 'PROJECT_ROLE')[0];
  if (role) change.role = { roleId: role.id != null ? String(role.id) : null, roleName: role.name ?? null };
  const scheme = itemsOfType(record, 'PERMISSION_SCHEME', 'SCHEME')[0];
  if (scheme) change.scheme = { id: scheme.id != null ? String(scheme.id) : null, name: scheme.name ?? null };

  if (kind === ChangeKind.GROUP_MEMBER_ADDED || kind === ChangeKind.GROUP_MEMBER_REMOVED) {
    const group = itemsOfType(record, 'GROUP')[0];
    if (group) change.group = groupRef(index, group.id, group.name);
    const bucket = kind === ChangeKind.GROUP_MEMBER_ADDED ? change.users.added : change.users.removed;
    for (const u of itemsOfType(record, 'USER')) bucket.push(userRef(index, u.id, u.name));
  }
  if (kind === ChangeKind.ROLE_ACTORS_CHANGED) {
    const users = listDelta(record.changedValues, /user/i);
    const groups = listDelta(record.changedValues, /group/i);
    change.users.added = users.added.map((v) => userRef(index, v, v));
    change.users.removed = users.removed.map((v) => userRef(index, v, v));
    change.groups.added = groups.added.map((v) => groupRef(index, v, v));
    change.groups.removed = groups.removed.map((v) => groupRef(index, v, v));
  }
  if (kind === ChangeKind.PROJECT_ACCESS_ADDED || kind === ChangeKind.PROJECT_ACCESS_REMOVED) {
    const bucket = kind === ChangeKind.PROJECT_ACCESS_ADDED ? change.users.added : change.users.removed;
    for (const u of itemsOfType(record, 'USER')) bucket.push(userRef(index, u.id, u.name));
  }
  if (kind === ChangeKind.SCHEME_CHANGED) {
    change.grant = schemeGrant(record.changedValues);
    if (change.grant?.value) {
      const groupsOut = change.grant.change === 'added' ? change.groups.added : change.groups.removed;
      const usersOut = change.grant.change === 'added' ? change.users.added : change.users.removed;
      const group = groupRef(index, change.grant.value, change.grant.value);
      if (group.groupId) groupsOut.push(group);
      const user = userRef(index, change.grant.value, change.grant.value);
      if (user.accountId) usersOut.push(user);
    }
  }
  return change;
}

const MIRROR_WINDOW_MS = 10 * 1000;

function sameUsers(a, b) {
  const ids = (list) => list.map((u) => u.accountId ?? u.key ?? u.name).sort().join(',');
  return ids(a.users.added) === ids(b.users.added) && ids(a.users.removed) === ids(b.users.removed);
}

/**
 * Mark the author-less copy that the identity platform writes after a group change
 * made through Jira's REST API, so it does not hide the copy that names the author.
 */
function markMirrors(changes) {
  for (const change of changes) {
    if (change.actorAccountId || (change.kind !== ChangeKind.GROUP_MEMBER_ADDED && change.kind !== ChangeKind.GROUP_MEMBER_REMOVED)) continue;
    const t = new Date(change.at).getTime();
    const original = changes.find(
      (other) =>
        other !== change &&
        other.actorAccountId &&
        other.kind === change.kind &&
        other.group?.groupName === change.group?.groupName &&
        sameUsers(other, change) &&
        t - new Date(other.at).getTime() >= 0 &&
        t - new Date(other.at).getTime() <= MIRROR_WINDOW_MS,
    );
    if (original) change.mirrorOf = original.id;
  }
  return changes;
}

/** Normalise and sort (oldest first) a page of audit records. Mirrors are kept but marked. */
export function normaliseAuditRecords(records, snapshot) {
  const index = indexSnapshot(snapshot);
  const changes = (records ?? []).map((r) => normaliseAuditRecord(r, index)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return markMirrors(changes);
}

function sameProject(change, project) {
  if (!change.project) return false;
  return change.project.id === String(project.id) || change.project.name === project.name || change.project.name === project.key;
}

function sameRole(change, route) {
  return change.role && (change.role.roleId === route.roleId || change.role.roleName === route.roleName);
}

function sameGroup(ref, route) {
  return ref && (ref.groupId === route.groupId || ref.groupName === route.groupName);
}

function namesUser(list, accountId) {
  return list.some((u) => u.accountId === accountId);
}

/** How well one change explains one route of one person: 'exact', 'partial' or null. */
export function matchChange(change, { accountId, route, project, schemeId }) {
  switch (change.kind) {
    case ChangeKind.GROUP_MEMBER_ADDED:
      if ((route.kind === 'group' || route.kind === 'role-group') && sameGroup(change.group, route)) {
        return namesUser(change.users.added, accountId) ? 'exact' : 'partial';
      }
      return null;
    case ChangeKind.ROLE_ACTORS_CHANGED:
      if (!sameProject(change, project) || !sameRole(change, route)) return null;
      if (route.kind === 'role') return namesUser(change.users.added, accountId) ? 'exact' : 'partial';
      if (route.kind === 'role-group') return change.groups.added.some((g) => sameGroup(g, route)) ? 'exact' : 'partial';
      return null;
    case ChangeKind.PROJECT_ACCESS_ADDED:
      if (!sameProject(change, project) || (route.kind !== 'role' && route.kind !== 'role-group')) return null;
      return namesUser(change.users.added, accountId) ? 'exact' : 'partial';
    case ChangeKind.SCHEME_CHANGED:
      if (change.scheme && change.scheme.id !== String(schemeId)) return null;
      if (change.grant) {
        // A known grant explains a route only if it added Browse for that very holder.
        if (change.grant.change !== 'added' || !/browse/i.test(change.grant.permission ?? '')) return null;
        if (route.kind === 'direct') return namesUser(change.users.added, accountId) ? 'exact' : null;
        if (route.kind === 'group') return change.groups.added.some((g) => sameGroup(g, route)) ? 'exact' : null;
        if (route.kind === 'role' || route.kind === 'role-group') return change.grant.value === route.roleName ? 'exact' : null;
        return null;
      }
      return change.scheme ? 'partial' : null;
    case ChangeKind.PROJECT_SCHEME_CHANGED:
      return sameProject(change, project) ? 'partial' : null;
    case ChangeKind.PROJECT_LEAD_CHANGED:
      return route.kind === 'lead' && sameProject(change, project) ? 'exact' : null;
    default:
      return null;
  }
}

const CONFIDENCE_RANK = { exact: 2, partial: 1 };

/**
 * Attribute one unrecorded crossing to the change most likely to have caused it.
 * @param {{ accountId: string, routes: any[] }} person a tier-1 entry
 * @param {any[]} changes normalised audit changes (see normaliseAuditRecords)
 * @param {{ project: { id: string, key: string, name?: string }, schemeId: string, until?: string, since?: string,
 *           snapshot?: any }} context
 */
export function attributeCrossing(person, changes, { project, schemeId, until, since, snapshot }) {
  const upper = isoTime(until);
  const lower = isoTime(since);
  const candidates = [];
  for (const change of changes) {
    if (change.mirrorOf) continue;
    if (upper && String(change.at) > upper) continue;
    if (lower && String(change.at) < lower) continue;
    for (const route of person.routes ?? []) {
      const confidence = matchChange(change, { accountId: person.accountId, route, project, schemeId });
      if (confidence) candidates.push({ confidence, change, route });
    }
  }
  candidates.sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || String(b.change.at).localeCompare(String(a.change.at)),
  );
  const best = candidates[0];
  if (!best) {
    return {
      found: false,
      confidence: 'none',
      candidates: [],
      sentence:
        'No matching record in the Jira audit log. The change may predate the audit window, or have been made outside Jira (for example in the organization admin or by directory sync).',
    };
  }
  const index = snapshot ? indexSnapshot(snapshot) : null;
  const actorVisible = Boolean(best.change.actorAccountId);
  const actorName = (index && index.users.get(best.change.actorAccountId)?.displayName) ?? best.change.actorAccountId;
  const personName = person.displayName ?? person.accountId;
  return {
    found: true,
    confidence: best.confidence,
    actorVisible,
    actorAccountId: best.change.actorAccountId,
    at: best.change.at,
    auditRecordId: best.change.id,
    route: best.route,
    routeKey: routeKey(best.route),
    selfAdmitted: actorVisible && best.change.actorAccountId === person.accountId,
    candidates: candidates.map((c) => ({ confidence: c.confidence, auditRecordId: c.change.id, at: c.change.at, routeKey: routeKey(c.route) })),
    sentence: sentenceFor(actorName, personName, best.change.actorAccountId === person.accountId, best),
  };
}

function sentenceFor(actorName, personName, self, { change, route, confidence }) {
  const when = `on ${String(change.at).slice(0, 16).replace('T', ' ')} UTC`;
  if (!actorName) {
    const what =
      change.kind === ChangeKind.GROUP_MEMBER_ADDED
        ? `${personName} was added to group "${route.groupName}"`
        : 'A change was made';
    return `${what} ${when} outside Jira (for example in Atlassian Administration), which gives access through ${describeRoute(route)}. Jira's audit log does not name who made it; the organization audit log does.`;
  }
  const who = self ? 'themselves' : personName;
  let what;
  switch (change.kind) {
    case ChangeKind.GROUP_MEMBER_ADDED:
      what = `${actorName} added ${who} to group "${route.groupName}"`;
      break;
    case ChangeKind.ROLE_ACTORS_CHANGED:
      what =
        route.kind === 'role-group'
          ? `${actorName} added group "${route.groupName}" to role "${route.roleName}"`
          : `${actorName} added ${who} to role "${route.roleName}"`;
      break;
    case ChangeKind.PROJECT_ACCESS_ADDED:
      what = `${actorName} added ${who} to the project`;
      break;
    case ChangeKind.SCHEME_CHANGED:
      what = change.grant?.value
        ? `${actorName} granted "${change.grant.permission}" to "${change.grant.value}" in permission scheme "${change.scheme?.name ?? change.scheme?.id}"`
        : `${actorName} changed the permission scheme`;
      break;
    case ChangeKind.PROJECT_SCHEME_CHANGED:
      what = `${actorName} switched the project to another permission scheme`;
      break;
    case ChangeKind.PROJECT_LEAD_CHANGED:
      what = `${actorName} made ${who} the project lead`;
      break;
    default:
      what = `${actorName} made a change`;
  }
  const hedge = confidence === 'partial' ? ' (the record does not name the person; this is the closest matching change)' : '';
  return `${what} ${when}, which gives access through ${describeRoute(route)}${hedge}.`;
}

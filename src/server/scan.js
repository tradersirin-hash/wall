// Scan: read what decides access to some projects into an engine snapshot.
//
// For each project: the project (lead, style), its permission scheme and grants,
// its roles and the actors of every role the Browse and Administer projects grants
// use, the members of every group those grants reach, and Jira's own list of who
// can browse it. Then Jira's permission check for "Administer Jira" on every
// person found, on the members of groups whose name says "admin", and on extra
// accounts such as the caller and Wall's own account. Jira has no API that lists
// its admins, so an admin who gets the right through some other group can be
// missed; the result says how many accounts were checked.

import { ADMINISTER, ADMINISTER_PROJECTS, BROWSE, HolderType } from '../engine/model.js';
import { path } from './jira.js';

const RELEVANT = new Set([BROWSE, ADMINISTER_PROJECTS]);
const GROUP_MEMBER_LIMIT = 1000;
const ADMIN_GROUP = /admin/i;
const CHECK_BATCH = 10;

function roleIdFromUrl(url) {
  const match = String(url).match(/\/role\/(\d+)\/?$/);
  return match ? match[1] : null;
}

function styleOf(project) {
  if (project.simplified === true || project.style === 'next-gen') return 'next-gen';
  return project.style ?? 'classic';
}

/**
 * @param {ReturnType<import('./jira.js').createJira>} jira
 * @param {{ projectKeys: string[], takenAt: string, extraAccountIds?: string[], adminCheckLimit?: number }} options
 */
export async function scanProjects(jira, { projectKeys, takenAt, extraAccountIds = [], adminCheckLimit = 100, discoverAdmins = true }) {
  const users = new Map();
  const groups = new Map();
  const roles = new Map();
  const schemes = new Map();
  const projects = [];
  const jiraBrowse = {};
  const problems = [];

  const addUser = (u) => {
    if (!u?.accountId) return;
    const known = users.get(u.accountId) ?? {};
    users.set(u.accountId, {
      accountId: u.accountId,
      displayName: u.displayName ?? known.displayName ?? u.accountId,
      active: u.active ?? known.active ?? true,
      accountType: u.accountType ?? known.accountType ?? 'atlassian',
    });
  };
  const wantGroup = (groupId, name) => {
    if (!groupId && !name) return;
    const key = groupId ?? `name:${name}`;
    if (!groups.has(key)) groups.set(key, { groupId: groupId ?? key, name: name ?? groupId, memberIds: [], complete: true, pending: true });
  };

  for (const projectKey of projectKeys) {
    const project = await jira.get(path`/rest/api/3/project/${projectKey}?expand=${'lead'}`);
    const style = styleOf(project);
    const entry = { id: String(project.id), key: project.key, name: project.name, style, schemeId: null, leadAccountId: project.lead?.accountId, roleActors: {} };
    projects.push(entry);
    if (project.lead) addUser(project.lead);
    if (style === 'next-gen') continue;

    const scheme = await jira.get(path`/rest/api/3/project/${project.key}/permissionscheme`);
    entry.schemeId = String(scheme.id);
    if (!schemes.has(entry.schemeId)) {
      const grants = await jira.get(path`/rest/api/3/permissionscheme/${scheme.id}/permission`);
      schemes.set(entry.schemeId, {
        id: entry.schemeId,
        name: scheme.name,
        grants: (grants?.permissions ?? []).map((g) => ({
          id: String(g.id),
          permission: g.permission,
          holder: { type: g.holder?.type, parameter: g.holder?.parameter, value: g.holder?.value },
        })),
      });
    }
    const grants = schemes.get(entry.schemeId).grants.filter((g) => RELEVANT.has(g.permission));

    const roleUrls = await jira.get(path`/rest/api/3/project/${project.key}/role`);
    for (const [name, url] of Object.entries(roleUrls ?? {})) {
      const id = roleIdFromUrl(url);
      if (id && !roles.has(id)) roles.set(id, { id, name });
    }

    const roleIds = new Set(grants.filter((g) => g.holder.type === HolderType.PROJECT_ROLE).map((g) => String(g.holder.parameter ?? g.holder.value)));
    for (const roleId of roleIds) {
      let role;
      try {
        role = await jira.get(path`/rest/api/3/project/${project.key}/role/${roleId}?excludeInactiveUsers=${'false'}`);
      } catch (error) {
        problems.push({ projectKey: project.key, what: `role ${roleId}`, status: error.status ?? null });
        continue;
      }
      if (role?.name && !roles.has(roleId)) roles.set(roleId, { id: roleId, name: role.name });
      const actors = { userIds: [], groupIds: [] };
      for (const actor of role?.actors ?? []) {
        if (actor.actorUser?.accountId) {
          actors.userIds.push(actor.actorUser.accountId);
          addUser({ accountId: actor.actorUser.accountId, displayName: actor.displayName });
        } else if (actor.actorGroup) {
          const groupId = actor.actorGroup.groupId ?? null;
          actors.groupIds.push(groupId ?? `name:${actor.actorGroup.name}`);
          wantGroup(groupId, actor.actorGroup.name);
        }
      }
      entry.roleActors[roleId] = actors;
    }

    for (const grant of grants.filter((g) => g.holder.type === HolderType.GROUP)) {
      wantGroup(grant.holder.value ?? null, grant.holder.parameter ?? null);
    }

    try {
      const browse = await jira.get(path`/rest/api/3/user/permission/search?permissions=${BROWSE}&projectKey=${project.key}&maxResults=${1000}`);
      jiraBrowse[project.key] = (browse ?? []).map((u) => u.accountId).filter(Boolean).sort();
      (browse ?? []).forEach(addUser);
    } catch (error) {
      problems.push({ projectKey: project.key, what: 'users with Browse', status: error.status ?? null });
    }
  }

  for (const group of groups.values()) {
    delete group.pending;
    if (String(group.groupId).startsWith('name:')) {
      problems.push({ what: `group ${group.name}`, status: null, note: 'No group id; members not read.' });
      group.complete = false;
      continue;
    }
    try {
      const { items, complete } = await jira.paged(
        (startAt) => path`/rest/api/3/group/member?groupId=${group.groupId}&includeInactiveUsers=${'true'}&startAt=${startAt}&maxResults=${50}`,
        { limit: GROUP_MEMBER_LIMIT },
      );
      group.memberIds = items.map((u) => u.accountId).filter(Boolean);
      group.complete = complete;
      items.forEach(addUser);
    } catch (error) {
      group.complete = false;
      problems.push({ what: `group ${group.name}`, status: error.status ?? null });
    }
  }

  const adminCandidates = [];
  if (discoverAdmins) {
    try {
      const { items } = await jira.paged((startAt) => path`/rest/api/3/group/bulk?startAt=${startAt}&maxResults=${50}`, { limit: 500 });
      for (const group of items.filter((g) => ADMIN_GROUP.test(g.name ?? ''))) {
        const { items: members } = await jira.paged(
          (startAt) => path`/rest/api/3/group/member?groupId=${group.groupId}&includeInactiveUsers=${'false'}&startAt=${startAt}&maxResults=${50}`,
          { limit: 200 },
        );
        for (const member of members) {
          addUser(member);
          adminCandidates.push(member.accountId);
        }
      }
    } catch (error) {
      problems.push({ what: 'admin groups', status: error.status ?? null });
    }
  }

  const everyone = [...new Set([...extraAccountIds.filter(Boolean), ...adminCandidates, ...users.keys()])];
  const candidates = everyone.slice(0, adminCheckLimit);
  // One permission check per account, ten at a time, to stay well inside an interactive call's time limit.
  const globalChecks = [];
  for (let i = 0; i < candidates.length; i += CHECK_BATCH) {
    const batch = candidates.slice(i, i + CHECK_BATCH);
    const answers = await Promise.all(
      batch.map((accountId) =>
        jira
          .post('/rest/api/3/permissions/check', { accountId, globalPermissions: [ADMINISTER] })
          .then((answer) => ({ accountId, has: (answer?.globalPermissions ?? []).includes(ADMINISTER) }))
          .catch((error) => ({ accountId, error })),
      ),
    );
    for (const answer of answers) {
      if (answer.error) problems.push({ what: `admin check ${answer.accountId}`, status: answer.error.status ?? null });
      else globalChecks.push({ accountId: answer.accountId, permission: ADMINISTER, has: answer.has, checkedAt: takenAt });
    }
  }
  const checkedAll = candidates.length === everyone.length;

  return {
    version: 1,
    takenAt,
    users: [...users.values()].sort((a, b) => a.accountId.localeCompare(b.accountId)),
    groups: [...groups.values()].sort((a, b) => String(a.groupId).localeCompare(String(b.groupId))),
    roles: [...roles.values()].sort((a, b) => a.id.localeCompare(b.id)),
    schemes: [...schemes.values()],
    projects,
    globalGrants: [],
    globalChecks,
    jiraBrowse,
    problems,
    adminCheck: { checked: candidates.length, complete: checkedAll },
  };
}

/** People Jira says can browse a project but the scan's model does not, and the reverse. */
export function compareWithJiraBrowse(tiers, snapshot) {
  const jira = new Set(snapshot.jiraBrowse?.[tiers.project.key] ?? []);
  const model = new Set(tiers.canSee.filter((p) => !p.fromJiraList).map((p) => p.accountId));
  return {
    confirmed: [...model].filter((id) => jira.has(id)).sort(),
    onlyInModel: [...model].filter((id) => !jira.has(id)).sort(),
    onlyInJira: [...jira].filter((id) => !model.has(id)).sort(),
    available: Boolean(snapshot.jiraBrowse && tiers.project.key in snapshot.jiraBrowse),
  };
}

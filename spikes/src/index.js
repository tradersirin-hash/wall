// Wall spike: backend.
//
// Every check runs the same Jira call as the app (asApp) and as the signed-in
// admin (asUser) and returns the raw status and body, so the page shows exactly
// what Jira answered. Each check also writes one "WALL-SPIKE" line to the Forge
// logs (read them with: npx --no-install forge logs -e development).
//
// Writes are limited to adding the target account to one project role (and,
// if a group is given, to one group) and removing it again straight away.

import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };
const MAX_BODY = 20000;

function caller(as) {
  return as === 'user' ? api.asUser() : api.asApp();
}

async function read(response) {
  const type = response.headers.get('content-type') ?? '';
  let body;
  try {
    body = type.includes('json') ? await response.json() : await response.text();
  } catch (error) {
    body = `unreadable body: ${error.message}`;
  }
  return { status: response.status, ok: response.ok, body };
}

async function jira(as, path, init) {
  try {
    return await read(await caller(as).requestJira(path, init));
  } catch (error) {
    return { status: 0, ok: false, body: `request failed: ${error.message}` };
  }
}

async function both(fn) {
  return { app: await fn('app'), user: await fn('user') };
}

function trim(value) {
  const text = JSON.stringify(value);
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}... (${text.length} chars)` : value;
}

function log(name, summary) {
  console.log(`WALL-SPIKE ${name} ${JSON.stringify(summary)}`);
}

const statuses = (pair) => ({ app: pair.app.status, user: pair.user.status });

// ---------------------------------------------------------------------------
// Identity: who is the app, who is the caller, which site.

resolver.define('checkIdentity', async ({ context }) => {
  const me = await both((as) => jira(as, route`/rest/api/3/myself`));
  const result = {
    callerAccountId: context.accountId,
    cloudId: context.cloudId,
    installContext: context.installContext,
    moduleKey: context.moduleKey,
    myself: {
      app: { status: me.app.status, accountId: me.app.body?.accountId, accountType: me.app.body?.accountType, displayName: me.app.body?.displayName },
      user: { status: me.user.status, accountId: me.user.body?.accountId, accountType: me.user.body?.accountType },
    },
  };
  log('identity', result);
  return result;
});

// ---------------------------------------------------------------------------
// D: reading access data, as app and as user.

resolver.define('checkReads', async ({ payload, context }) => {
  const projectKey = payload.projectKey;
  const target = payload.accountId || context.accountId;
  const project = await both((as) => jira(as, route`/rest/api/3/project/${projectKey}`));
  const scheme = await both((as) => jira(as, route`/rest/api/3/project/${projectKey}/permissionscheme`));
  const schemeId = scheme.user.body?.id ?? scheme.app.body?.id;
  const grants = schemeId
    ? await both((as) => jira(as, route`/rest/api/3/permissionscheme/${schemeId}/permission?expand=${'user,group,projectRole'}`))
    : null;
  const roles = await both((as) => jira(as, route`/rest/api/3/project/${projectKey}/role`));
  const browseUsers = await both((as) =>
    jira(as, route`/rest/api/3/user/permission/search?permissions=${'BROWSE_PROJECTS'}&projectKey=${projectKey}&maxResults=${1000}`),
  );
  const adminCheck = await both((as) =>
    jira(as, route`/rest/api/3/permissions/check`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ accountId: target, globalPermissions: ['ADMINISTER'] }),
    }),
  );
  const browseGroups = (grants?.user.body?.permissions ?? grants?.app.body?.permissions ?? [])
    .filter((g) => g.permission === 'BROWSE_PROJECTS' && g.holder?.type === 'group')
    .map((g) => g.holder.value ?? g.holder.parameter);
  const firstGroup = payload.groupId || browseGroups[0];
  const members = firstGroup
    ? await both((as) => jira(as, route`/rest/api/3/group/member?groupId=${firstGroup}&includeInactiveUsers=${'true'}&maxResults=${50}`))
    : null;

  const result = {
    projectKey,
    projectId: project.user.body?.id ?? project.app.body?.id ?? null,
    projectStyle: project.user.body?.style ?? project.app.body?.style ?? null,
    schemeId: schemeId ?? null,
    status: {
      project: statuses(project),
      permissionScheme: statuses(scheme),
      grants: grants ? statuses(grants) : 'no scheme id',
      projectRoles: statuses(roles),
      usersWithBrowse: statuses(browseUsers),
      adminCheckForTarget: statuses(adminCheck),
      groupMembers: members ? statuses(members) : 'no group grants Browse',
    },
    roles: roles.user.body ?? roles.app.body,
    browseGrantHolders: (grants?.user.body?.permissions ?? grants?.app.body?.permissions ?? [])
      .filter((g) => g.permission === 'BROWSE_PROJECTS')
      .map((g) => ({ type: g.holder?.type, parameter: g.holder?.parameter, value: g.holder?.value })),
    usersWithBrowse: (browseUsers.user.body ?? browseUsers.app.body ?? []).map?.((u) => ({ accountId: u.accountId, accountType: u.accountType, active: u.active })) ?? [],
    targetIsJiraAdmin: { app: adminCheck.app.body?.globalPermissions ?? adminCheck.app.body, user: adminCheck.user.body?.globalPermissions ?? adminCheck.user.body },
    groupChecked: firstGroup ?? null,
    groupMemberCount: { app: members?.app.body?.total ?? null, user: members?.user.body?.total ?? null },
  };
  log('reads', { projectKey, status: result.status });
  return trim(result);
});

// ---------------------------------------------------------------------------
// B: role (and group) writes. Add, read back, remove, read back; first as app, then as user.

async function roleActorIds(as, projectKey, roleId) {
  const r = await jira(as, route`/rest/api/3/project/${projectKey}/role/${roleId}?excludeInactiveUsers=${'false'}`);
  return { status: r.status, ids: (r.body?.actors ?? []).map((a) => a.actorUser?.accountId).filter(Boolean) };
}

async function roleRoundTrip(as, projectKey, roleId, accountId) {
  const before = await roleActorIds('user', projectKey, roleId);
  if (before.ids.includes(accountId)) {
    return { skipped: 'The target is already a user actor of this role; pick a role it is not in, so the test does not remove real access.' };
  }
  const add = await jira(as, route`/rest/api/3/project/${projectKey}/role/${roleId}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ user: [accountId] }),
  });
  const during = await roleActorIds('user', projectKey, roleId);
  const remove = during.ids.includes(accountId)
    ? await jira(as, route`/rest/api/3/project/${projectKey}/role/${roleId}?user=${accountId}`, { method: 'DELETE' })
    : null;
  const after = await roleActorIds('user', projectKey, roleId);
  return {
    add: { status: add.status, error: add.ok ? null : add.body },
    addedSeen: during.ids.includes(accountId),
    remove: remove ? { status: remove.status, error: remove.ok ? null : remove.body } : 'nothing to remove',
    restored: !after.ids.includes(accountId),
    at: new Date().toISOString(),
  };
}

async function groupMemberIds(groupId) {
  const r = await jira('user', route`/rest/api/3/group/member?groupId=${groupId}&includeInactiveUsers=${'true'}&maxResults=${50}`);
  return (r.body?.values ?? []).map((u) => u.accountId);
}

async function groupRoundTrip(as, groupId, accountId) {
  if ((await groupMemberIds(groupId)).includes(accountId)) {
    return { skipped: 'The target is already in this group; pick a group it is not in.' };
  }
  const add = await jira(as, route`/rest/api/3/group/user?groupId=${groupId}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ accountId }),
  });
  const added = (await groupMemberIds(groupId)).includes(accountId);
  const remove = added ? await jira(as, route`/rest/api/3/group/user?groupId=${groupId}&accountId=${accountId}`, { method: 'DELETE' }) : null;
  const restored = !(await groupMemberIds(groupId)).includes(accountId);
  return {
    add: { status: add.status, error: add.ok ? null : add.body },
    addedSeen: added,
    remove: remove ? { status: remove.status, error: remove.ok ? null : remove.body } : 'nothing to remove',
    restored,
    at: new Date().toISOString(),
  };
}

resolver.define('checkWrites', async ({ payload, context }) => {
  const { projectKey, roleId, groupId } = payload;
  const accountId = payload.accountId || context.accountId;
  const startedAt = new Date().toISOString();
  const result = { startedAt, projectKey, roleId: roleId || null, groupId: groupId || null, accountId };
  if (roleId) {
    result.roleAsApp = await roleRoundTrip('app', projectKey, roleId, accountId);
    result.roleAsUser = await roleRoundTrip('user', projectKey, roleId, accountId);
  } else {
    result.role = 'skipped: no role id given';
  }
  if (groupId) {
    result.groupAsApp = await groupRoundTrip('app', groupId, accountId);
    result.groupAsUser = await groupRoundTrip('user', groupId, accountId);
  } else {
    result.group = 'skipped: no group id given';
  }
  log('writes', result);
  return result;
});

// ---------------------------------------------------------------------------
// C: audit records since a time, as app and as user, with the fields Wall matches on.

function auditShape(record) {
  const types = (items) => (items ?? []).map((i) => `${i.typeName}:${i.name}`);
  return {
    id: record.id,
    created: record.created,
    summary: record.summary,
    category: record.category,
    eventSource: record.eventSource,
    authorAccountId: record.authorAccountId ?? null,
    authorKey: record.authorKey ?? null,
    objectItem: record.objectItem ? `${record.objectItem.typeName}:${record.objectItem.name}:${record.objectItem.id ?? ''}` : null,
    associatedItems: types(record.associatedItems),
    changedValues: (record.changedValues ?? []).map((c) => `${c.fieldName}: "${c.changedFrom ?? ''}" -> "${c.changedTo ?? ''}"`),
  };
}

resolver.define('checkAudit', async ({ payload }) => {
  const from = payload.from || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 1000).toISOString();
  const limit = Number(payload.limit) || 200;
  const pair = await both((as) => jira(as, route`/rest/api/3/auditing/record?offset=${0}&limit=${limit}&from=${from}&to=${to}`));
  const pick = pair.user.body?.records ?? pair.app.body?.records ?? [];
  const result = {
    from,
    to,
    status: statuses(pair),
    total: { app: pair.app.body?.total ?? null, user: pair.user.body?.total ?? null },
    errors: { app: pair.app.ok ? null : pair.app.body, user: pair.user.ok ? null : pair.user.body },
    records: pick.map(auditShape),
    raw: payload.raw ? pick : undefined,
  };
  // Group records name users by user key, not account id. Map keys to account ids with Jira's migration API.
  const keys = [...new Set(pick.flatMap((r) => [r.objectItem, ...(r.associatedItems ?? [])]).filter((i) => i?.typeName === 'USER' && i.id && !String(i.id).includes(':')).map((i) => String(i.id)))].slice(0, 20);
  if (keys.length) {
    const query = keys.map((k) => `key=${encodeURIComponent(k)}`).join('&');
    const mapping = await both((as) => jira(as, route`/rest/api/3/user/bulk/migration?${new URLSearchParams(keys.map((k) => ['key', k]))}`));
    result.userKeyMapping = { query, status: statuses(mapping), app: mapping.app.body, user: mapping.user.body };
    log('audit-userkeys', result.userKeyMapping);
  }
  // The raw records are the fixtures for the engine's audit rules; log them in pieces so the CLI can read them.
  if (payload.raw) pick.forEach((record, i) => log('audit-raw', { i, record }));
  log('audit', { from, status: result.status, total: result.total, summaries: result.records.map((r) => `${r.category} | ${r.summary} | author:${r.authorAccountId ?? r.authorKey}`) });
  return trim(result);
});

// ---------------------------------------------------------------------------
// A: Teamwork Graph, as user only (Forge apps cannot call it as the app).

const CURATED = {
  teamsBySpace: {
    variable: 'spaceAri',
    field: 'atlassianTeamsBySpace',
    query: `query wall_teamsBySpace($spaceAri: ID!, $after: String) {
  atlassianTeamsBySpace(spaceAri: $spaceAri, first: 25, after: $after) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  },
  spaceWorkItems: {
    variable: 'spaceAri',
    field: 'jiraSpaceWorkItems',
    query: `query wall_spaceWorkItems($spaceAri: ID!, $after: String) {
  jiraSpaceWorkItems(spaceAri: $spaceAri, first: 25, after: $after) {
    edges { node { __typename ... on JiraWorkItem { id key } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  },
  userAssigned: {
    variable: 'userId',
    field: 'atlassianUserAssignedJiraWorkItems',
    query: `query wall_userAssigned($userId: ID!, $after: String) {
  atlassianUserAssignedJiraWorkItems(userId: $userId, first: 25, after: $after) {
    edges { node { __typename ... on JiraWorkItem { id key } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  },
  userInTeams: {
    variable: 'userId',
    field: 'atlassianUserInTeams',
    query: `query wall_userInTeams($userId: ID!, $after: String) {
  atlassianUserInTeams(userId: $userId, first: 25, after: $after) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  },
};

const PERSISTED = `query wall_persisted($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { key value { __typename ... on CypherQueryResultListNode { nodes { id } } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function graph(query, variables, operationName, context) {
  try {
    const response = await api.asUser().requestTeamworkGraph(query, variables, operationName, undefined, {
      'X-Query-Context': context.installContext,
    });
    return await read(response);
  } catch (error) {
    return { status: 0, ok: false, body: `request failed: ${error.message}` };
  }
}

async function curated(name, value, context, maxPages = 4) {
  const spec = CURATED[name];
  const rows = [];
  const errors = [];
  let after;
  let pages = 0;
  let hasNextPage = true;
  let status = null;
  while (hasNextPage && pages < maxPages) {
    const r = await graph(spec.query, { [spec.variable]: value, after }, spec.query.match(/query (\w+)/)[1], context);
    status = r.status;
    pages += 1;
    if (!r.ok || typeof r.body !== 'object') {
      errors.push(r.body);
      break;
    }
    if (r.body.errors?.length) errors.push(...r.body.errors);
    const connection = r.body.data?.[spec.field];
    rows.push(...(connection?.edges ?? []).map((e) => e.node));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor;
  }
  return { status, pages, rows: rows.length, sample: rows.slice(0, 5), errors };
}

resolver.define('checkGraph', async ({ payload, context }) => {
  const spaceAri = `ari:cloud:jira:${context.cloudId}:project/${payload.projectId}`;
  const otherUser = payload.otherAccountId || context.accountId;
  const userAri = `ari:cloud:identity::user/${otherUser}`;
  const result = {
    spaceAri,
    userAri,
    caller: context.accountId,
    teamsBySpace: await curated('teamsBySpace', spaceAri, context),
    spaceWorkItems: await curated('spaceWorkItems', spaceAri, context),
    userAssignedByAri: await curated('userAssigned', userAri, context),
    userInTeams: await curated('userInTeams', userAri, context),
    persisted: [],
  };
  for (const entry of payload.persisted ?? []) {
    if (!entry?.queryKey) continue;
    const r = await graph(PERSISTED, { queryKey: entry.queryKey, queryParams: entry.params ?? {} }, 'wall_persisted', context);
    result.persisted.push({
      queryKey: entry.queryKey,
      status: r.status,
      errors: typeof r.body === 'object' ? r.body.errors ?? [] : [r.body],
      rows: typeof r.body === 'object' ? r.body.data?.customQuery?.edges?.length ?? 0 : 0,
      sample: typeof r.body === 'object' ? (r.body.data?.customQuery?.edges ?? []).slice(0, 3) : null,
    });
  }
  log('graph', {
    teamsBySpace: result.teamsBySpace.rows,
    spaceWorkItems: result.spaceWorkItems.rows,
    userAssigned: result.userAssignedByAri.rows,
    userInTeams: result.userInTeams.rows,
    persisted: result.persisted.map((p) => [p.queryKey, p.rows, p.errors.length]),
  });
  return trim(result);
});

// A raw runner for the queries the checks above do not cover (schema questions such as title or summary).
resolver.define('runGraphQuery', async ({ payload, context }) => {
  const operationName = String(payload.query ?? '').match(/query (\w+)/)?.[1] ?? 'wall_raw';
  let variables = {};
  try {
    variables = payload.variables ? JSON.parse(payload.variables) : {};
  } catch (error) {
    return { status: 0, ok: false, body: `variables are not JSON: ${error.message}` };
  }
  const r = await graph(payload.query, variables, operationName, context);
  log('graph-raw', { operationName, status: r.status, errors: typeof r.body === 'object' ? (r.body.errors ?? []).length : 'text' });
  return trim(r);
});

export const handler = resolver.getDefinitions();

// ---------------------------------------------------------------------------
// Rovo action: proves the agent, action and skill load and that the action runs as the user.

export async function spikeAction(payload, context) {
  const projectKey = String(payload?.projectKey ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(projectKey)) return { error: 'projectKey must be a Jira project key, for example FALCON.' };
  const scheme = await jira('user', route`/rest/api/3/project/${projectKey}/permissionscheme`);
  if (!scheme.ok) return { projectKey, status: scheme.status, error: scheme.body };
  const grants = await jira('user', route`/rest/api/3/permissionscheme/${scheme.body.id}/permission`);
  const browse = (grants.body?.permissions ?? []).filter((g) => g.permission === 'BROWSE_PROJECTS');
  const result = {
    projectKey,
    permissionScheme: scheme.body.name,
    browseGrants: browse.length,
    holderTypes: [...new Set(browse.map((g) => g.holder?.type))],
    calledBy: context?.principal?.accountId ?? context?.accountId ?? null,
  };
  log('rovo-action', result);
  return result;
}

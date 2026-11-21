// A fake Jira REST site for the server tests: answers the paths the scan reads,
// in the shapes Jira Cloud returns. All names and ids are invented.

const user = (accountId, displayName, extra = {}) => ({ accountId, displayName, active: true, accountType: 'atlassian', ...extra });

export const USERS = {
  'u-ada': user('u-ada', 'Ada'),
  'u-bea': user('u-bea', 'Bea'),
  'u-dan': user('u-dan', 'Dan'),
  'u-eli': user('u-eli', 'Eli'),
  'u-fay': user('u-fay', 'Fay'),
  'u-gus': user('u-gus', 'Gus'),
  'u-hal': user('u-hal', 'Hal', { active: false }),
  'u-wall': user('u-wall', 'Wall', { accountType: 'app' }),
};

const ROUTES = {
  'GET /rest/api/3/project/search?startAt=0&maxResults=50&orderBy=name': {
    isLast: true,
    values: [
      { id: '10400', key: 'FALCON', name: 'Project Falcon', style: 'classic', simplified: false },
      { id: '10403', key: 'TEAM', name: 'Team project', style: 'next-gen', simplified: true },
    ],
  },
  'GET /rest/api/3/project/FALCON?expand=lead': {
    id: '10400',
    key: 'FALCON',
    name: 'Project Falcon',
    style: 'classic',
    simplified: false,
    lead: { accountId: 'u-eli', displayName: 'Eli', active: true },
  },
  'GET /rest/api/3/project/TEAM?expand=lead': { id: '10403', key: 'TEAM', name: 'Team project', style: 'next-gen', simplified: true, lead: { accountId: 'u-fay', displayName: 'Fay' } },
  'GET /rest/api/3/project/FALCON/permissionscheme': { id: 10, name: 'Falcon Scheme' },
  'GET /rest/api/3/permissionscheme/10/permission': {
    permissions: [
      { id: 1, permission: 'BROWSE_PROJECTS', holder: { type: 'projectRole', parameter: '10100', value: '10100' } },
      { id: 2, permission: 'BROWSE_PROJECTS', holder: { type: 'projectRole', parameter: '10002', value: '10002' } },
      { id: 3, permission: 'BROWSE_PROJECTS', holder: { type: 'projectLead' } },
      { id: 4, permission: 'BROWSE_PROJECTS', holder: { type: 'group', parameter: 'falcon-deal-team', value: 'g-deal' } },
      { id: 5, permission: 'ADMINISTER_PROJECTS', holder: { type: 'projectRole', parameter: '10002', value: '10002' } },
      { id: 6, permission: 'CREATE_ISSUES', holder: { type: 'projectRole', parameter: '10001', value: '10001' } },
    ],
  },
  'GET /rest/api/3/project/FALCON/role': {
    Administrators: 'https://example.atlassian.net/rest/api/3/project/10400/role/10002',
    Walled: 'https://example.atlassian.net/rest/api/3/project/10400/role/10100',
    Developers: 'https://example.atlassian.net/rest/api/3/project/10400/role/10001',
  },
  'GET /rest/api/3/project/FALCON/role/10100?excludeInactiveUsers=false': {
    id: 10100,
    name: 'Walled',
    actors: [
      { id: 1, displayName: 'Bea', type: 'atlassian-user-role-actor', actorUser: { accountId: 'u-bea' } },
      { id: 2, displayName: 'Gus', type: 'atlassian-user-role-actor', actorUser: { accountId: 'u-gus' } },
      { id: 3, displayName: 'falcon-advisers', type: 'atlassian-group-role-actor', actorGroup: { name: 'falcon-advisers', displayName: 'falcon-advisers', groupId: 'g-advisers' } },
    ],
  },
  'GET /rest/api/3/project/FALCON/role/10002?excludeInactiveUsers=false': {
    id: 10002,
    name: 'Administrators',
    actors: [
      { id: 4, displayName: 'Eli', type: 'atlassian-user-role-actor', actorUser: { accountId: 'u-eli' } },
      { id: 5, displayName: 'Wall', type: 'atlassian-user-role-actor', actorUser: { accountId: 'u-wall' } },
    ],
  },
  'GET /rest/api/3/group/member?groupId=g-deal&includeInactiveUsers=true&startAt=0&maxResults=50': {
    startAt: 0,
    maxResults: 2,
    total: 3,
    isLast: false,
    values: [USERS['u-fay'], USERS['u-gus']],
  },
  'GET /rest/api/3/group/member?groupId=g-deal&includeInactiveUsers=true&startAt=2&maxResults=50': {
    startAt: 2,
    maxResults: 2,
    total: 3,
    isLast: true,
    values: [USERS['u-hal']],
  },
  'GET /rest/api/3/group/member?groupId=g-advisers&includeInactiveUsers=true&startAt=0&maxResults=50': {
    startAt: 0,
    total: 1,
    isLast: true,
    values: [USERS['u-dan']],
  },
  'GET /rest/api/3/group/bulk?startAt=0&maxResults=50': {
    isLast: true,
    values: [
      { groupId: 'g-jira-admins', name: 'jira-admins-example' },
      { groupId: 'g-deal', name: 'falcon-deal-team' },
    ],
  },
  'GET /rest/api/3/group/member?groupId=g-jira-admins&includeInactiveUsers=false&startAt=0&maxResults=50': {
    isLast: true,
    values: [USERS['u-ada']],
  },
  'GET /rest/api/3/user/permission/search?permissions=BROWSE_PROJECTS&projectKey=FALCON&maxResults=1000': [
    'u-bea',
    'u-dan',
    'u-eli',
    'u-fay',
    'u-gus',
    'u-wall',
  ].map((id) => USERS[id]),
};

const ADMINS = new Set(['u-ada']);

/** A fresh copy of the routes, to build variants of the site. */
export function baseRoutes() {
  return structuredClone(ROUTES);
}

function response(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

/** A requester with the same contract as the Forge adapter. Records every call. */
export function fakeJira({ admins = ADMINS, routes = ROUTES, failures = {} } = {}) {
  const calls = [];
  const request = async (requestPath, init = {}) => {
    const method = init.method ?? 'GET';
    const key = `${method} ${requestPath}`;
    calls.push(key);
    if (failures[key]) return response(failures[key], { errorMessages: ['forced failure'] });
    if (key === 'POST /rest/api/3/permissions/check') {
      const { accountId } = JSON.parse(init.body);
      return response(200, { globalPermissions: admins.has(accountId) ? ['ADMINISTER'] : [], projectPermissions: [] });
    }
    if (key in routes) return response(200, routes[key]);
    // Keys ending in "*" match by prefix (for paths that carry times).
    const prefix = Object.keys(routes).find((k) => k.endsWith('*') && key.startsWith(k.slice(0, -1)));
    if (prefix) return response(200, typeof routes[prefix] === 'function' ? routes[prefix](key) : routes[prefix]);
    return response(404, { errorMessages: [`no fixture for ${key}`] });
  };
  return { request, calls };
}

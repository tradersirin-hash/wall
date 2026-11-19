// Plain-language names for principals and access routes.

/** Plain-language name for a class or conditional principal. */
export function describeClass(principal) {
  if (principal === 'class:anyone') return 'Anyone (including anonymous visitors)';
  if (principal === 'class:logged-in') return 'Any logged-in user';
  if (principal.startsWith('class:app-role:')) return `Users of ${principal.slice(15)}`;
  if (principal === 'class:org-admins') return 'Organization admins';
  if (principal === 'class:group-admins') return 'Whoever manages group membership';
  if (principal === 'cond:reporter') return 'The reporter of a work item';
  if (principal === 'cond:assignee') return 'The assignee of a work item';
  if (principal === 'cond:portal-customer') return 'Portal customers';
  if (principal.startsWith('cond:user-field:')) return `Users named in field ${principal.slice(16)}`;
  if (principal.startsWith('cond:group-field:')) return `Groups named in field ${principal.slice(17)}`;
  return principal;
}

/**
 * The route of one access path, in the shape the ledger records:
 *   { kind: 'direct' } | { kind: 'group', groupId, groupName } | { kind: 'role', roleId, roleName }
 *   | { kind: 'role-group', roleId, roleName, groupId, groupName } | { kind: 'lead' }
 * Returns null for paths that do not lead to one person (classes, conditions).
 */
export function routeOf(path) {
  const steps = path.steps;
  const role = steps.find((s) => s.kind === 'role');
  const member = steps.find((s) => s.kind === 'member');
  if (role && role.via === 'group') {
    return { kind: 'role-group', roleId: role.roleId, roleName: role.roleName, groupId: role.groupId, groupName: role.groupName };
  }
  if (role) return { kind: 'role', roleId: role.roleId, roleName: role.roleName };
  if (steps.some((s) => s.kind === 'lead')) return { kind: 'lead' };
  if (steps.some((s) => s.kind === 'direct')) return { kind: 'direct' };
  if (member) return { kind: 'group', groupId: member.groupId, groupName: member.groupName };
  return null;
}

/** A stable key for a route, so recorded and actual routes can be compared. */
export function routeKey(route) {
  if (!route) return 'none';
  switch (route.kind) {
    case 'group':
      return `group:${route.groupId}`;
    case 'role':
      return `role:${route.roleId}`;
    case 'role-group':
      return `role-group:${route.roleId}:${route.groupId}`;
    default:
      return route.kind;
  }
}

/** One phrase for a route, for example: group "falcon-advisers" in role "Walled". */
export function describeRoute(route) {
  if (!route) return 'an unknown route';
  switch (route.kind) {
    case 'direct':
      return 'a direct grant in the permission scheme';
    case 'group':
      return `group "${route.groupName ?? route.groupId}"`;
    case 'role':
      return `role "${route.roleName ?? route.roleId}"`;
    case 'role-group':
      return `group "${route.groupName ?? route.groupId}" in role "${route.roleName ?? route.roleId}"`;
    case 'lead':
      return 'being the project lead';
    case 'existing':
      return 'access held when the wall was raised';
    default:
      return route.kind;
  }
}

/** Distinct routes of a holding, sorted by key. */
export function routesOf(holding) {
  const seen = new Map();
  for (const path of holding?.paths ?? []) {
    const route = routeOf(path);
    if (route && !seen.has(routeKey(route))) seen.set(routeKey(route), route);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);
}

// Fixture site for the engine tests. All names and ids are invented.

let grantSeq = 0;

export function g(permission, type, parameter) {
  grantSeq += 1;
  const holder = { type };
  if (parameter !== undefined) {
    holder.parameter = parameter;
    holder.value = parameter;
  }
  return { id: String(grantSeq), permission, holder };
}

const user = (accountId, displayName, extra = {}) => ({
  accountId,
  displayName,
  active: true,
  accountType: 'atlassian',
  userKey: `key-${accountId.slice(2)}`,
  ...extra,
});

export const ROLE = Object.freeze({ ADMINISTRATORS: '10002', DEVELOPERS: '10001', WALLED: '10100', KEEPER: '10200' });

/**
 * "Acme Holdings". FALCON is the walled deal project. Awkward cases on purpose:
 * - Browse through a role with user actors (Bea, Cem, Gus), a role with a group actor
 *   (falcon-advisers: Dan), a group grant (falcon-deal-team: Fay, Gus, Hal), the lead (Eli);
 * - Gus reaches FALCON by two routes; Hal is inactive; Wall's own app account sees it;
 * - Ada is a Jira admin through a group grant, Ivo only through Jira's permission check;
 * - Eli is project admin (can add people to the roles); FALCON's scheme is shared with ARCHIVE;
 * - LEAK lets anyone and any logged-in user browse and any Jira user administer;
 * - TEAM is team-managed.
 */
export function acmeSite() {
  grantSeq = 0;
  const falcon = {
    id: '10',
    name: 'Falcon Scheme',
    grants: [
      g('BROWSE_PROJECTS', 'projectRole', ROLE.WALLED),
      g('BROWSE_PROJECTS', 'projectRole', ROLE.ADMINISTRATORS),
      g('BROWSE_PROJECTS', 'projectRole', ROLE.KEEPER),
      g('BROWSE_PROJECTS', 'projectLead'),
      g('BROWSE_PROJECTS', 'group', 'g-deal'),
      g('ADMINISTER_PROJECTS', 'projectRole', ROLE.ADMINISTRATORS),
      g('ADMINISTER_PROJECTS', 'projectRole', ROLE.KEEPER),
      g('CREATE_ISSUES', 'projectRole', ROLE.WALLED),
      g('EDIT_ISSUES', 'projectRole', ROLE.WALLED),
    ],
  };
  const standard = {
    id: '20',
    name: 'Default Scheme',
    grants: [
      g('BROWSE_PROJECTS', 'applicationRole', 'jira-software'),
      g('CREATE_ISSUES', 'applicationRole', 'jira-software'),
      g('ADMINISTER_PROJECTS', 'projectRole', ROLE.ADMINISTRATORS),
    ],
  };
  const leaky = {
    id: '30',
    name: 'Leaky Scheme',
    grants: [
      g('BROWSE_PROJECTS', 'anyone'),
      g('BROWSE_PROJECTS', 'applicationRole'),
      g('BROWSE_PROJECTS', 'reporter'),
      g('BROWSE_PROJECTS', 'user', 'u-bea'),
      g('ADMINISTER_PROJECTS', 'applicationRole', 'jira-software'),
    ],
  };
  return {
    version: 1,
    takenAt: '2026-12-01T09:00:00.000Z',
    users: [
      user('u-ada', 'Ada'),
      user('u-bea', 'Bea'),
      user('u-cem', 'Cem'),
      user('u-dan', 'Dan'),
      user('u-eli', 'Eli'),
      user('u-fay', 'Fay'),
      user('u-gus', 'Gus'),
      user('u-hal', 'Hal', { active: false }),
      user('u-ivo', 'Ivo'),
      user('u-kim', 'Kim'),
      user('u-wall', 'Wall', { accountType: 'app' }),
      user('u-bot', 'Build Bot', { accountType: 'app' }),
    ],
    groups: [
      { groupId: 'g-jira-admins', name: 'jira-admins', memberIds: ['u-ada'] },
      { groupId: 'g-advisers', name: 'falcon-advisers', memberIds: ['u-dan'] },
      { groupId: 'g-deal', name: 'falcon-deal-team', memberIds: ['u-fay', 'u-gus', 'u-hal'] },
      { groupId: 'g-staff', name: 'jira-software-users', memberIds: ['u-ada', 'u-bea', 'u-cem', 'u-eli', 'u-fay', 'u-gus', 'u-kim'] },
      { groupId: 'g-addons', name: 'atlassian-addons-admin', memberIds: ['u-bot'] },
    ],
    roles: [
      { id: ROLE.DEVELOPERS, name: 'Developers' },
      { id: ROLE.ADMINISTRATORS, name: 'Administrators' },
      { id: ROLE.WALLED, name: 'Walled' },
      { id: ROLE.KEEPER, name: 'Wall Keeper' },
    ],
    schemes: [falcon, standard, leaky],
    projects: [
      {
        id: '10400',
        key: 'FALCON',
        name: 'Project Falcon',
        style: 'classic',
        schemeId: '10',
        leadAccountId: 'u-eli',
        roleActors: {
          [ROLE.WALLED]: { userIds: ['u-bea', 'u-cem', 'u-gus'], groupIds: ['g-advisers'] },
          [ROLE.ADMINISTRATORS]: { userIds: ['u-eli'], groupIds: [] },
          [ROLE.KEEPER]: { userIds: ['u-wall'], groupIds: [] },
        },
      },
      {
        id: '10101',
        key: 'ARCHIVE',
        name: 'Deal archive',
        style: 'classic',
        schemeId: '10',
        leadAccountId: 'u-ada',
        roleActors: { [ROLE.ADMINISTRATORS]: { userIds: [], groupIds: ['g-jira-admins'] } },
      },
      {
        id: '10000',
        key: 'OPS',
        name: 'Operations',
        style: 'classic',
        schemeId: '20',
        leadAccountId: 'u-kim',
        roleActors: { [ROLE.ADMINISTRATORS]: { userIds: ['u-kim'], groupIds: [] } },
      },
      { id: '10102', key: 'LEAK', name: 'Leaky deal', style: 'classic', schemeId: '30', leadAccountId: 'u-cem', roleActors: {} },
      { id: '10103', key: 'TEAM', name: 'Team project', style: 'next-gen', schemeId: null, leadAccountId: 'u-fay' },
    ],
    globalGrants: [g('ADMINISTER', 'group', 'g-jira-admins')],
    globalChecks: [
      { accountId: 'u-ivo', permission: 'ADMINISTER', has: true, checkedAt: '2026-12-01T09:00:00.000Z' },
      { accountId: 'u-eli', permission: 'ADMINISTER', has: false, checkedAt: '2026-12-01T09:00:00.000Z' },
    ],
    applicationRoles: [{ key: 'jira-software', name: 'Jira', groupIds: ['g-staff'] }],
  };
}

/** A deep copy with a change applied, for before/after tests. */
export function changed(site, mutate) {
  const copy = structuredClone(site);
  mutate(copy);
  return copy;
}

/** Add an account to a group in a copy of the site. */
export function withGroupMember(site, groupId, accountId) {
  return changed(site, (s) => s.groups.find((x) => x.groupId === groupId).memberIds.push(accountId));
}

/** Add a user actor to a project role in a copy of the site. */
export function withRoleUser(site, projectKey, roleId, accountId) {
  return changed(site, (s) => {
    const project = s.projects.find((p) => p.key === projectKey);
    project.roleActors[roleId] ??= { userIds: [], groupIds: [] };
    project.roleActors[roleId].userIds.push(accountId);
  });
}

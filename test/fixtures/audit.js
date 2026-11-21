// Audit records in the shape GET /rest/api/3/auditing/record returned on a Jira
// Cloud site on 21 November 2026 (see the notes in src/engine/attribution.js).
// All names and ids are invented and match test/fixtures/sites.js; categories are
// in Turkish on purpose, because Jira localises them to the reader's language.
// Records 2003 (a group added to a role) and 2005 (a scheme grant) are shapes not
// yet seen on a real site.

const IDP = 'com.atlassian.crowd.directory.IdentityPlatformRemoteDirectory';
const group = (name) => ({ name, typeName: 'GROUP', parentId: '1', parentName: IDP });
const userByKey = (key) => ({ id: key, name: key, typeName: 'USER', parentId: '1', parentName: 'IDP Directory' });

export function auditRecords() {
  return [
    {
      // Ada adds herself to a group through Jira's REST API: written with the author...
      id: 2001,
      summary: 'User added to group',
      created: '2026-12-02T10:15:00.000+0000',
      category: 'grup yönetimi',
      eventSource: '',
      authorAccountId: 'u-ada',
      authorKey: 'key-ada',
      remoteAddress: '203.0.113.10',
      objectItem: group('falcon-deal-team'),
      associatedItems: [userByKey('key-ada')],
    },
    {
      // ...and a second later again by the identity platform, without one.
      id: 2007,
      summary: 'User added to group',
      created: '2026-12-02T10:15:01.000+0000',
      category: 'grup yönetimi',
      eventSource: '',
      objectItem: group('falcon-deal-team'),
      associatedItems: [userByKey('key-ada')],
    },
    {
      id: 2002,
      summary: 'Project roles changed',
      created: '2026-12-02T11:00:00.000+0000',
      category: 'projeler',
      eventSource: '',
      authorAccountId: 'u-eli',
      authorKey: 'key-eli',
      remoteAddress: '203.0.113.11',
      objectItem: { id: '10100', name: 'Walled', typeName: 'PROJECT_ROLE' },
      associatedItems: [{ id: '10400', name: 'Project Falcon', typeName: 'PROJECT' }],
      changedValues: [{ fieldName: 'Users', changedTo: 'u-kim' }],
    },
    {
      id: 2003,
      summary: 'Project roles changed',
      created: '2026-12-02T11:30:00.000+0000',
      category: 'projeler',
      eventSource: '',
      authorAccountId: 'u-ivo',
      authorKey: 'key-ivo',
      objectItem: { id: '10100', name: 'Walled', typeName: 'PROJECT_ROLE' },
      associatedItems: [{ id: '10400', name: 'Project Falcon', typeName: 'PROJECT' }],
      changedValues: [{ fieldName: 'Groups', changedTo: 'jira-software-users' }],
    },
    {
      // A change made in Atlassian Administration: no author, and no authored original.
      id: 2004,
      summary: 'User added to group',
      created: '2026-12-01T08:00:00.000+0000',
      category: 'grup yönetimi',
      eventSource: '',
      objectItem: group('jira-software-users'),
      associatedItems: [userByKey('key-kim')],
    },
    {
      id: 2005,
      summary: 'Permission scheme updated',
      created: '2026-12-02T12:00:00.000+0000',
      category: 'izinler',
      eventSource: '',
      authorAccountId: 'u-ada',
      authorKey: 'key-ada',
      objectItem: { id: '30', name: 'Leaky Scheme', typeName: 'SCHEME' },
      changedValues: [{ fieldName: 'Browse Projects', changedTo: 'Anyone' }],
    },
    {
      id: 2006,
      summary: 'Issue created',
      created: '2026-12-02T12:30:00.000+0000',
      category: 'konular',
      eventSource: '',
      authorAccountId: 'u-bea',
      objectItem: { id: '99', name: 'FALCON-1', typeName: 'ISSUE' },
    },
  ];
}

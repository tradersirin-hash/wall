// Audit records in the shape of GET /rest/api/3/auditing/record.
//
// The summary strings and item types are assumptions until the week-1 spike
// captures real records from a site; see AUDIT_RULES in src/engine/attribution.js.
// All names and ids are invented and match test/fixtures/sites.js.

export function auditRecords() {
  return [
    {
      id: 2001,
      summary: 'User added to group',
      created: '2026-12-02T10:15:00.000+0000',
      category: 'group management',
      authorAccountId: 'u-ada',
      objectItem: { id: 'u-ada', name: 'u-ada', typeName: 'USER' },
      associatedItems: [{ id: 'g-deal', name: 'falcon-deal-team', typeName: 'GROUP' }],
    },
    {
      id: 2002,
      summary: 'Project roles changed',
      created: '2026-12-02T11:00:00.000+0000',
      category: 'projects',
      authorAccountId: 'u-eli',
      objectItem: { id: '10100', name: 'Walled', typeName: 'PROJECT_ROLE' },
      associatedItems: [{ id: '10400', name: 'Project Falcon', typeName: 'PROJECT' }],
      changedValues: [{ fieldName: 'Users', changedFrom: 'u-bea, u-cem, u-gus', changedTo: 'u-bea, u-cem, u-gus, u-kim' }],
    },
    {
      id: 2003,
      summary: 'Project roles changed',
      created: '2026-12-02T11:30:00.000+0000',
      category: 'projects',
      authorAccountId: 'u-ivo',
      objectItem: { id: '10100', name: 'Walled', typeName: 'PROJECT_ROLE' },
      associatedItems: [{ id: '10400', name: 'Project Falcon', typeName: 'PROJECT' }],
      changedValues: [{ fieldName: 'Groups', changedFrom: 'falcon-advisers', changedTo: 'falcon-advisers, jira-software-users' }],
    },
    {
      id: 2004,
      summary: 'User added to group',
      created: '2026-12-01T08:00:00.000+0000',
      category: 'group management',
      authorAccountId: 'u-ada',
      objectItem: { id: 'u-kim', name: 'Kim', typeName: 'USER' },
      associatedItems: [{ id: 'g-staff', name: 'jira-software-users', typeName: 'GROUP' }],
    },
    {
      id: 2005,
      summary: 'Permission scheme updated',
      created: '2026-12-02T12:00:00.000+0000',
      category: 'permissions',
      authorAccountId: 'u-ada',
      objectItem: { id: '30', name: 'Leaky Scheme', typeName: 'PERMISSION_SCHEME' },
      changedValues: [{ fieldName: 'Browse Projects', changedFrom: '', changedTo: 'Anyone' }],
    },
    {
      id: 2006,
      summary: 'Issue created',
      created: '2026-12-02T12:30:00.000+0000',
      category: 'issues',
      authorAccountId: 'u-bea',
      objectItem: { id: '99', name: 'FALCON-1', typeName: 'ISSUE' },
    },
  ];
}

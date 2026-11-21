// Reading Jira's audit log for the attribution: one page of records in a time
// window, with the user keys of group records mapped to account ids.

import { normaliseAuditRecords } from '../engine/attribution.js';
import { path } from './jira.js';

function userKeysIn(records, knownIds) {
  const keys = new Set();
  for (const record of records) {
    for (const item of [record.objectItem, ...(record.associatedItems ?? [])]) {
      if (item?.typeName !== 'USER' || item.id == null) continue;
      const id = String(item.id);
      if (!knownIds.has(id) && !id.includes(':')) keys.add(id);
    }
  }
  return [...keys];
}

/**
 * @param {ReturnType<import('./jira.js').createJira>} jira
 * @param {{ snapshot: any, from: string, to: string, limit?: number }} options
 * @returns {Promise<{ changes: any[], snapshot: any, read: number, total: number|null, keysMapped: number }>}
 *   snapshot is a copy of the input whose users carry the user keys found.
 */
export async function readAuditChanges(jira, { snapshot, from, to, limit = 1000 }) {
  const page = await jira.get(path`/rest/api/3/auditing/record?offset=${0}&limit=${limit}&from=${from}&to=${to}`);
  const records = page?.records ?? [];
  const known = new Set(snapshot.users.map((u) => u.accountId));
  const keys = userKeysIn(records, known).slice(0, 100);
  let users = snapshot.users;
  let keysMapped = 0;
  if (keys.length) {
    const query = keys.map((k) => `key=${encodeURIComponent(k)}`).join('&');
    const mapping = (await jira.get(`/rest/api/3/user/bulk/migration?${query}`)) ?? [];
    const byAccount = new Map(mapping.filter((m) => m.accountId && m.key).map((m) => [m.accountId, m.key]));
    keysMapped = byAccount.size;
    users = snapshot.users.map((u) => (byAccount.has(u.accountId) ? { ...u, userKey: byAccount.get(u.accountId) } : u));
    for (const [accountId, key] of byAccount) {
      if (!known.has(accountId)) users.push({ accountId, displayName: accountId, active: true, accountType: 'atlassian', userKey: key });
    }
  }
  const withKeys = { ...snapshot, users };
  return { changes: normaliseAuditRecords(records, withKeys), snapshot: withKeys, read: records.length, total: page?.total ?? null, keysMapped };
}

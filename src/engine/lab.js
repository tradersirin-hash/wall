// Lab mode: a sample walled project with a believable history, built from the
// people who exist on the site, so an empty site still shows the whole story.
//
// This module only plans. The Forge side creates the Jira objects, appends the
// ledger inputs and, on teardown, deletes everything it created (all of it is
// named with the "Wall Lab" marker).

import { RecordType } from './ledger.js';
import { isoTime } from './model.js';

export const LAB = Object.freeze({
  marker: 'Wall Lab',
  projectKey: 'WALLAB',
  projectName: 'Project Falcon (Wall Lab)',
  codeName: 'Falcon',
  subject: 'Project Falcon: proposed acquisition of a listed competitor. Wall Lab sample data, not a real deal.',
  roleName: 'Walled (Wall Lab)',
  groupName: 'wall-lab-deal-team',
});

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Personas stand in for missing people. They only appear in ended, historical crossings. */
export const PERSONAS = Object.freeze([
  { accountId: 'wall-lab-persona-1', displayName: 'Outside counsel (Wall Lab persona)' },
  { accountId: 'wall-lab-persona-2', displayName: 'Valuation adviser (Wall Lab persona)' },
  { accountId: 'wall-lab-persona-3', displayName: 'Board secretary (Wall Lab persona)' },
]);

/**
 * Plan the Lab.
 * @param {{ now: string, adminAccountId: string, people: { accountId: string, displayName?: string, accountType?: string }[] }} input
 *   people: accounts on the site; app accounts and the admin are skipped.
 */
export function labScenario({ now, adminAccountId, people }) {
  const t0 = new Date(isoTime(now)).getTime();
  const ago = (ms) => new Date(t0 - ms).toISOString();
  const ahead = (ms) => new Date(t0 + ms).toISOString();
  const humans = people.filter((p) => p.accountType !== 'app' && p.accountId !== adminAccountId);
  const [a, b, c, d] = humans;
  const role = { kind: 'role', roleId: 'lab-role', roleName: LAB.roleName };
  const group = { kind: 'group', groupId: 'lab-group', groupName: LAB.groupName };
  const by = adminAccountId;

  const inputs = [
    {
      type: RecordType.WALL_RAISED,
      by,
      at: ago(21 * DAY),
      data: { projectKey: LAB.projectKey, projectId: 'lab-project', subject: LAB.subject, codeName: LAB.codeName, identifiedAt: ago(21 * DAY) },
    },
  ];
  const roleMembers = [];
  const groupMembers = [];
  const personas = [];
  let next = 0;
  const grant = (accountId, routeSpec, reason, fn, at, expiresAt) => {
    next += 1;
    const crossingId = `LAB-${next}`;
    inputs.push({ type: RecordType.CROSSING_GRANTED, by, at, data: { crossingId, accountId, route: routeSpec, reason, function: fn, approverAccountId: by, obtainedAt: at, expiresAt } });
    return crossingId;
  };
  const ack = (accountId, crossingId, at) =>
    inputs.push({ type: RecordType.CROSSING_ACKNOWLEDGED, by: accountId, at, data: { crossingId, acknowledgedAt: at } });
  const end = (crossingId, at, cause) => inputs.push({ type: RecordType.CROSSING_ENDED, by, at, data: { crossingId, endedAt: at, cause } });

  // Outside counsel: brought over, acknowledged, removed when their work ended.
  const p1 = PERSONAS[0];
  personas.push(p1);
  const x1 = grant(p1.accountId, role, 'Drafts the share purchase agreement.', 'Outside counsel', ago(20 * DAY));
  ack(p1.accountId, x1, ago(20 * DAY - 3 * HOUR));
  end(x1, ago(6 * DAY), 'removed');

  // A: deal lead, active and acknowledged.
  const lead = a ?? PERSONAS[1];
  const xa = grant(lead.accountId, role, 'Leads the transaction team.', 'Head of corporate development', ago(19 * DAY), ahead(40 * DAY));
  ack(lead.accountId, xa, ago(19 * DAY - 2 * HOUR));
  if (a) roleMembers.push(a.accountId);
  else {
    personas.push(PERSONAS[1]);
    end(xa, ago(2 * DAY), 'removed');
  }

  // B: analyst whose crossing expired yesterday but who is still in the group (overstay).
  if (b) {
    const xb = grant(b.accountId, group, 'Builds the valuation model.', 'Financial analyst', ago(14 * DAY), ago(1 * DAY));
    ack(b.accountId, xb, ago(13 * DAY));
    groupMembers.push(b.accountId);
  }

  // C: brought over two hours ago, acknowledgement still pending.
  if (c) {
    grant(c.accountId, role, 'Prepares the board pack.', 'Company secretary', ago(2 * HOUR), ahead(30 * DAY));
    roleMembers.push(c.accountId);
  } else {
    const p3 = PERSONAS[2];
    personas.push(p3);
    const x3 = grant(p3.accountId, role, 'Prepared the first board pack.', 'Board secretary', ago(12 * DAY));
    ack(p3.accountId, x3, ago(12 * DAY - HOUR));
    end(x3, ago(9 * DAY), 'removed');
  }

  // D: added to the group without a crossing, so the drift check has something to find.
  const unrecorded = d ? { accountId: d.accountId, route: group, note: 'Lab adds this person to the group with no ledger record.' } : null;
  if (d) groupMembers.push(d.accountId);

  return {
    lab: LAB,
    project: { key: LAB.projectKey, name: LAB.projectName, description: `${LAB.subject} Created by ${LAB.marker}; remove it with Lab teardown.` },
    role: { name: LAB.roleName, members: roleMembers },
    group: { name: LAB.groupName, members: groupMembers },
    scheme: {
      name: `${LAB.projectName} scheme`,
      browse: [{ holder: 'role', name: LAB.roleName }, { holder: 'group', name: LAB.groupName }],
      administer: [{ holder: 'user', accountId: adminAccountId }],
    },
    // Stable sort by time, so the ledger reads in the order things happened.
    ledgerInputs: inputs.map((input, i) => ({ input, i })).sort((x, y) => x.input.at.localeCompare(y.input.at) || x.i - y.i).map((x) => x.input),
    personas,
    unrecorded,
    liveMoment: `Open the project's People settings as an admin and add yourself to "${LAB.roleName}". Wall will flag the crossing and name who made it.`,
    teardown: ['ledger', 'project', 'permission scheme', 'project role', 'group'],
    peopleUsed: humans.slice(0, 4).map((p) => p.accountId),
  };
}

/** Lab ledger inputs with the planned ids replaced by the ids Jira gave the created objects. */
export function bindLabIds(inputs, { projectId, roleId, groupId }) {
  return inputs.map((input) => {
    const data = { ...input.data };
    if (input.type === RecordType.WALL_RAISED) data.projectId = projectId;
    if (data.route?.kind === 'role') data.route = { ...data.route, roleId };
    if (data.route?.kind === 'group') data.route = { ...data.route, groupId };
    return { ...input, wallId: input.type === RecordType.WALL_RAISED ? projectId : input.wallId, data };
  });
}

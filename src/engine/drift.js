// Drift: the "can see" set of a walled project against its ledger.
//
//   unrecorded      can see the project, but has no open crossing (attributed from the audit log)
//   overstay        can see the project, but the crossing has expired or ended
//   stale           has an open crossing, but can no longer see the project
//   extraRoutes     recorded, but also reaches the project by a route the ledger does not name
//   unacknowledged  open crossing, acknowledgement overdue
//   openings        the scheme lets a whole class of people in (anyone, any logged-in user...)
//   apps            app accounts that can see the project (listed apart, not people)

import { attributeCrossing } from './attribution.js';
import { describeRoute, routeKey } from './describe.js';
import { crossingStatus, ledgerState } from './ledger.js';
import { isoTime } from './model.js';

const HOUR = 60 * 60 * 1000;

/**
 * @param {{ tiers: any, records: any[], at: string, changes?: any[], snapshot?: any,
 *           since?: string, ackGraceHours?: number, ignoreAccountIds?: string[] }} input
 *   changes: normalised audit changes (normaliseAuditRecords); since: start of the audit window.
 */
export function driftReport({ tiers, records, at, changes = [], snapshot, since, ackGraceHours = 48, ignoreAccountIds = [] }) {
  const now = isoTime(at);
  const state = ledgerState(records);
  const ignore = new Set(ignoreAccountIds);
  const seeing = new Map(tiers.canSee.map((p) => [p.accountId, p]));
  const lastCrossing = new Map();
  for (const c of state.crossings) lastCrossing.set(c.accountId, c);

  const unrecorded = [];
  const overstay = [];
  const extraRoutes = [];
  const apps = [];
  for (const person of tiers.canSee) {
    if (ignore.has(person.accountId)) continue;
    if (person.accountType === 'app') {
      apps.push({ accountId: person.accountId, displayName: person.displayName, routes: person.routes });
      continue;
    }
    const open = state.openByAccount.get(person.accountId);
    if (!open) {
      const previous = lastCrossing.get(person.accountId) ?? null;
      const attribution = attributeCrossing(person, changes, {
        project: tiers.project,
        schemeId: tiers.scheme.id,
        until: now,
        since: previous?.endedAt ?? since,
        snapshot,
      });
      unrecorded.push({
        accountId: person.accountId,
        displayName: person.displayName,
        active: person.active,
        routes: person.routes,
        previousCrossingId: previous?.crossingId ?? null,
        attribution,
      });
      continue;
    }
    const status = crossingStatus(open, now);
    if (status === 'expired') {
      overstay.push({ accountId: person.accountId, displayName: person.displayName, crossingId: open.crossingId, expiresAt: open.expiresAt, routes: person.routes });
    }
    if (open.route.kind !== 'existing') {
      const recorded = routeKey(open.route);
      const extra = person.routes.filter((r) => routeKey(r) !== recorded);
      if (extra.length) {
        extraRoutes.push({
          accountId: person.accountId,
          displayName: person.displayName,
          crossingId: open.crossingId,
          recordedRoute: open.route,
          extraRoutes: extra,
          recordedRoutePresent: person.routes.some((r) => routeKey(r) === recorded),
          sentence: `${person.displayName} was brought over through ${describeRoute(open.route)} but can also see the project through ${extra.map(describeRoute).join(' and ')}; ending the crossing alone will not remove access.`,
        });
      }
    }
  }

  const stale = [];
  const unacknowledged = [];
  const awaitingAcknowledgement = [];
  for (const c of state.openByAccount.values()) {
    if (ignore.has(c.accountId)) continue;
    const status = crossingStatus(c, now);
    if (!seeing.has(c.accountId) && status !== 'scheduled') {
      stale.push({ accountId: c.accountId, crossingId: c.crossingId, route: c.route, obtainedAt: c.obtainedAt });
    }
    if (!c.acknowledgedAt && status !== 'scheduled') {
      const due = new Date(new Date(c.obtainedAt).getTime() + ackGraceHours * HOUR).toISOString();
      const entry = { accountId: c.accountId, crossingId: c.crossingId, obtainedAt: c.obtainedAt, dueAt: due };
      (due <= now ? unacknowledged : awaitingAcknowledgement).push(entry);
    }
  }

  const openings = tiers.openings ?? [];
  const intact = unrecorded.length === 0 && overstay.length === 0 && openings.length === 0;
  const byId = (a, b) => a.accountId.localeCompare(b.accountId);
  for (const list of [unrecorded, overstay, extraRoutes, stale, unacknowledged, awaitingAcknowledgement, apps]) list.sort(byId);

  return {
    at: now,
    project: tiers.project,
    status: intact ? 'intact' : 'drift',
    unrecorded,
    overstay,
    stale,
    extraRoutes,
    unacknowledged,
    awaitingAcknowledgement,
    openings,
    apps,
    ledgerHead: state.head,
    summary: {
      status: intact ? 'intact' : 'drift',
      canSee: tiers.canSee.length,
      recorded: tiers.canSee.length - unrecorded.length - apps.length,
      unrecorded: unrecorded.length,
      attributed: unrecorded.filter((u) => u.attribution.found).length,
      selfAdmitted: unrecorded.filter((u) => u.attribution.selfAdmitted).length,
      overstay: overstay.length,
      stale: stale.length,
      extraRoutes: extraRoutes.length,
      unacknowledged: unacknowledged.length,
      openings: openings.length,
      apps: apps.length,
    },
  };
}

/**
 * Inputs that write each new unrecorded crossing into the ledger as a drift.flagged
 * record, skipping people already flagged since their last crossing ended.
 */
export function driftFlagInputs(report, records, { by }) {
  const state = ledgerState(records);
  const inputs = [];
  for (const u of report.unrecorded) {
    const previous = state.crossings.filter((c) => c.accountId === u.accountId).pop();
    const already = state.flags.some((f) => f.accountId === u.accountId && (!previous || f.at >= previous.endedAt));
    if (already) continue;
    inputs.push({
      type: 'drift.flagged',
      by,
      at: report.at,
      data: { accountId: u.accountId, routes: u.routes, detectedAt: report.at, attribution: u.attribution },
    });
  }
  return inputs;
}

/**
 * Input that records an unrecorded crossing after the fact, using the audit-log
 * time as the time access was obtained when one was found.
 */
export function recordDriftInput(unrecordedEntry, { by, at, reason, approverAccountId, expiresAt, fn }) {
  const attributed = unrecordedEntry.attribution?.found ? unrecordedEntry.attribution : null;
  const route =
    (attributed && unrecordedEntry.routes.find((r) => routeKey(r) === attributed.routeKey)) ?? unrecordedEntry.routes[0] ?? { kind: 'existing' };
  return {
    type: 'crossing.granted',
    by,
    at,
    data: {
      accountId: unrecordedEntry.accountId,
      route,
      reason,
      function: fn,
      approverAccountId,
      obtainedAt: attributed?.at && attributed.at <= isoTime(at) ? attributed.at : at,
      expiresAt,
    },
  };
}

// A FALCON ledger that matches test/fixtures/sites.js. Times are in December 2026.

import { RecordType, appendAll } from '../../src/engine/index.js';
import { ROLE } from './sites.js';

export const T = Object.freeze({
  raised: '2026-11-20T09:00:00.000Z',
  bea: '2026-11-20T09:05:00.000Z',
  beaAck: '2026-11-20T10:00:00.000Z',
  cem: '2026-11-21T08:00:00.000Z',
  cemAck: '2026-11-21T08:30:00.000Z',
  dan: '2026-11-22T14:00:00.000Z',
  danAck: '2026-11-22T15:00:00.000Z',
  eli: '2026-11-20T09:01:00.000Z',
  eliAck: '2026-11-20T09:02:00.000Z',
  fay: '2026-11-23T09:00:00.000Z',
  fayAck: '2026-11-23T09:10:00.000Z',
  gus: '2026-11-24T09:00:00.000Z',
  hal: '2026-11-24T10:00:00.000Z',
  halAck: '2026-11-24T11:00:00.000Z',
  check: '2026-12-01T09:00:00.000Z',
});

export const walled = { kind: 'role', roleId: ROLE.WALLED, roleName: 'Walled' };
export const deal = { kind: 'group', groupId: 'g-deal', groupName: 'falcon-deal-team' };
export const advisers = { kind: 'role-group', roleId: ROLE.WALLED, roleName: 'Walled', groupId: 'g-advisers', groupName: 'falcon-advisers' };

const grant = (at, accountId, route, reason, extra = {}) => ({
  type: RecordType.CROSSING_GRANTED,
  by: 'u-eli',
  at,
  data: { accountId, route, reason, approverAccountId: 'u-eli', ...extra },
});
const ack = (at, accountId, crossingId) => ({ type: RecordType.CROSSING_ACKNOWLEDGED, by: accountId, at, data: { crossingId } });

/**
 * Inputs, in time order. Crossing ids are given so tests can refer to them.
 * Eli raised the wall and is in it as the lead (approved by Ada). Every person who
 * can see FALCON in acmeSite() has a crossing; Fay's has expired by the check time;
 * Gus has not acknowledged.
 */
export function falconInputs() {
  return [
    {
      type: RecordType.WALL_RAISED,
      by: 'u-eli',
      at: T.raised,
      wallId: '10400',
      data: {
        projectKey: 'FALCON',
        projectId: '10400',
        codeName: 'Falcon',
        subject: 'Project Falcon: proposed acquisition of a listed competitor',
        identifiedAt: '2026-11-20T08:30:00.000Z',
        issuer: { name: 'Acme Holdings' },
      },
    },
    { ...grant(T.eli, 'u-eli', { kind: 'lead' }, 'Project lead of the deal team.', { crossingId: 'X-ELI', approverAccountId: 'u-ada', function: 'Head of corporate development' }) },
    ack(T.eliAck, 'u-eli', 'X-ELI'),
    grant(T.bea, 'u-bea', walled, 'Leads the legal workstream.', { crossingId: 'X-BEA', function: 'General counsel', expiresAt: '2027-01-31T23:59:00.000Z' }),
    ack(T.beaAck, 'u-bea', 'X-BEA'),
    grant(T.cem, 'u-cem', walled, 'Prepares the board pack.', { crossingId: 'X-CEM', function: 'Company secretary' }),
    ack(T.cemAck, 'u-cem', 'X-CEM'),
    grant(T.dan, 'u-dan', advisers, 'External counsel on the share purchase agreement.', { crossingId: 'X-DAN', function: 'Partner, outside counsel' }),
    ack(T.danAck, 'u-dan', 'X-DAN'),
    grant(T.fay, 'u-fay', deal, 'Builds the valuation model.', { crossingId: 'X-FAY', function: 'Financial analyst', expiresAt: '2026-11-30T18:00:00.000Z' }),
    ack(T.fayAck, 'u-fay', 'X-FAY'),
    grant(T.gus, 'u-gus', walled, 'Integration planning.', { crossingId: 'X-GUS', function: 'Operations lead' }),
    grant(T.hal, 'u-hal', deal, 'Tax structuring.', { crossingId: 'X-HAL', function: 'Tax adviser' }),
    ack(T.halAck, 'u-hal', 'X-HAL'),
  ];
}

export function falconLedger() {
  return appendAll([], falconInputs());
}

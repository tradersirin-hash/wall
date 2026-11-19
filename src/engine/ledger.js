// The crossing ledger: an append-only, hash-chained record of every crossing
// of one wall (one walled project).
//
// Each record holds the SHA-256 hash of its own body and the hash of the record
// before it, so editing, removing or reordering any record breaks the chain at
// that point. Cutting records off the end is only visible against an anchor (the
// last known head, kept apart from the records and printed on every export).
//
// Personal data stays out of the chain. Records name people only by Atlassian
// account id; names, phone numbers and the like live in a separate, erasable
// store (Implementing Regulation (EU) 2026/1291 limits how long personal data
// may be kept, and a hash chain cannot forget). Free-text fields (reason,
// function, note) should not carry personal identifiers; the UI says so.
//
// Record types:
//   wall.raised            the project is walled (always record 0)
//   crossing.granted       a person is brought over the wall: route, reason, approver, expiry
//   crossing.acknowledged  the person acknowledges their duties
//   crossing.extended      a new expiry, approved again
//   crossing.ended         access ended (expired, removed, lost, wall lowered)
//   drift.flagged          Wall saw access without a recorded crossing
//   wall.lowered           the wall is no longer needed (for example the news is public)

import { canonicalJson, sha256Hex } from './certificate.js';
import { routeKey } from './describe.js';
import { isoTime } from './model.js';

export const LEDGER_FORMAT = 'wall-ledger/1';
export const GENESIS_HASH = '0'.repeat(64);

export const RecordType = Object.freeze({
  WALL_RAISED: 'wall.raised',
  CROSSING_GRANTED: 'crossing.granted',
  CROSSING_ACKNOWLEDGED: 'crossing.acknowledged',
  CROSSING_EXTENDED: 'crossing.extended',
  CROSSING_ENDED: 'crossing.ended',
  DRIFT_FLAGGED: 'drift.flagged',
  WALL_LOWERED: 'wall.lowered',
});

const TYPES = new Set(Object.values(RecordType));
const ROUTE_KINDS = new Set(['direct', 'group', 'role', 'role-group', 'lead', 'existing']);
export const END_CAUSES = Object.freeze(['expired', 'removed', 'access-lost', 'left', 'wall-lowered']);

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new LedgerError(code, message);
};

/** The hashed part of a record, in a fixed shape. */
export function recordBody(record) {
  return {
    format: record.format,
    wallId: record.wallId,
    seq: record.seq,
    type: record.type,
    at: record.at,
    by: record.by,
    data: record.data,
    prevHash: record.prevHash,
  };
}

export function hashRecord(record) {
  return sha256Hex(canonicalJson(recordBody(record)));
}

// ---------------------------------------------------------------------------
// State: a fold over the records.

function emptyState() {
  return {
    wall: null,
    crossings: [],
    byId: new Map(),
    openByAccount: new Map(),
    flags: [],
    head: null,
    length: 0,
  };
}

function applyRecord(state, record) {
  const d = record.data;
  switch (record.type) {
    case RecordType.WALL_RAISED:
      state.wall = {
        wallId: record.wallId,
        projectKey: d.projectKey,
        projectId: d.projectId,
        subject: d.subject,
        codeName: d.codeName ?? null,
        identifiedAt: d.identifiedAt,
        issuer: d.issuer ?? null,
        raisedAt: record.at,
        raisedBy: record.by,
        lowered: null,
        updatedAt: record.at,
      };
      break;
    case RecordType.CROSSING_GRANTED: {
      const crossing = {
        crossingId: d.crossingId,
        accountId: d.accountId,
        route: d.route,
        reason: d.reason,
        function: d.function ?? null,
        approverAccountId: d.approverAccountId ?? null,
        requestedBy: d.requestedBy ?? null,
        obtainedAt: d.obtainedAt,
        expiresAt: d.expiresAt ?? null,
        baseline: Boolean(d.baseline),
        recordedAt: record.at,
        recordedBy: record.by,
        grantSeq: record.seq,
        grantHash: record.hash,
        acknowledgedAt: null,
        statementHash: null,
        extensions: [],
        endedAt: null,
        endCause: null,
        endNote: null,
        endRecordedAt: null,
      };
      state.crossings.push(crossing);
      state.byId.set(crossing.crossingId, crossing);
      state.openByAccount.set(crossing.accountId, crossing);
      break;
    }
    case RecordType.CROSSING_ACKNOWLEDGED: {
      const c = state.byId.get(d.crossingId);
      c.acknowledgedAt = d.acknowledgedAt;
      c.statementHash = d.statementHash ?? null;
      break;
    }
    case RecordType.CROSSING_EXTENDED: {
      const c = state.byId.get(d.crossingId);
      c.extensions.push({ expiresAt: d.expiresAt, approverAccountId: d.approverAccountId, reason: d.reason, at: record.at });
      c.expiresAt = d.expiresAt;
      break;
    }
    case RecordType.CROSSING_ENDED: {
      const c = state.byId.get(d.crossingId);
      c.endedAt = d.endedAt;
      c.endCause = d.cause;
      c.endNote = d.note ?? null;
      c.endRecordedAt = record.at;
      if (state.openByAccount.get(c.accountId) === c) state.openByAccount.delete(c.accountId);
      break;
    }
    case RecordType.DRIFT_FLAGGED:
      state.flags.push({ ...d, seq: record.seq, at: record.at });
      break;
    case RecordType.WALL_LOWERED:
      state.wall.lowered = { reason: d.reason, loweredAt: d.loweredAt, by: record.by };
      break;
    default:
      break;
  }
  if (state.wall) state.wall.updatedAt = record.at;
  state.head = { seq: record.seq, hash: record.hash };
  state.length += 1;
}

/**
 * Current state of a ledger: the wall, every crossing with its acknowledgement,
 * extensions and end, the open crossing per account, and the drift flags.
 * Records are assumed to be in order; use verifyChain to check them.
 */
export function ledgerState(records) {
  const state = emptyState();
  for (const record of records) applyRecord(state, record);
  return state;
}

/**
 * Status of a crossing at a time:
 * 'scheduled' | 'awaiting-acknowledgement' | 'active' | 'expired' | 'ended'.
 * 'expired' means the expiry has passed but access was not recorded as ended.
 */
export function crossingStatus(crossing, at) {
  const now = isoTime(at);
  if (crossing.endedAt && crossing.endedAt <= now) return 'ended';
  if (crossing.obtainedAt > now) return 'scheduled';
  if (crossing.expiresAt && crossing.expiresAt <= now) return 'expired';
  if (!crossing.acknowledgedAt) return 'awaiting-acknowledgement';
  return 'active';
}

/** Crossings whose access period covers the time `at` (obtained at or before, not ended by then). */
export function insidersAt(state, at) {
  const now = isoTime(at);
  return state.crossings.filter((c) => c.obtainedAt <= now && (!c.endedAt || c.endedAt > now));
}

// ---------------------------------------------------------------------------
// Validation.

function text(value, field, { min = 1, max = 2000 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) fail('missing-field', `${field} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  if (s.length > max) fail('field-too-long', `${field} is longer than ${max} characters.`);
  return s;
}

function optionalText(value, field, max = 2000) {
  if (value == null || value === '') return null;
  return text(value, field, { max });
}

function time(value, field) {
  try {
    const t = isoTime(value);
    if (!t) fail('missing-field', `${field} is required.`);
    return t;
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    return fail('bad-time', `${field} is not a valid time.`);
  }
}

function route(value) {
  if (!value || !ROUTE_KINDS.has(value.kind)) fail('bad-route', `route.kind must be one of ${[...ROUTE_KINDS].join(', ')}.`);
  const out = { kind: value.kind };
  for (const k of ['roleId', 'roleName', 'groupId', 'groupName']) if (value[k] != null) out[k] = String(value[k]);
  if ((out.kind === 'role' || out.kind === 'role-group') && !out.roleId) fail('bad-route', 'A role route needs roleId.');
  if ((out.kind === 'group' || out.kind === 'role-group') && !out.groupId) fail('bad-route', 'A group route needs groupId.');
  return out;
}

function openCrossing(state, crossingId) {
  const c = state.byId.get(crossingId);
  if (!c) fail('unknown-crossing', `Crossing ${crossingId} is not in the ledger.`);
  if (c.endedAt) fail('crossing-ended', `Crossing ${crossingId} has already ended.`);
  return c;
}

/**
 * Check one new record against the state before it and return its normalised data.
 * @param {ReturnType<typeof ledgerState>} state
 * @param {{ type: string, at: string, by: string, data: any, seq: number }} input
 */
function validate(state, input, options) {
  const { type, at, seq } = input;
  const data = input.data ?? {};
  const allowSelfApproval = Boolean(options.allowSelfApproval);
  if (!TYPES.has(type)) fail('unknown-type', `Unknown record type ${type}.`);
  text(input.by, 'by');
  if (!state.wall && type !== RecordType.WALL_RAISED) fail('no-wall', 'The first record must be wall.raised.');
  if (state.wall && type === RecordType.WALL_RAISED) fail('already-raised', 'This ledger already has a wall.raised record.');
  if (state.wall?.lowered && type !== RecordType.DRIFT_FLAGGED) fail('wall-lowered', 'The wall has been lowered; only drift can still be flagged.');

  switch (type) {
    case RecordType.WALL_RAISED: {
      const identifiedAt = data.identifiedAt != null ? time(data.identifiedAt, 'identifiedAt') : at;
      if (identifiedAt > at) fail('future-time', 'identifiedAt cannot be later than the record.');
      const issuer = data.issuer ? { name: optionalText(data.issuer.name, 'issuer.name', 300) } : null;
      return {
        projectKey: text(data.projectKey, 'projectKey', { max: 100 }),
        projectId: text(String(data.projectId ?? ''), 'projectId', { max: 100 }),
        subject: text(data.subject, 'subject', { min: 3, max: 300 }),
        codeName: optionalText(data.codeName, 'codeName', 100),
        identifiedAt,
        issuer: issuer?.name ? issuer : null,
      };
    }
    case RecordType.CROSSING_GRANTED: {
      const accountId = text(data.accountId, 'accountId', { max: 128 });
      if (state.openByAccount.has(accountId)) {
        fail('already-open', `${accountId} already has an open crossing (${state.openByAccount.get(accountId).crossingId}).`);
      }
      const crossingId = data.crossingId != null ? text(data.crossingId, 'crossingId', { max: 64 }) : `X${String(seq).padStart(4, '0')}`;
      if (state.byId.has(crossingId)) fail('duplicate-crossing', `Crossing ${crossingId} already exists.`);
      const baseline = Boolean(data.baseline);
      const approverAccountId = baseline ? optionalText(data.approverAccountId, 'approverAccountId', 128) : text(data.approverAccountId, 'approverAccountId', { max: 128 });
      if (!baseline && approverAccountId === accountId && !allowSelfApproval) {
        fail('self-approval', 'A person cannot approve their own crossing.');
      }
      const obtainedAt = data.obtainedAt != null ? time(data.obtainedAt, 'obtainedAt') : at;
      if (obtainedAt > at) fail('future-time', 'obtainedAt cannot be later than the record; record a crossing when access is given.');
      const expiresAt = data.expiresAt != null ? time(data.expiresAt, 'expiresAt') : null;
      if (expiresAt && expiresAt <= obtainedAt) fail('bad-expiry', 'expiresAt must be later than obtainedAt.');
      return {
        crossingId,
        accountId,
        route: route(data.route),
        reason: text(data.reason, 'reason', { min: 3, max: 1000 }),
        function: optionalText(data.function, 'function', 300),
        approverAccountId,
        requestedBy: optionalText(data.requestedBy, 'requestedBy', 128),
        obtainedAt,
        expiresAt,
        baseline: baseline || undefined,
      };
    }
    case RecordType.CROSSING_ACKNOWLEDGED: {
      const crossingId = text(data.crossingId, 'crossingId', { max: 64 });
      const c = openCrossing(state, crossingId);
      if (c.acknowledgedAt) fail('already-acknowledged', `Crossing ${crossingId} is already acknowledged.`);
      if (input.by !== c.accountId) fail('ack-by-other', 'Only the person who crossed can acknowledge.');
      const acknowledgedAt = data.acknowledgedAt != null ? time(data.acknowledgedAt, 'acknowledgedAt') : at;
      if (acknowledgedAt > at) fail('future-time', 'acknowledgedAt cannot be later than the record.');
      const statementHash = optionalText(data.statementHash, 'statementHash', 64);
      if (statementHash && !/^[0-9a-f]{64}$/.test(statementHash)) fail('bad-hash', 'statementHash must be a SHA-256 hex digest.');
      return { crossingId, acknowledgedAt, statementHash: statementHash ?? undefined };
    }
    case RecordType.CROSSING_EXTENDED: {
      const crossingId = text(data.crossingId, 'crossingId', { max: 64 });
      const c = openCrossing(state, crossingId);
      const approverAccountId = text(data.approverAccountId, 'approverAccountId', { max: 128 });
      if (approverAccountId === c.accountId && !allowSelfApproval) fail('self-approval', 'A person cannot approve their own extension.');
      const expiresAt = time(data.expiresAt, 'expiresAt');
      if (expiresAt <= at) fail('bad-expiry', 'The new expiry must be in the future.');
      return { crossingId, expiresAt, approverAccountId, reason: text(data.reason, 'reason', { min: 3, max: 1000 }) };
    }
    case RecordType.CROSSING_ENDED: {
      const crossingId = text(data.crossingId, 'crossingId', { max: 64 });
      const c = openCrossing(state, crossingId);
      const cause = text(data.cause, 'cause', { max: 32 });
      if (!END_CAUSES.includes(cause)) fail('bad-cause', `cause must be one of ${END_CAUSES.join(', ')}.`);
      const endedAt = data.endedAt != null ? time(data.endedAt, 'endedAt') : at;
      if (endedAt > at) fail('future-time', 'endedAt cannot be later than the record.');
      if (endedAt < c.obtainedAt) fail('bad-end', 'endedAt cannot be earlier than obtainedAt.');
      return { crossingId, endedAt, cause, note: optionalText(data.note, 'note', 1000) ?? undefined };
    }
    case RecordType.DRIFT_FLAGGED: {
      const routes = Array.isArray(data.routes) ? data.routes.map(route) : [];
      const a = data.attribution;
      return {
        accountId: text(data.accountId, 'accountId', { max: 128 }),
        routes,
        detectedAt: data.detectedAt != null ? time(data.detectedAt, 'detectedAt') : at,
        attribution: a?.found
          ? {
              actorAccountId: a.actorAccountId ?? null,
              at: a.at ? time(a.at, 'attribution.at') : null,
              auditRecordId: a.auditRecordId != null ? String(a.auditRecordId) : null,
              confidence: a.confidence,
              routeKey: a.routeKey ?? (a.route ? routeKey(a.route) : null),
            }
          : null,
      };
    }
    case RecordType.WALL_LOWERED: {
      if (state.openByAccount.size) {
        fail('open-crossings', `End the ${state.openByAccount.size} open crossing(s) before lowering the wall.`);
      }
      const loweredAt = data.loweredAt != null ? time(data.loweredAt, 'loweredAt') : at;
      if (loweredAt > at) fail('future-time', 'loweredAt cannot be later than the record.');
      return { reason: text(data.reason, 'reason', { min: 3, max: 1000 }), loweredAt };
    }
    default:
      return fail('unknown-type', `Unknown record type ${type}.`);
  }
}

function dropUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Append and verify.

/**
 * Validate and seal the next record. Pure: returns the new record and leaves
 * `records` untouched; the caller stores it (INSERT only, never UPDATE).
 * @param {any[]} records the ledger so far, in order
 * @param {{ type: string, by: string, at?: string, data?: any, wallId?: string }} input
 * @param {{ now?: string, allowSelfApproval?: boolean }} [options]
 */
export function appendRecord(records, input, options = {}) {
  const prev = records.length ? records[records.length - 1] : null;
  const at = time(input.at ?? options.now, 'at');
  if (prev && at < prev.at) fail('time-reversed', 'A record cannot be earlier than the record before it.');
  const wallId = prev ? prev.wallId : text(String(input.wallId ?? input.data?.projectId ?? ''), 'wallId', { max: 100 });
  if (prev && input.wallId != null && String(input.wallId) !== prev.wallId) fail('wrong-wall', 'This record belongs to another wall.');
  const seq = prev ? prev.seq + 1 : 0;
  const state = ledgerState(records);
  const data = dropUndefined(validate(state, { type: input.type, at, by: input.by, data: input.data, seq }, options));
  const record = {
    format: LEDGER_FORMAT,
    wallId,
    seq,
    type: input.type,
    at,
    by: String(input.by).trim(),
    data,
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return { ...record, hash: hashRecord(record) };
}

/**
 * Append several inputs in order; returns the full new ledger.
 * Convenient for tests and for Lab mode.
 */
export function appendAll(records, inputs, options = {}) {
  const out = [...records];
  for (const input of inputs) out.push(appendRecord(out, input, options));
  return out;
}

/**
 * Check a ledger: structure, hash chain, order and the rules every record had to
 * pass when it was appended. Optionally compare with an anchor (a head saved
 * elsewhere) to catch records cut off the end.
 * @param {any[]} records
 * @param {{ wallId?: string, anchor?: { seq: number, hash: string }, allowSelfApproval?: boolean }} [options]
 */
export function verifyChain(records, options = {}) {
  const problems = [];
  const state = emptyState();
  const wallId = options.wallId != null ? String(options.wallId) : records[0]?.wallId;
  records.forEach((record, i) => {
    const prev = i > 0 ? records[i - 1] : null;
    const problem = (code, message) => problems.push({ seq: record?.seq ?? null, index: i, code, message });
    if (record.format !== LEDGER_FORMAT) problem('bad-format', `Record ${i} has format ${record.format}.`);
    if (record.seq !== i) problem('seq-gap', `Record at position ${i} has seq ${record.seq}.`);
    if (String(record.wallId) !== wallId) problem('wrong-wall', `Record ${i} belongs to wall ${record.wallId}.`);
    const expectedPrev = prev ? prev.hash : GENESIS_HASH;
    if (record.prevHash !== expectedPrev) problem('broken-link', `Record ${i} does not point to the hash of the record before it.`);
    if (hashRecord(record) !== record.hash) problem('hash-mismatch', `Record ${i} does not match its own hash: it was edited after it was written.`);
    if (prev && record.at < prev.at) problem('time-reversed', `Record ${i} is earlier than the record before it.`);
    try {
      validate(state, { type: record.type, at: record.at, by: record.by, data: record.data, seq: record.seq }, options);
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      problem(`invalid:${error.code}`, `Record ${i}: ${error.message}`);
    }
    try {
      applyRecord(state, record);
    } catch {
      problem('unreadable', `Record ${i} cannot be applied.`);
    }
  });

  const last = records[records.length - 1];
  const head = last ? { seq: last.seq, hash: last.hash } : null;
  let anchored = null;
  if (options.anchor) {
    const at = records[options.anchor.seq];
    if (!at) {
      anchored = false;
      problems.push({ seq: options.anchor.seq, index: null, code: 'truncated', message: `The ledger ends before the anchored record ${options.anchor.seq}.` });
    } else if (at.hash !== options.anchor.hash) {
      anchored = false;
      problems.push({ seq: options.anchor.seq, index: options.anchor.seq, code: 'anchor-mismatch', message: `Record ${options.anchor.seq} differs from the anchored hash.` });
    } else {
      anchored = true;
    }
  }
  return { ok: problems.length === 0, length: records.length, head, anchored, firstProblem: problems[0] ?? null, problems };
}

// ---------------------------------------------------------------------------
// Helpers that build inputs.

/**
 * Inputs that raise a wall over a project that already has viewers: wall.raised,
 * then one baseline crossing per person who can see it now (they must still
 * acknowledge). App accounts are left out; Wall lists them apart.
 * @param {any} tiers result of wallTiers
 * @param {{ by: string, at: string, subject: string, codeName?: string, identifiedAt?: string,
 *           issuer?: { name: string } }} options
 */
export function raiseWallInputs(tiers, { by, at, subject, codeName, identifiedAt, issuer }) {
  const inputs = [
    {
      type: RecordType.WALL_RAISED,
      by,
      at,
      wallId: tiers.project.id,
      data: { projectKey: tiers.project.key, projectId: tiers.project.id, subject, codeName, identifiedAt, issuer },
    },
  ];
  for (const person of tiers.canSee) {
    if (person.accountType === 'app') continue;
    inputs.push({
      type: RecordType.CROSSING_GRANTED,
      by,
      at,
      data: {
        accountId: person.accountId,
        route: person.routes[0] ?? { kind: 'existing' },
        reason: 'Held access when the wall was raised.',
        approverAccountId: by,
        obtainedAt: at,
        baseline: true,
      },
    });
  }
  return inputs;
}

/** The SHA-256 of an acknowledgement statement, stored with the acknowledgement. */
export function statementHash(statement) {
  return sha256Hex(String(statement).normalize('NFC'));
}

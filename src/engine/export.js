// Insider-list export.
//
// The list is laid out after Annex I, Template 1 (the section for one specific
// piece of inside information) of Commission Implementing Regulation (EU)
// 2026/1291, which replaced Implementing Regulation (EU) 2022/1210 on 5 July 2026.
// The regulation sets content and layout, not a file format; competent
// authorities name their own transmission channels. Wall fills what its ledger
// knows and leaves the rest blank for offline entry. The column for national
// identification number or date of birth is always blank: Wall stores neither.
// Using this layout does not by itself make a list compliant with anything.
//
// Two files come out:
//   insider list  the template layout only: four header lines, the column headings, one row per crossing
//   evidence      the same rows with the ledger facts behind them (account ids, routes, approvers,
//                 acknowledgements, record hashes) and the ledger head, for internal audit

import { describeRoute } from './describe.js';
import { crossingStatus, ledgerState, verifyChain } from './ledger.js';
import { isoTime } from './model.js';

export const INSIDER_LIST_LAYOUT = Object.freeze({
  source: 'Commission Implementing Regulation (EU) 2026/1291, Annex I, Template 1',
  officialJournal: 'OJ L, 2026/1291, 15.6.2026',
  url: 'https://eur-lex.europa.eu/eli/reg_impl/2026/1291/oj/eng',
  inForceFrom: '2026-07-05',
  header: Object.freeze([
    'Description of the specific piece of inside information to which this section relates to:',
    'Date and time of creation of this section (i.e. when the specific piece of inside information was identified):',
    'Date and time of the last update of this section:',
    'Date of transmission to the competent authority:',
  ]),
  columns: Object.freeze([
    'First name(s) of the insider (in the case of third-party service providers, the first name(s) of the natural person acting as a contact person for that third-party service provider)',
    'Surname(s) of the insider (in the case of third-party service providers, the surname(s) of the natural person acting as a contact person for that third-party service provider)',
    'Professional telephone number(s) (work direct telephone line and work mobile numbers)',
    'Function and reason for being insider',
    'Obtained (the date and time when the insider obtained access to the specific piece of inside information)',
    'Ceased (the date and time when the insider ceased to have access to the specific piece of inside information)',
    'National Identification Number (if applicable) or otherwise Date of Birth',
  ]),
});

/** "yyyy-mm-dd, hh:mm UTC", the template's date-and-time format. */
export function formatUtc(value) {
  const iso = isoTime(value);
  return iso ? `${iso.slice(0, 10)}, ${iso.slice(11, 16)} UTC` : '';
}

/** "yyyy-mm-dd". */
export function formatDate(value) {
  const iso = isoTime(value);
  return iso ? iso.slice(0, 10) : '';
}

/**
 * Phone numbers as digits only (the template asks for numbers without spaces).
 * A leading "+" becomes the international prefix "00".
 */
export function formatPhone(value) {
  if (value == null) return '';
  const trimmed = String(value).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return trimmed.startsWith('+') ? `00${digits}` : digits;
}

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula
 * (starting with =, +, -, @, tab or carriage return) gets a leading apostrophe.
 */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows, { bom = true } = {}) {
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `${bom ? '﻿' : ''}${body}\r\n`;
}

function functionAndReason(c, details) {
  const parts = [];
  if (c.function) parts.push(c.function);
  parts.push(c.reason);
  if (details?.company) parts.push(`Third-party service provider: ${[details.company, details.companyAddress].filter(Boolean).join(', ')}`);
  return parts.map((p) => p.trim().replace(/[.\s]+$/, '')).join('. ') + '.';
}

/**
 * Rows of the insider list, plus warnings that should be resolved before it is sent.
 * @param {{ records: any[], details?: Record<string, { firstName?: string, surname?: string,
 *           professionalPhone?: string, company?: string, companyAddress?: string }>,
 *           at: string, transmittedOn?: string, drift?: any, anchor?: { seq: number, hash: string } }} input
 *   details: per account id, from Wall's erasable insider-details store (never the ledger).
 */
export function insiderList({ records, details = {}, at, transmittedOn, drift, anchor }) {
  const check = verifyChain(records, { anchor });
  if (!check.ok) {
    const error = new Error(`The ledger failed verification (${check.firstProblem.code} at record ${check.firstProblem.index}); no list was produced.`);
    error.code = 'ledger-invalid';
    error.verification = check;
    throw error;
  }
  const now = isoTime(at);
  const state = ledgerState(records);
  const crossings = [...state.crossings].sort((a, b) => a.obtainedAt.localeCompare(b.obtainedAt) || a.crossingId.localeCompare(b.crossingId));
  const updates = crossings.flatMap((c) => [c.recordedAt, c.endRecordedAt]).filter(Boolean).sort();
  const lastUpdate = updates[updates.length - 1] ?? state.wall.raisedAt;

  const rows = crossings.map((c) => {
    const d = details[c.accountId] ?? {};
    return [
      d.firstName ?? '',
      d.surname ?? '',
      formatPhone(d.professionalPhone),
      functionAndReason(c, d),
      formatUtc(c.obtainedAt),
      formatUtc(c.endedAt),
      '',
    ];
  });

  const warnings = [];
  const missingNames = crossings.filter((c) => !details[c.accountId]?.firstName || !details[c.accountId]?.surname).length;
  if (missingNames) warnings.push({ code: 'names-missing', count: missingNames, message: `${missingNames} row(s) have no first name or surname yet; fill them in before sending.` });
  const expired = crossings.filter((c) => crossingStatus(c, now) === 'expired').length;
  if (expired) warnings.push({ code: 'expired-not-ended', count: expired, message: `${expired} crossing(s) have expired but access was not recorded as ended.` });
  const unack = crossings.filter((c) => !c.endedAt && !c.acknowledgedAt).length;
  if (unack) warnings.push({ code: 'unacknowledged', count: unack, message: `${unack} insider(s) have not acknowledged their duties yet.` });
  if (drift?.summary?.unrecorded) {
    warnings.push({
      code: 'unrecorded-access',
      count: drift.summary.unrecorded,
      message: `${drift.summary.unrecorded} person(s) can see the project without a recorded crossing and are not on this list.`,
    });
  }
  if (drift?.summary?.openings) {
    warnings.push({ code: 'openings', count: drift.summary.openings, message: 'The permission scheme lets a whole class of people see or administer the project.' });
  }

  return {
    layout: INSIDER_LIST_LAYOUT.source,
    header: [
      state.wall.subject,
      formatUtc(state.wall.identifiedAt),
      formatUtc(lastUpdate),
      transmittedOn ? formatDate(transmittedOn) : '',
    ],
    rows,
    crossings,
    warnings,
    ledgerHead: check.head,
    generatedAt: now,
  };
}

/** The insider list as CSV text (UTF-8 with BOM, CRLF). */
export function insiderListCsv(input, options) {
  const list = insiderList(input);
  const lines = INSIDER_LIST_LAYOUT.header.map((label, i) => [label, list.header[i]]);
  lines.push([]);
  lines.push([...INSIDER_LIST_LAYOUT.columns]);
  lines.push(...list.rows);
  return { csv: csv(lines, options), list };
}

export const EVIDENCE_COLUMNS = Object.freeze([
  'Row',
  'Crossing ID',
  'Atlassian account ID',
  'Display name',
  'Route',
  'Reason',
  'Approver account ID',
  'Approver display name',
  'Requested by account ID',
  'Obtained (UTC)',
  'Expires (UTC)',
  'Acknowledged (UTC)',
  'Acknowledgement statement SHA-256',
  'Ceased (UTC)',
  'End cause',
  'Baseline',
  'Recorded (UTC)',
  'Grant record seq',
  'Grant record SHA-256',
]);

/**
 * The evidence file: one row per insider-list row, with the ledger facts behind it.
 * @param {{ records: any[], at: string, names?: Record<string,string>, details?: any, drift?: any,
 *           anchor?: { seq: number, hash: string } }} input names: account id -> display name, resolved at export time
 */
export function evidenceCsv({ records, at, names = {}, details, drift, anchor }, options) {
  const list = insiderList({ records, at, details, drift, anchor });
  const name = (id) => (id ? names[id] ?? '' : '');
  const lines = [[...EVIDENCE_COLUMNS]];
  list.crossings.forEach((c, i) => {
    lines.push([
      i + 1,
      c.crossingId,
      c.accountId,
      name(c.accountId),
      describeRoute(c.route),
      c.reason,
      c.approverAccountId ?? '',
      name(c.approverAccountId),
      c.requestedBy ?? '',
      c.obtainedAt,
      c.expiresAt ?? '',
      c.acknowledgedAt ?? '',
      c.statementHash ?? '',
      c.endedAt ?? '',
      c.endCause ?? '',
      c.baseline ? 'yes' : 'no',
      c.recordedAt,
      c.grantSeq,
      c.grantHash,
    ]);
  });
  for (const u of drift?.unrecorded ?? []) {
    lines.push(['', '', u.accountId, u.displayName ?? name(u.accountId), u.routes.map(describeRoute).join('; '), 'NOT RECORDED: can see the project without a crossing', u.attribution?.actorAccountId ?? '', name(u.attribution?.actorAccountId), '', u.attribution?.at ?? '', '', '', '', '', '', 'no', '', '', '']);
  }
  lines.push([]);
  lines.push(['Ledger head seq', list.ledgerHead.seq]);
  lines.push(['Ledger head SHA-256', list.ledgerHead.hash]);
  lines.push(['Generated (UTC)', list.generatedAt]);
  lines.push(['Layout of the insider list', `${INSIDER_LIST_LAYOUT.source} (${INSIDER_LIST_LAYOUT.url})`]);
  return { csv: csv(lines, options), list };
}

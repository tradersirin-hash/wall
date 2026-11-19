import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSIDER_LIST_LAYOUT,
  RecordType,
  appendAll,
  csvCell,
  driftReport,
  evidenceCsv,
  formatPhone,
  formatUtc,
  insiderList,
  insiderListCsv,
  wallTiers,
} from '../src/engine/index.js';
import { T, falconLedger } from './fixtures/ledger.js';
import { acmeSite, withGroupMember } from './fixtures/sites.js';

const ledger = falconLedger();
const details = {
  'u-bea': { firstName: 'Bea', surname: 'Example', professionalPhone: '+44 20 7946 0000' },
  'u-dan': { firstName: 'Dan', surname: 'Sample', company: 'Sample & Partners LLP', companyAddress: '1 Example Street, London' },
};

/** Minimal RFC 4180 parser for the tests. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && s[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  return rows;
}

test('the layout is Annex I, Template 1 of Implementing Regulation (EU) 2026/1291: seven columns', () => {
  assert.equal(INSIDER_LIST_LAYOUT.columns.length, 7);
  assert.equal(INSIDER_LIST_LAYOUT.header.length, 4);
  assert.match(INSIDER_LIST_LAYOUT.source, /2026\/1291/);
  assert.equal(INSIDER_LIST_LAYOUT.columns[6], 'National Identification Number (if applicable) or otherwise Date of Birth');
});

test('the insider list CSV: header lines, headings, one row per crossing in order obtained', () => {
  const { csv } = insiderListCsv({ records: ledger, details, at: T.check });
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM for spreadsheets');
  assert.ok(csv.includes('\r\n'));
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], [INSIDER_LIST_LAYOUT.header[0], 'Project Falcon: proposed acquisition of a listed competitor']);
  assert.deepEqual(rows[1], [INSIDER_LIST_LAYOUT.header[1], '2026-11-20, 08:30 UTC']);
  assert.deepEqual(rows[2], [INSIDER_LIST_LAYOUT.header[2], '2026-11-24, 10:00 UTC']);
  assert.deepEqual(rows[3], [INSIDER_LIST_LAYOUT.header[3], '']);
  assert.deepEqual(rows[4], ['']);
  assert.deepEqual(rows[5], [...INSIDER_LIST_LAYOUT.columns]);
  const data = rows.slice(6);
  assert.equal(data.length, 7);
  assert.ok(data.every((r) => r.length === 7 && r[6] === ''), 'identification column always blank');
  assert.deepEqual(data.map((r) => r[4]), [
    '2026-11-20, 09:01 UTC',
    '2026-11-20, 09:05 UTC',
    '2026-11-21, 08:00 UTC',
    '2026-11-22, 14:00 UTC',
    '2026-11-23, 09:00 UTC',
    '2026-11-24, 09:00 UTC',
    '2026-11-24, 10:00 UTC',
  ]);
  assert.deepEqual(data[1], ['Bea', 'Example', '00442079460000', 'General counsel. Leads the legal workstream.', '2026-11-20, 09:05 UTC', '', '']);
  assert.equal(data[3][3], 'Partner, outside counsel. External counsel on the share purchase agreement. Third-party service provider: Sample & Partners LLP, 1 Example Street, London.');
  assert.deepEqual(data[0].slice(0, 3), ['', '', ''], 'names left blank when Wall has none');
});

test('ceased dates and the last update follow the ledger', () => {
  const ended = appendAll(ledger, [{ type: RecordType.CROSSING_ENDED, by: 'u-eli', at: T.check, data: { crossingId: 'X-FAY', cause: 'expired', endedAt: '2026-11-30T18:00:00.000Z' } }]);
  const list = insiderList({ records: ended, at: T.check, transmittedOn: '2026-12-05' });
  const fay = list.rows[4];
  assert.equal(fay[5], '2026-11-30, 18:00 UTC');
  assert.equal(list.header[2], '2026-12-01, 09:00 UTC');
  assert.equal(list.header[3], '2026-12-05');
});

test('warnings tell what to fix before sending', () => {
  const after = withGroupMember(acmeSite(), 'g-deal', 'u-ada');
  const drift = driftReport({ tiers: wallTiers(after, 'FALCON'), records: ledger, at: T.check });
  const { warnings } = insiderList({ records: ledger, details, at: T.check, drift });
  const codes = Object.fromEntries(warnings.map((w) => [w.code, w.count]));
  assert.deepEqual(codes, { 'names-missing': 5, 'expired-not-ended': 1, unacknowledged: 1, 'unrecorded-access': 1 });
});

test('a tampered ledger produces no list', () => {
  const tampered = structuredClone(ledger);
  tampered[3].data.reason = 'Changed.';
  assert.throws(() => insiderList({ records: tampered, at: T.check }), (e) => e.code === 'ledger-invalid' && e.verification.firstProblem.code === 'hash-mismatch');
});

test('the evidence file carries the ledger facts and the head hash', () => {
  const after = withGroupMember(acmeSite(), 'g-deal', 'u-ada');
  const drift = driftReport({ tiers: wallTiers(after, 'FALCON'), records: ledger, at: T.check });
  const names = { 'u-eli': 'Eli', 'u-bea': 'Bea', 'u-ada': 'Ada' };
  const { csv } = evidenceCsv({ records: ledger, at: T.check, names, drift });
  const rows = parseCsv(csv);
  assert.equal(rows[0][0], 'Row');
  const bea = rows.find((r) => r[1] === 'X-BEA');
  assert.equal(bea[2], 'u-bea');
  assert.equal(bea[3], 'Bea');
  assert.equal(bea[4], 'role "Walled"');
  assert.equal(bea[7], 'Eli');
  assert.equal(bea[11], T.beaAck);
  assert.equal(bea[18], ledger[3].hash);
  const unrecorded = rows.find((r) => r[2] === 'u-ada');
  assert.match(unrecorded[5], /^NOT RECORDED/);
  assert.deepEqual(rows.find((r) => r[0] === 'Ledger head SHA-256'), ['Ledger head SHA-256', ledger[13].hash]);
});

test('cells are quoted and guarded against spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a, b'), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell(null), '');
  assert.equal(formatPhone('+90 (532) 123-45-67'), '00905321234567');
  assert.equal(formatPhone(' 0212 555 00 00 '), '02125550000');
  assert.equal(formatPhone(''), '');
  assert.equal(formatUtc('2026-12-02T13:15:00+0300'), '2026-12-02, 10:15 UTC');
});

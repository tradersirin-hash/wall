// Storage: walls, the ledger and scan summaries in Forge SQL; the ledger anchor
// (the last head Wall saw) in the key-value store, apart from the records it guards.
//
// `exec(query, params)` runs one parameterised statement and resolves to its rows;
// `kv` has get/set. Both are injected, so tests use an in-memory store with the same methods.

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

const anchorKey = (wallId) => `wall-anchor:${wallId}`;

function wallFromRow(row) {
  return {
    wallId: String(row.wall_id),
    projectKey: row.project_key,
    subject: row.subject,
    codeName: row.code_name ?? null,
    status: row.status,
    raisedAt: row.raised_at,
    updatedAt: row.updated_at,
  };
}

export function createSqlStore({ exec, kv }) {
  return {
    async listWalls() {
      const rows = await exec('SELECT wall_id, project_key, subject, code_name, status, raised_at, updated_at FROM walls ORDER BY raised_at', []);
      return rows.map(wallFromRow);
    },
    async getWall(wallId) {
      const rows = await exec('SELECT wall_id, project_key, subject, code_name, status, raised_at, updated_at FROM walls WHERE wall_id = ?', [String(wallId)]);
      return rows[0] ? wallFromRow(rows[0]) : null;
    },
    async insertWall(wall) {
      await exec('INSERT INTO walls (wall_id, project_key, subject, code_name, status, raised_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        wall.wallId,
        wall.projectKey,
        wall.subject,
        wall.codeName ?? null,
        wall.status,
        wall.raisedAt,
        wall.updatedAt,
      ]);
    },
    async updateWall(wallId, { status, updatedAt }) {
      await exec('UPDATE walls SET status = ?, updated_at = ? WHERE wall_id = ?', [status, updatedAt, String(wallId)]);
    },
    async readLedger(wallId) {
      const rows = await exec('SELECT body FROM ledger_records WHERE wall_id = ? ORDER BY seq', [String(wallId)]);
      return rows.map((r) => JSON.parse(r.body));
    },
    async appendRecord(record) {
      try {
        await exec('INSERT INTO ledger_records (wall_id, seq, record_type, recorded_at, hash, prev_hash, body) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          record.wallId,
          record.seq,
          record.type,
          record.at,
          record.hash,
          record.prevHash,
          JSON.stringify(record),
        ]);
      } catch (error) {
        const existing = await exec('SELECT seq FROM ledger_records WHERE wall_id = ? AND seq = ?', [record.wallId, record.seq]);
        if (existing.length) throw new ConflictError(`Record ${record.seq} of wall ${record.wallId} was written by someone else first.`);
        throw error;
      }
      await kv.set(anchorKey(record.wallId), { seq: record.seq, hash: record.hash });
    },
    async getAnchor(wallId) {
      return (await kv.get(anchorKey(wallId))) ?? null;
    },
    /** Delete a wall with its whole ledger, its scans and its anchor. */
    async deleteWall(wallId) {
      const id = String(wallId);
      await exec('DELETE FROM ledger_records WHERE wall_id = ?', [id]);
      await exec('DELETE FROM scans WHERE wall_id = ?', [id]);
      await exec('DELETE FROM walls WHERE wall_id = ?', [id]);
      await kv.delete(anchorKey(id));
    },
    async saveScan({ wallId, takenAt, scanHash, wallHash, summary }) {
      await exec('INSERT INTO scans (wall_id, taken_at, scan_hash, wall_hash, summary) VALUES (?, ?, ?, ?, ?)', [
        String(wallId),
        takenAt,
        scanHash,
        wallHash,
        JSON.stringify(summary),
      ]);
    },
    async latestScan(wallId) {
      const rows = await exec('SELECT taken_at, scan_hash, wall_hash, summary FROM scans WHERE wall_id = ? ORDER BY taken_at DESC LIMIT 1', [String(wallId)]);
      const row = rows[0];
      return row ? { takenAt: row.taken_at, scanHash: row.scan_hash, wallHash: row.wall_hash, summary: JSON.parse(row.summary) } : null;
    },
  };
}

/** The same methods over plain memory, for tests and for local runs. */
export function createMemoryStore() {
  const walls = new Map();
  const ledgers = new Map();
  const anchors = new Map();
  const scans = new Map();
  return {
    async listWalls() {
      return [...walls.values()].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt)).map((w) => ({ ...w }));
    },
    async getWall(wallId) {
      const wall = walls.get(String(wallId));
      return wall ? { ...wall } : null;
    },
    async insertWall(wall) {
      if (walls.has(wall.wallId)) throw new Error(`Wall ${wall.wallId} exists`);
      walls.set(wall.wallId, { ...wall });
    },
    async updateWall(wallId, { status, updatedAt }) {
      const wall = walls.get(String(wallId));
      if (wall) Object.assign(wall, { status, updatedAt });
    },
    async readLedger(wallId) {
      return (ledgers.get(String(wallId)) ?? []).map((r) => JSON.parse(r));
    },
    async appendRecord(record) {
      const list = ledgers.get(record.wallId) ?? [];
      if (list.length !== record.seq) throw new ConflictError(`Record ${record.seq} of wall ${record.wallId} was written by someone else first.`);
      list.push(JSON.stringify(record));
      ledgers.set(record.wallId, list);
      anchors.set(record.wallId, { seq: record.seq, hash: record.hash });
    },
    async getAnchor(wallId) {
      return anchors.get(String(wallId)) ?? null;
    },
    async deleteWall(wallId) {
      const id = String(wallId);
      walls.delete(id);
      ledgers.delete(id);
      scans.delete(id);
      anchors.delete(id);
    },
    async saveScan(scan) {
      const list = scans.get(String(scan.wallId)) ?? [];
      list.push(JSON.parse(JSON.stringify(scan)));
      scans.set(String(scan.wallId), list);
    },
    async latestScan(wallId) {
      const list = scans.get(String(wallId)) ?? [];
      return list.length ? list[list.length - 1] : null;
    },
    /** Test helper: the raw stored ledger, to simulate tampering. */
    _rawLedger(wallId) {
      return ledgers.get(String(wallId));
    },
  };
}

// Local SQLite database: operation history (with per-record changes, for rollback),
// snapshots, and small settings. Lives only on this phone.
//
// Schema changes go through MIGRATIONS (append-only, never edit an old one). The
// current version is stored in PRAGMA user_version.

import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('stompers.db');

/** Each entry upgrades the schema by one version. Append; never change old entries. */
const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE operations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  INTEGER NOT NULL,
    author      TEXT    NOT NULL,
    kind        TEXT    NOT NULL,   -- inject | spread | delete | delete_fake | delete_all | snapshot | restore | rollback
    summary     TEXT    NOT NULL,
    status      TEXT    NOT NULL,   -- applied | partial | failed | rolled_back
    rollback_of INTEGER REFERENCES operations(id)
  );
  CREATE TABLE changes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id     INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    action    TEXT    NOT NULL,     -- insert | delete
    record_id TEXT,                 -- platform id (after insert / of the deleted record)
    client_id TEXT    NOT NULL,
    start_ms  INTEGER NOT NULL,
    end_ms    INTEGER NOT NULL,
    count     INTEGER NOT NULL,
    ok        INTEGER NOT NULL      -- 1 = applied
  );
  CREATE INDEX changes_op ON changes(op_id);
  CREATE TABLE snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   INTEGER NOT NULL,
    author       TEXT    NOT NULL,
    label        TEXT    NOT NULL,
    record_count INTEGER NOT NULL,
    step_sum     INTEGER NOT NULL
  );
  CREATE TABLE snapshot_records (
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    client_id   TEXT    NOT NULL,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    count       INTEGER NOT NULL
  );
  CREATE INDEX snapshot_records_snap ON snapshot_records(snapshot_id);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

function migrate() {
  db.execSync('PRAGMA foreign_keys = ON;');
  const current = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[v]);
      db.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
migrate();

export default db;

// ---- types -----------------------------------------------------------------------------

export type OpKind = 'inject' | 'spread' | 'delete' | 'delete_fake' | 'delete_all' | 'snapshot' | 'restore' | 'rollback';
export type OpStatus = 'applied' | 'partial' | 'failed' | 'rolled_back';

export interface Operation {
  id: number;
  createdAt: number;
  author: string;
  kind: OpKind;
  summary: string;
  status: OpStatus;
  rollbackOf: number | null;
}

export interface ChangeRow {
  action: 'insert' | 'delete';
  recordId: string | null;
  clientId: string;
  start: number;
  end: number;
  count: number;
  ok: boolean;
}

export interface Snapshot {
  id: number;
  createdAt: number;
  author: string;
  label: string;
  recordCount: number;
  stepSum: number;
}

export interface SnapshotRecord {
  clientId: string;
  start: number;
  end: number;
  count: number;
}

// ---- operations ------------------------------------------------------------------------

type OpRow = { id: number; created_at: number; author: string; kind: OpKind; summary: string; status: OpStatus; rollback_of: number | null };
const toOp = (r: OpRow): Operation => ({
  id: r.id,
  createdAt: r.created_at,
  author: r.author,
  kind: r.kind,
  summary: r.summary,
  status: r.status,
  rollbackOf: r.rollback_of,
});

/** Writes one operation and its changes atomically. Returns the new operation id. */
export function recordOperation(
  op: Omit<Operation, 'id'>,
  changes: ChangeRow[],
): number {
  let id = 0;
  db.withTransactionSync(() => {
    id = db.runSync(
      'INSERT INTO operations (created_at, author, kind, summary, status, rollback_of) VALUES (?, ?, ?, ?, ?, ?)',
      [op.createdAt, op.author, op.kind, op.summary, op.status, op.rollbackOf],
    ).lastInsertRowId;
    for (const c of changes) {
      db.runSync(
        'INSERT INTO changes (op_id, action, record_id, client_id, start_ms, end_ms, count, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, c.action, c.recordId, c.clientId, c.start, c.end, c.count, c.ok ? 1 : 0],
      );
    }
  });
  return id;
}

export const setOperationStatus = (id: number, status: OpStatus) =>
  db.runSync('UPDATE operations SET status = ? WHERE id = ?', [status, id]);

export const listOperations = (limit = 200): Operation[] =>
  db.getAllSync<OpRow>('SELECT * FROM operations ORDER BY id DESC LIMIT ?', [limit]).map(toOp);

/**
 * Deletes history entries older than `before` (epoch ms; Infinity = all). Their per-record
 * changes go too (cascade), so those operations can no longer be undone. Health data and
 * snapshots are untouched. Returns how many entries were removed.
 */
export function pruneOperations(before: number): number {
  const cutoff = Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER;
  let removed = 0;
  db.withTransactionSync(() => {
    // An "undo" entry points at the entry it undid; detach links to rows being deleted.
    db.runSync('UPDATE operations SET rollback_of = NULL WHERE rollback_of IN (SELECT id FROM operations WHERE created_at < ?)', [cutoff]);
    removed = db.runSync('DELETE FROM operations WHERE created_at < ?', [cutoff]).changes;
  });
  return removed;
}

export const countOperationsBefore = (before: number): number =>
  db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM operations WHERE created_at < ?', [
    Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER,
  ])?.n ?? 0;

export const getOperation = (id: number): Operation | null => {
  const r = db.getFirstSync<OpRow>('SELECT * FROM operations WHERE id = ?', [id]);
  return r ? toOp(r) : null;
};

type ChangeDbRow = { action: 'insert' | 'delete'; record_id: string | null; client_id: string; start_ms: number; end_ms: number; count: number; ok: number };
export const getChanges = (opId: number): ChangeRow[] =>
  db
    .getAllSync<ChangeDbRow>('SELECT * FROM changes WHERE op_id = ? ORDER BY id', [opId])
    .map((r) => ({ action: r.action, recordId: r.record_id, clientId: r.client_id, start: r.start_ms, end: r.end_ms, count: r.count, ok: r.ok === 1 }));

// ---- snapshots -------------------------------------------------------------------------

type SnapRow = { id: number; created_at: number; author: string; label: string; record_count: number; step_sum: number };
const toSnap = (r: SnapRow): Snapshot => ({
  id: r.id,
  createdAt: r.created_at,
  author: r.author,
  label: r.label,
  recordCount: r.record_count,
  stepSum: r.step_sum,
});

export function saveSnapshot(meta: { createdAt: number; author: string; label: string }, records: SnapshotRecord[]): number {
  let id = 0;
  db.withTransactionSync(() => {
    id = db.runSync(
      'INSERT INTO snapshots (created_at, author, label, record_count, step_sum) VALUES (?, ?, ?, ?, ?)',
      [meta.createdAt, meta.author, meta.label, records.length, records.reduce((a, r) => a + r.count, 0)],
    ).lastInsertRowId;
    for (const r of records) {
      db.runSync('INSERT INTO snapshot_records (snapshot_id, client_id, start_ms, end_ms, count) VALUES (?, ?, ?, ?, ?)', [
        id,
        r.clientId,
        r.start,
        r.end,
        r.count,
      ]);
    }
  });
  return id;
}

export const listSnapshots = (): Snapshot[] =>
  db.getAllSync<SnapRow>('SELECT * FROM snapshots ORDER BY id DESC').map(toSnap);

export const getSnapshot = (id: number): Snapshot | null => {
  const r = db.getFirstSync<SnapRow>('SELECT * FROM snapshots WHERE id = ?', [id]);
  return r ? toSnap(r) : null;
};

export const getSnapshotRecords = (id: number): SnapshotRecord[] =>
  db
    .getAllSync<{ client_id: string; start_ms: number; end_ms: number; count: number }>(
      'SELECT * FROM snapshot_records WHERE snapshot_id = ? ORDER BY start_ms',
      [id],
    )
    .map((r) => ({ clientId: r.client_id, start: r.start_ms, end: r.end_ms, count: r.count }));

export const deleteSnapshot = (id: number) => db.runSync('DELETE FROM snapshots WHERE id = ?', [id]);

// ---- settings --------------------------------------------------------------------------

export const getSetting = (key: string): string | null =>
  db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;

export const setSetting = (key: string, value: string) =>
  db.runSync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

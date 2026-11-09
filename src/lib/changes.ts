// The change engine. Every write to Health data goes through here:
//   plan…()  → a ChangeSet (what would be inserted/deleted), touches nothing
//   apply()  → executes it, journals every record in the operation history, and
//              auto-snapshots first if it deletes anything in bulk.
// Rollback = plan the inverse of a past operation and apply that (like a DB migration
// "down"), recorded as its own operation.

import { Platform } from 'react-native';
import {
  getChanges,
  getOperation,
  getSetting,
  getSnapshot,
  getSnapshotRecords,
  recordOperation,
  saveSnapshot,
  setOperationStatus,
  type ChangeRow,
  type OpKind,
  type OpStatus,
  type SnapshotRecord,
} from './db';
import { deleteRecords, fakeClientId, insertRaw, readOwnRecords, type OwnRecord } from './health';
import type { Chunk } from './steps';
import { formatInput, formatNumber, HOUR } from './time';

const DAY = 24 * HOUR;

/**
 * How far back "everything this app wrote" reaches. Android 12's standalone Health
 * Connect only lets apps read ~30 days back; HealthKit has no such limit.
 * 29 (not 30) because readOwnRecords() reads one extra day to catch records that
 * started before the range — together that's exactly 30 days.
 */
export const LOOKBACK_MS = Platform.OS === 'android' ? 29 * DAY : 3650 * DAY;

export interface RecordData {
  start: number;
  end: number;
  count: number;
  clientId: string;
}

export interface ChangeSet {
  kind: OpKind;
  /** Shown in the review sheet, e.g. "Delete all fake records". */
  title: string;
  /** Stored in history, e.g. "Deleted 12 fake records (8,400 steps)". */
  summary: string;
  inserts: RecordData[];
  deletes: OwnRecord[];
  /** Steps currently written by this app (all records in reach), for before → after. */
  ownBefore: number;
  rollbackOf?: number;
  /** Only for kind 'snapshot'. */
  snapshot?: { label: string; records: SnapshotRecord[] };
}

export interface ApplyResult {
  opId: number;
  status: OpStatus;
  error?: string;
}

export const author = () => getSetting('author') || 'Me';

const sum = (rs: { count: number }[]) => rs.reduce((a, r) => a + r.count, 0);
const describe = (rs: { count: number }[]) =>
  `${rs.length} record${rs.length === 1 ? '' : 's'} (${formatNumber(sum(rs))} steps)`;
const key = (r: RecordData) => `${r.clientId}|${r.start}|${r.end}|${r.count}`;

/** Everything this app has written that the platform still lets us read. */
export async function allOwnRecords(): Promise<OwnRecord[]> {
  const now = Date.now();
  return readOwnRecords(now - LOOKBACK_MS, now + DAY);
}

export const ownAfter = (cs: ChangeSet) => cs.ownBefore - sum(cs.deletes) + sum(cs.inserts);

// ---- planners --------------------------------------------------------------------------

/** New fake records (Inject button, presets, Spread). */
export async function planInsert(kind: 'inject' | 'spread', chunks: Chunk[]): Promise<ChangeSet> {
  const own = await allOwnRecords();
  const inserts = chunks.map((c) => ({ start: c.start, end: c.end, count: c.count, clientId: fakeClientId(c) }));
  return {
    kind,
    title: kind === 'spread' ? `Spread ${formatNumber(sum(inserts))} steps across today` : `Inject ${formatNumber(sum(inserts))} steps`,
    summary: `${kind === 'spread' ? 'Spread' : 'Injected'} ${describe(inserts)}`,
    inserts,
    deletes: [],
    ownBefore: sum(own),
  };
}

/** Delete specific records (trash button on a record). */
export async function planDelete(records: OwnRecord[]): Promise<ChangeSet> {
  const own = await allOwnRecords();
  return { kind: 'delete', title: 'Delete record', summary: `Deleted ${describe(records)}`, inserts: [], deletes: records, ownBefore: sum(own) };
}

/** Every fake record this app wrote. Other apps' data is never touched. */
export async function planDeleteFake(): Promise<ChangeSet> {
  const own = await allOwnRecords();
  const deletes = own.filter((r) => r.kind === 'fake');
  return { kind: 'delete_fake', title: 'Delete all fake records', summary: `Deleted all fake: ${describe(deletes)}`, inserts: [], deletes, ownBefore: sum(own) };
}

/** Everything this app wrote (fake + legacy + untagged). Other apps' data is never touched. */
export async function planDeleteAll(): Promise<ChangeSet> {
  const own = await allOwnRecords();
  return { kind: 'delete_all', title: 'Delete everything this app wrote', summary: `Deleted everything: ${describe(own)}`, inserts: [], deletes: own, ownBefore: sum(own) };
}

export async function planSnapshot(label: string): Promise<ChangeSet> {
  const own = await allOwnRecords();
  const records = own.map(({ clientId, start, end, count }) => ({ clientId, start, end, count }));
  return {
    kind: 'snapshot',
    title: `Take snapshot “${label}”`,
    summary: `Snapshot “${label}”: ${describe(records)}`,
    inserts: [],
    deletes: [],
    ownBefore: sum(own),
    snapshot: { label, records },
  };
}

/** Make this app's records match the snapshot exactly: delete extras, re-add missing. */
export async function planRestore(snapshotId: number): Promise<ChangeSet> {
  const snap = getSnapshot(snapshotId);
  if (!snap) throw new Error(`Snapshot #${snapshotId} not found`);
  const target = getSnapshotRecords(snapshotId);
  const own = await allOwnRecords();
  const targetKeys = new Set(target.map(key));
  const ownKeys = new Set(own.map(key));
  const deletes = own.filter((r) => !targetKeys.has(key(r)));
  const inserts = target.filter((r) => !ownKeys.has(key(r)));
  return {
    kind: 'restore',
    title: `Restore snapshot “${snap.label}”`,
    summary: `Restored “${snap.label}” (${formatInput(new Date(snap.createdAt))}): −${deletes.length} / +${inserts.length} records`,
    inserts,
    deletes,
    ownBefore: sum(own),
  };
}

/**
 * Undo a past operation: delete what it inserted (if still there) and re-add what it
 * deleted (if not already back). Re-added records get new platform ids.
 */
export async function planRollback(opId: number): Promise<ChangeSet> {
  const op = getOperation(opId);
  if (!op) throw new Error(`Operation #${opId} not found`);
  const changes = getChanges(opId).filter((c) => c.ok);
  const own = await allOwnRecords();
  const byId = new Map(own.map((r) => [r.id, r]));
  const ownKeys = new Set(own.map(key));
  const deletes = changes
    .filter((c) => c.action === 'insert' && c.recordId && byId.has(c.recordId))
    .map((c) => byId.get(c.recordId!)!);
  const inserts = changes
    .filter((c) => c.action === 'delete' && !ownKeys.has(key(c)))
    .map(({ clientId, start, end, count }) => ({ clientId, start, end, count }));
  return {
    kind: 'rollback',
    title: `Undo #${op.id}: ${op.summary}`,
    summary: `Undid #${op.id} (${op.summary}): −${deletes.length} / +${inserts.length} records`,
    inserts,
    deletes,
    ownBefore: sum(own),
    rollbackOf: op.id,
  };
}

// ---- apply -----------------------------------------------------------------------------

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const BULK: OpKind[] = ['delete_fake', 'delete_all', 'restore', 'rollback'];

/** Executes a ChangeSet against the health store and journals it. */
export async function apply(cs: ChangeSet): Promise<ApplyResult> {
  const who = author();
  const now = Date.now();

  if (cs.kind === 'snapshot' && cs.snapshot) {
    saveSnapshot({ createdAt: now, author: who, label: cs.snapshot.label }, cs.snapshot.records);
    const opId = recordOperation({ createdAt: now, author: who, kind: 'snapshot', summary: cs.summary, status: 'applied', rollbackOf: null }, []);
    return { opId, status: 'applied' };
  }

  // Safety net: bulk deletions are always preceded by an automatic snapshot.
  if (BULK.includes(cs.kind) && cs.deletes.length > 0) {
    const own = await allOwnRecords();
    saveSnapshot(
      { createdAt: now, author: who, label: `Auto before: ${cs.title}` },
      own.map(({ clientId, start, end, count }) => ({ clientId, start, end, count })),
    );
  }

  const rows: ChangeRow[] = [];
  let error: string | undefined;

  if (cs.deletes.length) {
    let ok = true;
    try {
      await deleteRecords(cs.deletes.map((r) => r.id));
    } catch (e) {
      ok = false;
      error = errText(e);
    }
    for (const r of cs.deletes) rows.push({ action: 'delete', recordId: r.id, clientId: r.clientId, start: r.start, end: r.end, count: r.count, ok });
  }

  if (cs.inserts.length) {
    let ids: string[] = [];
    let ok = true;
    try {
      ids = await insertRaw(cs.inserts);
    } catch (e) {
      ok = false;
      error = error ?? errText(e);
    }
    cs.inserts.forEach((r, i) => rows.push({ action: 'insert', recordId: ids[i] ?? null, clientId: r.clientId, start: r.start, end: r.end, count: r.count, ok }));
  }

  const okCount = rows.filter((r) => r.ok).length;
  const status: OpStatus = rows.length === 0 || okCount === rows.length ? 'applied' : okCount > 0 ? 'partial' : 'failed';
  const opId = recordOperation(
    { createdAt: now, author: who, kind: cs.kind, summary: error ? `${cs.summary} — ${error}` : cs.summary, status, rollbackOf: cs.rollbackOf ?? null },
    rows,
  );
  if (cs.rollbackOf && status !== 'failed') setOperationStatus(cs.rollbackOf, 'rolled_back');
  return { opId, status, error };
}

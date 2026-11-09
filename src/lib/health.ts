// App-level wrapper around the health-store native module (Health Connect on Android,
// HealthKit on iOS) for step data. Screens use this, never the module directly.

import HealthStore, { type HealthPermissions, type HourBucket, type StepRecord } from '../../modules/health-store';
import type { Chunk, Range } from './steps';

/** clientId prefixes so we can tell what kind of record we wrote. */
export const FAKE_PREFIX = 'fake-';
/** Written by the removed v1.0 background step sync. Still shown, labelled "legacy". */
export const LEGACY_REAL_PREFIX = 'real-';

export type Availability = 'available' | 'unavailable' | 'update_required';
export type PermissionState = HealthPermissions;
export type { HourBucket };

/** Platform health store status (Health Connect installed / up to date; HealthKit present). */
export async function checkAvailability(): Promise<Availability> {
  return HealthStore.getStatus();
}

export const getPermissionState = () => HealthStore.getPermissions();
export const requestStepsPermissions = () => HealthStore.requestPermissions();
export const openHealthSettings = () => HealthStore.openHealthSettings();

/** Read access counts as OK when the platform can't tell (iOS). */
export const hasAccess = (p: PermissionState) => p.write && p.read !== false;

export type RecordKind = 'fake' | 'legacy' | 'other';

export interface OwnRecord extends Range {
  id: string;
  count: number;
  clientId: string;
  kind: RecordKind;
}

const kindOf = (clientId: string): RecordKind =>
  clientId.startsWith(FAKE_PREFIX) ? 'fake' : clientId.startsWith(LEGACY_REAL_PREFIX) ? 'legacy' : 'other';

const toOwn = (r: StepRecord): OwnRecord => ({ ...r, kind: kindOf(r.clientId) });

/** Step records written by THIS app that touch [start, end]. */
export async function readOwnRecords(start: number, end: number): Promise<OwnRecord[]> {
  return (await HealthStore.readOwnSteps(start, end)).map(toOwn);
}

/** Total steps in the range from ALL sources, deduplicated by the platform. */
export const aggregateSteps = (start: number, end: number) => HealthStore.totalSteps(start, end);

/** Hourly buckets for a chart: total (all sources) and own (this app). */
export const hourlySteps = (start: number, end: number) => HealthStore.hourlySteps(start, end);

export const fakeClientId = (c: Range) => `${FAKE_PREFIX}${c.start}-${c.end}`;

/** Inserts one fake step record per chunk. Returns the new platform ids (same order). */
export async function insertChunks(chunks: Chunk[]): Promise<string[]> {
  return HealthStore.insertSteps(chunks.map((c) => ({ start: c.start, end: c.end, count: c.count, clientId: fakeClientId(c) })));
}

/** Re-inserts records exactly as they were (snapshot restore / rollback). */
export async function insertRaw(records: { start: number; end: number; count: number; clientId: string }[]): Promise<string[]> {
  return HealthStore.insertSteps(records);
}

export const deleteRecords = (ids: string[]) => HealthStore.deleteSteps(ids);
export const deleteRecord = (id: string) => HealthStore.deleteSteps([id]);

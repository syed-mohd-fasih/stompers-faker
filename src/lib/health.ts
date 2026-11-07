// Thin wrapper around react-native-health-connect for the Steps record type.

import Constants from 'expo-constants';
import {
  aggregateRecord,
  deleteRecordsByUuids,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  type Permission,
} from 'react-native-health-connect';
import type { Chunk, Range } from './steps';

/** Our own package name; used to filter Health Connect data by origin. */
export const APP_PACKAGE = Constants.expoConfig?.android?.package ?? 'dev.fasih.stompersfaker';

/** clientRecordId prefixes so we can tell our fake vs. real (sensor) records apart. */
export const FAKE_PREFIX = 'fake-';
export const REAL_PREFIX = 'real-'; // written by the native step-sync module

const PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'write', recordType: 'Steps' },
];

export type Availability = 'available' | 'unavailable' | 'update_required';

/** Checks the SDK status and initializes the client if Health Connect is usable. */
export async function checkAvailability(): Promise<Availability> {
  const status = await getSdkStatus();
  if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE) return 'unavailable';
  if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update_required';
  const ok = await initialize();
  if (!ok) throw new Error('Health Connect initialize() returned false');
  return 'available';
}

export interface PermissionState {
  read: boolean;
  write: boolean;
}

function toState(granted: { accessType: string; recordType?: string }[]): PermissionState {
  const has = (t: string) => granted.some((p) => p.recordType === 'Steps' && p.accessType === t);
  return { read: has('read'), write: has('write') };
}

export async function getPermissionState(): Promise<PermissionState> {
  return toState(await getGrantedPermissions());
}

export async function requestStepsPermissions(): Promise<PermissionState> {
  return toState(await requestPermission(PERMISSIONS));
}

export { openHealthConnectSettings };

export interface OwnRecord extends Range {
  id: string;
  count: number;
  kind: 'fake' | 'real' | 'other';
}

/** Reads Steps records written by THIS app that touch [start, end]. Handles paging. */
export async function readOwnRecords(start: number, end: number): Promise<OwnRecord[]> {
  const out: OwnRecord[] = [];
  let pageToken: string | undefined;
  do {
    const res = await readRecords('Steps', {
      timeRangeFilter: { operator: 'between', startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() },
      dataOriginFilter: [APP_PACKAGE],
      ascendingOrder: true,
      pageSize: 1000,
      pageToken,
    });
    for (const r of res.records) {
      const cid = r.metadata?.clientRecordId ?? '';
      out.push({
        id: r.metadata?.id ?? '',
        start: Date.parse(r.startTime),
        end: Date.parse(r.endTime),
        count: r.count,
        kind: cid.startsWith(FAKE_PREFIX) ? 'fake' : cid.startsWith(REAL_PREFIX) ? 'real' : 'other',
      });
    }
    pageToken = res.pageToken || undefined;
  } while (pageToken);
  return out;
}

/** Total steps in the range from ALL apps, deduplicated by Health Connect. */
export async function aggregateSteps(start: number, end: number): Promise<number> {
  const res = await aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter: { operator: 'between', startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() },
  });
  return res.COUNT_TOTAL;
}

/** Inserts one Steps record per chunk. Returns the new record ids. */
export async function insertChunks(chunks: Chunk[]): Promise<string[]> {
  return insertRecords(
    chunks.map((c) => ({
      recordType: 'Steps' as const,
      startTime: new Date(c.start).toISOString(),
      endTime: new Date(c.end).toISOString(),
      count: c.count,
      metadata: { clientRecordId: `${FAKE_PREFIX}${c.start}-${c.end}` },
    })),
  );
}

export async function deleteRecord(id: string): Promise<void> {
  await deleteRecordsByUuids('Steps', [id], []);
}

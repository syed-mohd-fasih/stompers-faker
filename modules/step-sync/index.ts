// TS side of the local StepSync native module (Android only).
import { PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface StepSyncStatus {
  enabled: boolean;
  /** epoch ms of the last successful write */
  lastSyncTime: number | null;
  /** epoch ms of the last run (successful or not) */
  lastRunTime: number | null;
  lastDelta: number | null;
  lastError: string | null;
  lastMessage: string | null;
  baselineSet: boolean;
  sensorAvailable: boolean;
  hasActivityPermission: boolean;
}

interface NativeStepSync {
  enableSync(): void;
  disableSync(): void;
  getStatus(): StepSyncStatus;
  setBlockedRanges(flat: number[]): void;
  syncNow(): Promise<string>;
}

// Optional so the JS doesn't crash on a build that doesn't include the module yet.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeStepSync>('StepSync') : null;

function mod(): NativeStepSync {
  if (!native) throw new Error('StepSync native module not found. Rebuild the app (bunx expo run:android).');
  return native;
}

export const isAvailable = native != null;

/** Asks for ACTIVITY_RECOGNITION (needed for the step counter sensor). */
export async function requestActivityPermission(): Promise<boolean> {
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export const enableSync = () => mod().enableSync();
export const disableSync = () => mod().disableSync();
export const getStatus = () => mod().getStatus();
export const syncNow = () => mod().syncNow();

/** Tells the background job which time ranges are taken by fake records. */
export function setBlockedRanges(ranges: { start: number; end: number }[]): void {
  native?.setBlockedRanges(ranges.flatMap((r) => [r.start, r.end]));
}

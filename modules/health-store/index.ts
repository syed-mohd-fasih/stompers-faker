// JS side of the health-store native module. Same API on both platforms:
//   Android → Health Connect (Kotlin, android/…/HealthStoreModule.kt)
//   iOS     → HealthKit      (Swift,  ios/HealthStoreModule.swift)
// Times are epoch milliseconds.

import { requireNativeModule } from 'expo';

export type HealthStatus = 'available' | 'unavailable' | 'update_required';

export interface HealthPermissions {
  /** iOS never reveals read access (HealthKit privacy), so it reports 'unknown'. */
  read: boolean | 'unknown';
  write: boolean;
}

export interface StepInput {
  start: number;
  end: number;
  count: number;
  /** Our own id (e.g. "fake-<start>-<end>"); used to recognise our records later. */
  clientId: string;
}

export interface StepRecord extends StepInput {
  /** Platform id (Health Connect record id / HealthKit sample UUID). */
  id: string;
}

export interface HourBucket {
  start: number;
  /** All sources, deduplicated by the platform. */
  total: number;
  /** Written by this app. */
  own: number;
}

interface NativeHealthStore {
  getStatus(): HealthStatus;
  getPermissions(): Promise<HealthPermissions>;
  requestPermissions(): Promise<HealthPermissions>;
  insertSteps(records: StepInput[]): Promise<string[]>;
  readOwnSteps(start: number, end: number): Promise<StepRecord[]>;
  deleteSteps(ids: string[]): Promise<void>;
  totalSteps(start: number, end: number): Promise<number>;
  hourlySteps(start: number, end: number): Promise<HourBucket[]>;
  openHealthSettings(): void;
}

const HealthStore = requireNativeModule<NativeHealthStore>('HealthStore');
export default HealthStore;

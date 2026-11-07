// State shared by all tabs: the log, Health Connect status/permissions,
// today's total and this app's records.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LogLine } from '@/components/ui';
import {
  aggregateSteps,
  checkAvailability,
  deleteRecord,
  getPermissionState,
  openHealthConnectSettings,
  readOwnRecords,
  requestStepsPermissions,
  type Availability,
  type OwnRecord,
  type PermissionState,
} from './health';
import { formatTime, startOfToday } from './time';
import { errMsg, useLog } from './useLog';
import { setBlockedRanges } from '../../modules/step-sync';

export type HcStatus = Availability | 'error' | 'checking';

interface AppState {
  log: { lines: LogLine[]; add: (msg: string) => void; clear: () => void };
  status: HcStatus;
  perms: PermissionState;
  /** HC available and both Steps permissions granted. */
  ready: boolean;
  /** Today's total from all apps (HC aggregate), null until loaded. */
  total: number | null;
  /** This app's records today. */
  records: OwnRecord[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  checkStatus: () => Promise<void>;
  grant: () => Promise<void>;
  openHcSettings: () => void;
  removeRecord: (r: OwnRecord) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const log = useLog(200);
  const addLog = log.add;
  const [status, setStatus] = useState<HcStatus>('checking');
  const [perms, setPerms] = useState<PermissionState>({ read: false, write: false });
  const [total, setTotal] = useState<number | null>(null);
  const [records, setRecords] = useState<OwnRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  /** Reloads today's aggregate total and this app's records. */
  const refresh = useCallback(async () => {
    const now = Date.now();
    const dayStart = startOfToday().getTime();
    setRefreshing(true);
    try {
      const [t, recs] = await Promise.all([aggregateSteps(dayStart, now), readOwnRecords(dayStart, now)]);
      setTotal(t);
      setRecords(recs);
      // Let the real-step background job know which times are taken by fake records.
      setBlockedRanges(recs.filter((r) => r.kind !== 'real'));
    } catch (e) {
      addLog(`Refresh failed: ${errMsg(e)}`);
    } finally {
      setRefreshing(false);
    }
  }, [addLog]);

  /** Checks availability + permissions, and refreshes data if everything is OK. */
  const checkStatus = useCallback(async () => {
    try {
      const a = await checkAvailability();
      setStatus(a);
      addLog(`Health Connect: ${a}`);
      if (a !== 'available') return;
      const p = await getPermissionState();
      setPerms(p);
      addLog(`Permissions: read ${p.read ? '✓' : '✗'} write ${p.write ? '✓' : '✗'}`);
      if (p.read && p.write) await refresh();
    } catch (e) {
      setStatus('error');
      addLog(`Status check failed: ${errMsg(e)}`);
    }
  }, [addLog, refresh]);

  // Check once on app start. (Started from a microtask: all state updates happen
  // after awaits anyway, this just keeps the hooks linter happy.)
  useEffect(() => {
    Promise.resolve().then(checkStatus);
  }, [checkStatus]);

  const grant = useCallback(async () => {
    try {
      const p = await requestStepsPermissions();
      setPerms(p);
      addLog(`Granted: read ${p.read ? '✓' : '✗'} write ${p.write ? '✓' : '✗'}`);
      if (p.read && p.write) await refresh();
      else addLog('Warning: not all permissions granted. If no dialog appeared, use HC settings.');
    } catch (e) {
      addLog(`Permission request failed: ${errMsg(e)}`);
    }
  }, [addLog, refresh]);

  const openHcSettings = useCallback(() => {
    try {
      openHealthConnectSettings();
    } catch (e) {
      addLog(`Open HC settings failed: ${errMsg(e)}`);
    }
  }, [addLog]);

  const removeRecord = useCallback(
    async (r: OwnRecord) => {
      try {
        await deleteRecord(r.id);
        addLog(`Deleted ${r.count} steps (${formatTime(new Date(r.start))}–${formatTime(new Date(r.end))})`);
        await refresh();
      } catch (e) {
        addLog(`Delete failed: ${errMsg(e)}`);
      }
    },
    [addLog, refresh],
  );

  const value = useMemo<AppState>(
    () => ({
      log,
      status,
      perms,
      ready: status === 'available' && perms.read && perms.write,
      total,
      records,
      refreshing,
      refresh,
      checkStatus,
      grant,
      openHcSettings,
      removeRecord,
    }),
    [log, status, perms, total, records, refreshing, refresh, checkStatus, grant, openHcSettings, removeRecord],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}

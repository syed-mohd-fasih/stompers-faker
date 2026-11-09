// State shared by all tabs: the debug log, health store status/permissions, today's
// total and this app's records — plus commit(), the one way screens change Health data.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useReview } from '@/components/ReviewSheet';
import type { LogLine } from '@/components/ui';
import { apply, planDelete, type ApplyResult, type ChangeSet } from './changes';
import {
  aggregateSteps,
  checkAvailability,
  getPermissionState,
  hasAccess,
  openHealthSettings,
  readOwnRecords,
  requestStepsPermissions,
  type Availability,
  type OwnRecord,
  type PermissionState,
} from './health';
import { startOfToday } from './time';
import { errMsg, useLog } from './useLog';

export type HcStatus = Availability | 'error' | 'checking';

/** ✓ / ✗ / ? (iOS can't report read access). */
export const mark = (v: boolean | 'unknown') => (v === 'unknown' ? '?' : v ? '✓' : '✗');

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
  /**
   * Plan → (optional preview) → apply → log → refresh. Returns null if the user cancelled
   * the preview or planning failed. `opts.review` shows the ReviewSheet first.
   */
  commit: (plan: () => Promise<ChangeSet>, opts?: { review?: boolean; confirmLabel?: string }) => Promise<ApplyResult | null>;
  /** Bumped after every commit; screens that list history/snapshots reload on change. */
  dataVersion: number;
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
  const [dataVersion, setDataVersion] = useState(0);
  const review = useReview();

  /** Reloads today's aggregate total and this app's records. */
  const refresh = useCallback(async () => {
    const now = Date.now();
    const dayStart = startOfToday().getTime();
    setRefreshing(true);
    try {
      const [t, recs] = await Promise.all([aggregateSteps(dayStart, now), readOwnRecords(dayStart, now)]);
      setTotal(t);
      setRecords(recs);
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
      addLog(`Permissions: read ${mark(p.read)} write ${mark(p.write)}`);
      if (hasAccess(p)) await refresh();
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
      addLog(`Granted: read ${mark(p.read)} write ${mark(p.write)}`);
      if (hasAccess(p)) await refresh();
      else addLog('Warning: not all permissions granted. If no dialog appeared, use HC settings.');
    } catch (e) {
      addLog(`Permission request failed: ${errMsg(e)}`);
    }
  }, [addLog, refresh]);

  const openHcSettings = useCallback(() => {
    try {
      openHealthSettings();
    } catch (e) {
      addLog(`Open HC settings failed: ${errMsg(e)}`);
    }
  }, [addLog]);

  const commit = useCallback<AppState['commit']>(
    async (plan, opts) => {
      let cs: ChangeSet;
      try {
        cs = await plan();
      } catch (e) {
        addLog(`Planning failed: ${errMsg(e)}`);
        return null;
      }
      if (opts?.review && !(await review(cs, { confirmLabel: opts.confirmLabel }))) {
        addLog(`Cancelled: ${cs.title}`);
        return null;
      }
      const res = await apply(cs);
      addLog(res.error ? `Failed (${res.status}): ${cs.summary} — ${res.error}` : `#${res.opId} ${cs.summary}`);
      setDataVersion((v) => v + 1);
      await refresh();
      return res;
    },
    [addLog, refresh, review],
  );

  const removeRecord = useCallback(
    async (r: OwnRecord) => {
      await commit(() => planDelete([r]));
    },
    [commit],
  );

  const value = useMemo<AppState>(
    () => ({
      log,
      status,
      perms,
      ready: status === 'available' && hasAccess(perms),
      total,
      records,
      refreshing,
      refresh,
      checkStatus,
      grant,
      openHcSettings,
      removeRecord,
      commit,
      dataVersion,
    }),
    [log, status, perms, total, records, refreshing, refresh, checkStatus, grant, openHcSettings, removeRecord, commit, dataVersion],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}

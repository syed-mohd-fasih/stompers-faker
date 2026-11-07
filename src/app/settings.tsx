// Settings: real-step sync (phone step counter → Health Connect). Off by default.

import { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { requestPermission } from 'react-native-health-connect';
import * as StepSync from '../../modules/step-sync';
import { formatClock, formatInput } from '@/lib/time';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fmt = (ms: number | null) => (ms ? `${formatInput(new Date(ms))}` : '—');

export default function Settings() {
  const [status, setStatus] = useState<StepSync.StepSyncStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [`${formatClock(new Date())}  ${msg}`, ...l].slice(0, 50));
  }, []);

  const reload = useCallback(() => {
    try {
      setStatus(StepSync.getStatus());
    } catch (e) {
      addLog(errMsg(e));
    }
  }, [addLog]);

  useEffect(() => {
    Promise.resolve().then(reload);
  }, [reload]);

  const sync = async () => {
    try {
      addLog(await StepSync.syncNow());
    } catch (e) {
      addLog(`Sync failed: ${errMsg(e)}`);
    }
    reload();
  };

  const toggle = async (on: boolean) => {
    try {
      if (on) {
        if (!(await StepSync.requestActivityPermission())) {
          addLog('Physical activity permission denied; sync not enabled.');
          return;
        }
        // Optional: lets the background job read our own records to avoid overlaps.
        // If Health Connect doesn't offer it, the app's mirrored ranges are used instead.
        await requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }]).catch(() => {});
        StepSync.enableSync();
        addLog('Sync enabled.');
        await sync(); // stores the baseline right away
      } else {
        StepSync.disableSync();
        addLog('Sync disabled.');
        reload();
      }
    } catch (e) {
      addLog(errMsg(e));
    }
  };

  if (!StepSync.isAvailable) {
    return <Text style={s.page}>StepSync native module missing. Rebuild with bunx expo run:android.</Text>;
  }

  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.row}>
        <Text style={s.h}>Real-step sync</Text>
        <Switch value={status?.enabled ?? false} onValueChange={toggle} />
      </View>
      <Text>Reads the phone&apos;s step counter every ~15 min and writes new steps to Health Connect,
        even with the app closed. Fake and real records never overlap.</Text>

      <Text style={s.h}>Status</Text>
      <Text>Enabled: {String(status?.enabled ?? false)}</Text>
      <Text>Sensor available: {String(status?.sensorAvailable ?? '?')}</Text>
      <Text>Activity permission: {String(status?.hasActivityPermission ?? '?')}</Text>
      <Text>Baseline set: {String(status?.baselineSet ?? '?')}</Text>
      <Text>Last run: {fmt(status?.lastRunTime ?? null)}</Text>
      <Text>Last sync (write): {fmt(status?.lastSyncTime ?? null)}</Text>
      <Text>Last delta: {status?.lastDelta ?? '—'}</Text>
      <Text>Last message: {status?.lastMessage ?? '—'}</Text>
      <Text style={s.err}>Last error: {status?.lastError ?? '—'}</Text>
      <View style={s.row}>
        <Button title="Sync now" onPress={sync} disabled={!status?.enabled} />
        <Button title="Refresh status" onPress={reload} />
      </View>

      <Text style={s.note}>
        On Huawei: Settings → Battery → App launch → this app → Manage manually, enable all 3 toggles, or
        background sync will stop.
      </Text>

      <Text style={s.h}>Log</Text>
      {log.map((l, i) => <Text key={i} style={s.log}>{l}</Text>)}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 6, paddingBottom: 48 },
  h: { fontWeight: 'bold', fontSize: 16, marginTop: 14 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  err: { color: '#b91c1c' },
  note: { marginTop: 14, padding: 10, backgroundColor: '#fef3c7', borderRadius: 4 },
  log: { fontFamily: 'monospace', fontSize: 12 },
});

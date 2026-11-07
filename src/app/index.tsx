// Main screen: Health Connect status, fake-step injection, today's total,
// this app's records, and a log. Deliberately plain UI.

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  aggregateSteps,
  checkAvailability,
  deleteRecord,
  getPermissionState,
  insertChunks,
  openHealthConnectSettings,
  readOwnRecords,
  requestStepsPermissions,
  type Availability,
  type OwnRecord,
  type PermissionState,
} from '@/lib/health';
import { autoShift, findOverlaps, spreadAcrossToday, validateChunk, type Chunk } from '@/lib/steps';
import { formatClock, formatInput, formatTime, HOUR, MINUTE, parseInput, startOfToday } from '@/lib/time';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Asks the user what to do about overlaps. Resolves to their choice. */
function askOverlap(n: number): Promise<'shift' | 'anyway' | 'cancel'> {
  return new Promise((resolve) => {
    Alert.alert('Overlap', `${n} of this app's records overlap that time range.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
      { text: 'Insert anyway', onPress: () => resolve('anyway') },
      { text: 'Auto-shift', onPress: () => resolve('shift') },
    ], { cancelable: true, onDismiss: () => resolve('cancel') });
  });
}

export default function Home() {
  const [availability, setAvailability] = useState<Availability | 'error' | 'checking'>('checking');
  const [perms, setPerms] = useState<PermissionState>({ read: false, write: false });
  const [count, setCount] = useState('1000');
  const [startText, setStartText] = useState(() => formatInput(new Date(Date.now() - HOUR)));
  const [endText, setEndText] = useState(() => formatInput(new Date()));
  const [total, setTotal] = useState<number | null>(null);
  const [records, setRecords] = useState<OwnRecord[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [`${formatClock(new Date())}  ${msg}`, ...l].slice(0, 100));
  }, []);

  const ready = availability === 'available' && perms.read && perms.write;

  /** Reloads today's aggregate total and this app's records. */
  const refresh = useCallback(async () => {
    const now = Date.now();
    const dayStart = startOfToday().getTime();
    try {
      const [t, recs] = await Promise.all([aggregateSteps(dayStart, now), readOwnRecords(dayStart, now)]);
      setTotal(t);
      setRecords(recs);
    } catch (e) {
      addLog(`Refresh failed: ${errMsg(e)}`);
    }
  }, [addLog]);

  /** Checks availability + permissions, and refreshes data if everything is OK. */
  const checkStatus = useCallback(async () => {
    try {
      const a = await checkAvailability();
      setAvailability(a);
      addLog(`Health Connect: ${a}`);
      if (a !== 'available') return;
      const p = await getPermissionState();
      setPerms(p);
      addLog(`Permissions: read=${p.read} write=${p.write}`);
      if (p.read && p.write) await refresh();
    } catch (e) {
      setAvailability('error');
      addLog(`Status check failed: ${errMsg(e)}`);
    }
  }, [addLog, refresh]);

  // Check once on mount. (Started from a microtask: all state updates happen
  // after awaits anyway, this just keeps the hooks linter happy.)
  useEffect(() => {
    Promise.resolve().then(checkStatus);
  }, [checkStatus]);

  const grant = async () => {
    try {
      const p = await requestStepsPermissions();
      setPerms(p);
      addLog(`Granted: read=${p.read} write=${p.write}`);
      if (p.read && p.write) await refresh();
      else addLog('Not all permissions granted. If no dialog appeared, use "Open HC settings".');
    } catch (e) {
      addLog(`Permission request failed: ${errMsg(e)}`);
    }
  };

  /**
   * Validates, checks for overlaps with this app's records (fake and real),
   * then inserts. Used by the Inject button and both time-range presets.
   */
  const injectRange = async (steps: number, start: Date | null, end: Date | null) => {
    const v = validateChunk(steps, start, end);
    if (v.errors.length) {
      v.errors.forEach((e) => addLog(`Invalid: ${e}`));
      return;
    }
    v.warnings.forEach((w) => addLog(`Warning: ${w}`));
    let range = { start: start!.getTime(), end: end!.getTime() };

    setBusy(true);
    try {
      // Read a wider window so long records that start earlier are caught too.
      const nearby = await readOwnRecords(range.start - 12 * HOUR, range.end + 12 * HOUR);
      const hits = findOverlaps(range, nearby);
      if (hits.length) {
        const choice = await askOverlap(hits.length);
        if (choice === 'cancel') return addLog('Inject cancelled (overlap).');
        if (choice === 'shift') {
          const shifted = autoShift(range, nearby);
          if (!shifted) return addLog('Auto-shift failed: no free slot of that length.');
          range = shifted;
          addLog(`Shifted to ${formatInput(new Date(range.start))} → ${formatTime(new Date(range.end))}`);
        }
      }
      const ids = await insertChunks([{ ...range, count: steps }]);
      addLog(`Inserted ${steps} steps (${formatTime(new Date(range.start))}–${formatTime(new Date(range.end))}), id ${ids[0] ?? '?'}`);
      await refresh();
    } catch (e) {
      addLog(`Insert failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const inject = () => injectRange(Number(count), parseInput(startText), parseInput(endText));

  const preset = (steps: number, minutes: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * MINUTE);
    setCount(String(steps));
    setStartText(formatInput(start));
    setEndText(formatInput(end));
    injectRange(steps, start, end);
  };

  const spread = async () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) return addLog('Invalid: count must be 1–100000.');
    setBusy(true);
    try {
      const now = Date.now();
      // Avoid everything this app already wrote today.
      const existing = await readOwnRecords(startOfToday().getTime() - 12 * HOUR, now);
      const chunks: Chunk[] = spreadAcrossToday(n, existing, now);
      if (chunks.length === 0) return addLog('Spread failed: no free time left today.');
      const minutes = chunks.reduce((a, c) => a + (c.end - c.start) / MINUTE, 0);
      if (n / minutes > 200) addLog(`Warning: average pace ${Math.round(n / minutes)} steps/min.`);
      await insertChunks(chunks);
      addLog(`Spread ${n} steps over ${chunks.length} chunks (${Math.round(minutes)} min walking).`);
      await refresh();
    } catch (e) {
      addLog(`Spread failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: OwnRecord) => {
    try {
      await deleteRecord(r.id);
      addLog(`Deleted ${r.count} steps (${formatTime(new Date(r.start))}–${formatTime(new Date(r.end))})`);
      await refresh();
    } catch (e) {
      addLog(`Delete failed: ${errMsg(e)}`);
    }
  };

  // Live validation hints under the inputs.
  const live = validateChunk(Number(count), parseInput(startText), parseInput(endText));

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.h}>Status</Text>
      <Text>Health Connect: {availability}</Text>
      {availability === 'unavailable' && <Text>Health Connect is not installed. Install the Health Connect APK.</Text>}
      {availability === 'update_required' && <Text>Health Connect needs an update. Update the APK, then Re-check.</Text>}
      <Text>Permissions: read={String(perms.read)} write={String(perms.write)}</Text>
      <View style={s.row}>
        <Button title="Grant" onPress={grant} disabled={availability !== 'available'} />
        <Button title="Re-check" onPress={checkStatus} />
        <Button title="Open HC settings" onPress={() => { try { openHealthConnectSettings(); } catch (e) { addLog(errMsg(e)); } }} />
      </View>

      <Text style={s.h}>Today: {total ?? '—'} steps (all apps, deduped)</Text>

      <Text style={s.h}>Inject</Text>
      <Text>Steps</Text>
      <TextInput style={s.input} value={count} onChangeText={setCount} keyboardType="number-pad" />
      <Text>Start (YYYY-MM-DD HH:MM)</Text>
      <TextInput style={s.input} value={startText} onChangeText={setStartText} />
      <Text>End</Text>
      <TextInput style={s.input} value={endText} onChangeText={setEndText} />
      {[...live.errors, ...live.warnings].map((m) => <Text key={m} style={s.warn}>{m}</Text>)}
      <View style={s.row}>
        <Button title="Inject" onPress={inject} disabled={!ready || busy} />
        <Button title="Last 60 min" onPress={() => { setStartText(formatInput(new Date(Date.now() - HOUR))); setEndText(formatInput(new Date())); }} />
      </View>
      <View style={s.row}>
        <Button title="+1k (10 min)" onPress={() => preset(1000, 10)} disabled={!ready || busy} />
        <Button title="+5k (1 hr)" onPress={() => preset(5000, 60)} disabled={!ready || busy} />
      </View>
      <Button title={`Spread ${count || 'N'} steps across today`} onPress={spread} disabled={!ready || busy} />

      <Text style={s.h}>This app&apos;s records today ({records.length})</Text>
      <Button title="Refresh" onPress={refresh} disabled={!ready} />
      {records.map((r) => (
        <View key={r.id} style={s.row}>
          <Text style={s.flex}>
            {formatTime(new Date(r.start))}–{formatTime(new Date(r.end))}  {r.count}  [{r.kind}]
          </Text>
          <Button title="Delete" onPress={() => remove(r)} />
        </View>
      ))}

      <Text style={s.h}>Log</Text>
      <Button title="Clear log" onPress={() => setLog([])} />
      {log.map((l, i) => <Text key={i} style={s.log}>{l}</Text>)}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 6, paddingBottom: 48 },
  h: { fontWeight: 'bold', fontSize: 16, marginTop: 14 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  flex: { flex: 1 },
  input: { borderWidth: 1, borderColor: '#999', padding: 8, borderRadius: 4 },
  warn: { color: '#b45309' },
  log: { fontFamily: 'monospace', fontSize: 12 },
});

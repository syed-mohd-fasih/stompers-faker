// Main screen: Health Connect status, fake-step injection, today's total,
// this app's records, and a log.

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Banner,
  Button,
  Card,
  Field,
  Icon,
  IconButton,
  LogPanel,
  Pill,
  Sheet,
  Tag,
  TextButton,
  Title,
  type Tone,
} from '@/components/ui';
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
import { autoShift, findOverlaps, MAX_SANE_PACE, spreadAcrossToday, validateChunk, type Range } from '@/lib/steps';
import { formatInput, formatNumber, formatTime, HOUR, MINUTE, parseInput, startOfToday } from '@/lib/time';
import { errMsg, useLog } from '@/lib/useLog';
import { setBlockedRanges } from '../../modules/step-sync';

type Status = Availability | 'error' | 'checking';
type OverlapChoice = 'shift' | 'anyway' | 'cancel';

const icon = require('../../assets/brand/icon-96.png');
const span = (r: Range) => `${formatTime(new Date(r.start))}–${formatTime(new Date(r.end))}`;

/** Status pill + optional banner for each Health Connect state. */
function describe(status: Status, perms: PermissionState) {
  const ready = status === 'available' && perms.read && perms.write;
  const pill: { tone: Tone; label: string } =
    status === 'checking' ? { tone: 'neutral', label: 'Checking…' }
    : ready ? { tone: 'ok', label: 'Health Connect ready' }
    : status === 'available' ? { tone: 'warn', label: 'Permissions needed' }
    : status === 'unavailable' ? { tone: 'danger', label: 'Not installed' }
    : status === 'update_required' ? { tone: 'danger', label: 'Update needed' }
    : { tone: 'danger', label: 'Error' };
  const banner =
    status === 'unavailable' ? { title: 'Health Connect isn’t installed.', text: 'Install the Health Connect APK, then tap Re-check.' }
    : status === 'update_required' ? { title: 'Health Connect needs an update.', text: 'Install a newer Health Connect APK, then tap Re-check.' }
    : status === 'error' ? { title: 'Couldn’t reach Health Connect.', text: 'See the log below, then tap Re-check.' }
    : null;
  return { ready, pill, banner };
}

export default function Home() {
  const [status, setStatus] = useState<Status>('checking');
  const [perms, setPerms] = useState<PermissionState>({ read: false, write: false });
  const [count, setCount] = useState('1000');
  const [startText, setStartText] = useState(() => formatInput(new Date(Date.now() - HOUR)));
  const [endText, setEndText] = useState(() => formatInput(new Date()));
  const [total, setTotal] = useState<number | null>(null);
  const [records, setRecords] = useState<OwnRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const log = useLog(100);
  const addLog = log.add;

  // Overlap bottom sheet: what it shows, and the pending promise it resolves.
  const [overlap, setOverlap] = useState<{ count: number; hits: Range[] } | null>(null);
  const overlapResolve = useRef<((c: OverlapChoice) => void) | null>(null);

  const askOverlap = (hits: Range[]) =>
    new Promise<OverlapChoice>((resolve) => {
      overlapResolve.current = resolve;
      setOverlap({ count: hits.length, hits });
    });

  const answerOverlap = (choice: OverlapChoice) => {
    overlapResolve.current?.(choice);
    overlapResolve.current = null;
    setOverlap(null);
  };

  const { ready, pill, banner } = describe(status, perms);

  /** Reloads today's aggregate total and this app's records. */
  const refresh = useCallback(async () => {
    const now = Date.now();
    const dayStart = startOfToday().getTime();
    try {
      const [t, recs] = await Promise.all([aggregateSteps(dayStart, now), readOwnRecords(dayStart, now)]);
      setTotal(t);
      setRecords(recs);
      // Let the real-step background job know which times are taken by fake records.
      setBlockedRanges(recs.filter((r) => r.kind !== 'real'));
    } catch (e) {
      addLog(`Refresh failed: ${errMsg(e)}`);
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

  // Check once on mount. (Started from a microtask: all state updates happen
  // after awaits anyway, this just keeps the hooks linter happy.)
  useEffect(() => {
    Promise.resolve().then(checkStatus);
  }, [checkStatus]);

  const grant = async () => {
    try {
      const p = await requestStepsPermissions();
      setPerms(p);
      addLog(`Granted: read ${p.read ? '✓' : '✗'} write ${p.write ? '✓' : '✗'}`);
      if (p.read && p.write) await refresh();
      else addLog('Warning: not all permissions granted. If no dialog appeared, use HC settings.');
    } catch (e) {
      addLog(`Permission request failed: ${errMsg(e)}`);
    }
  };

  const openSettings = () => {
    try {
      openHealthConnectSettings();
    } catch (e) {
      addLog(`Open HC settings failed: ${errMsg(e)}`);
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
    if (v.fastPace) addLog(`Warning: pace is ${Math.round(v.pace!)} steps/min (above ~${MAX_SANE_PACE}).`);
    let range = { start: start!.getTime(), end: end!.getTime() };

    setBusy(true);
    try {
      // Read a wider window so long records that start earlier are caught too.
      const nearby = await readOwnRecords(range.start - 12 * HOUR, range.end + 12 * HOUR);
      const hits = findOverlaps(range, nearby);
      if (hits.length) {
        const choice = await askOverlap(hits);
        if (choice === 'cancel') return addLog('Inject cancelled (overlap).');
        if (choice === 'shift') {
          const shifted = autoShift(range, nearby);
          if (!shifted) return addLog('Auto-shift failed: no free slot of that length.');
          range = shifted;
          addLog(`Shifted to ${formatInput(new Date(range.start))}–${formatTime(new Date(range.end))}`);
        }
      }
      const ids = await insertChunks([{ ...range, count: steps }]);
      addLog(`Inserted ${steps} steps (${span(range)}), id ${(ids[0] ?? '?').slice(0, 6)}…`);
      await refresh();
    } catch (e) {
      addLog(`Insert failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const inject = () => injectRange(Number(count), parseInput(startText), parseInput(endText));

  const resetRange = () => {
    setStartText(formatInput(new Date(Date.now() - HOUR)));
    setEndText(formatInput(new Date()));
  };

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
    if (!Number.isInteger(n) || n < 1 || n > 100_000) return addLog('Invalid: count must be 1–100,000.');
    setBusy(true);
    try {
      const now = Date.now();
      // Avoid everything this app already wrote today.
      const existing = await readOwnRecords(startOfToday().getTime() - 12 * HOUR, now);
      const chunks = spreadAcrossToday(n, existing, now);
      if (chunks.length === 0) return addLog('Spread failed: no free time left today.');
      const minutes = chunks.reduce((a, c) => a + (c.end - c.start) / MINUTE, 0);
      if (n / minutes > MAX_SANE_PACE) addLog(`Warning: average pace ${Math.round(n / minutes)} steps/min.`);
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
      addLog(`Deleted ${r.count} steps (${span(r)})`);
      await refresh();
    } catch (e) {
      addLog(`Delete failed: ${errMsg(e)}`);
    }
  };

  // Live validation for the form.
  const n = Number(count);
  const v = validateChunk(n, parseInput(startText), parseInput(endText));
  const countOk = !v.fields.count;
  const sorted = [...records].sort((a, b) => b.start - a.start); // newest first

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-12" keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-1 pt-3">
          <Image source={icon} className="h-9 w-9 rounded-[10px]" accessibilityIgnoresInvertColors />
          <Text className="flex-1 font-display text-[22px] text-fg">Stompers Faker</Text>
          <IconButton icon="sliders" label="Settings" onPress={() => router.push('/settings')} />
        </View>

        {/* Today + Health Connect status */}
        <Card>
          <Text className="font-sans-semibold text-[13px] tracking-[1px] text-fg-muted">TODAY, ALL APPS</Text>
          {ready && total !== null ? (
            <View className="flex-row items-baseline gap-2">
              <Text className="font-display text-[56px] leading-[64px] text-fg">{formatNumber(total)}</Text>
              <Text className="font-sans text-lg text-fg-muted">steps</Text>
            </View>
          ) : (
            <View className="my-5 h-1 w-10 rounded-full bg-fg-muted" accessibilityLabel="No total yet" />
          )}
          {banner ? (
            <Banner tone="danger" icon="alert-circle" title={banner.title}>{banner.text}</Banner>
          ) : null}
          {status === 'available' && !ready ? (
            <Banner tone="warn" icon="alert-triangle" title="Access needed.">
              Grant read and write access to Steps. If no dialog opens, use HC settings.
            </Banner>
          ) : null}
          {ready ? (
            <View className="flex-row flex-wrap gap-2">
              <Pill tone={pill.tone} label={pill.label} dot />
              <Pill tone="neutral" label="Read ✓  Write ✓" />
            </View>
          ) : (
            <View className="flex-row flex-wrap items-center gap-2">
              <Pill tone={pill.tone} label={pill.label} dot />
              <Text className="font-sans text-[14px] text-fg-muted">
                Permissions: read {perms.read ? '✓' : '✗'} · write {perms.write ? '✓' : '✗'}
              </Text>
            </View>
          )}
          <View className="flex-row gap-2">
            <Button
              label="Grant"
              variant={status === 'available' && !ready ? 'small-primary' : 'small'}
              disabled={status !== 'available'}
              onPress={grant}
              className="flex-1"
            />
            <Button
              label="Re-check"
              variant={status !== 'available' && status !== 'checking' ? 'small-primary' : 'small'}
              onPress={checkStatus}
              className="flex-1"
            />
            <Button label="HC settings" variant="small" onPress={openSettings} className="flex-[1.3]" />
          </View>
        </Card>

        {/* Inject */}
        <Card>
          <Title>Inject steps</Title>
          <Field label="Steps" big value={count} onChangeText={setCount} keyboardType="number-pad" error={v.fields.count} />
          <View className="flex-row gap-2.5">
            <Field label="Start" className="flex-1" value={startText} onChangeText={setStartText} autoCapitalize="none" error={v.fields.start} />
            <Field label="End" className="flex-1" value={endText} onChangeText={setEndText} autoCapitalize="none" error={v.fields.end} />
          </View>
          {v.fastPace ? (
            <Banner tone="warn" icon="alert-triangle" title={`${Math.round(v.pace!)} steps/min.`}>
              {`Above ~${MAX_SANE_PACE} looks unrealistic, but it's allowed.`}
            </Banner>
          ) : null}
          {ready ? (
            <>
              <View className="flex-row flex-wrap gap-2">
                <Button label="Last 60 min" variant="chip" onPress={resetRange} />
                <Button label="+1k · 10 min" variant="chip" onPress={() => preset(1000, 10)} disabled={busy} />
                <Button label="+5k · 1 hr" variant="chip" onPress={() => preset(5000, 60)} disabled={busy} />
              </View>
              <Button
                label={busy ? 'Working…' : countOk ? `Inject ${formatNumber(n)} steps` : 'Inject steps'}
                onPress={inject}
                disabled={busy || v.errors.length > 0}
              />
              <Button
                label={countOk ? `Spread ${formatNumber(n)} across today` : 'Spread across today'}
                variant="secondary"
                onPress={spread}
                disabled={busy || !countOk}
              />
            </>
          ) : (
            <>
              <Button label="Inject steps" disabled />
              <Text className="text-center font-sans text-[13px] text-fg-muted">Connect Health Connect to start injecting.</Text>
            </>
          )}
        </Card>

        {/* This app's records */}
        {ready ? (
          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="font-display text-xl text-fg">
                Today’s records <Text className="text-fg-muted">{records.length}</Text>
              </Text>
              <IconButton icon="refresh-cw" label="Refresh" onPress={refresh} />
            </View>
            {sorted.length === 0 ? (
              <Text className="border-t border-line pt-3 font-sans text-[14px] text-fg-muted">No records from this app today.</Text>
            ) : (
              sorted.map((r) => (
                <View key={r.id} className="flex-row items-center gap-3 border-t border-line pt-3">
                  <View className="flex-1">
                    <Text className="font-display text-lg text-fg">{formatNumber(r.count)}</Text>
                    <Text className="font-mono text-[13px] text-fg-muted">
                      {formatTime(new Date(r.start))} – {formatTime(new Date(r.end))}
                    </Text>
                  </View>
                  <Tag kind={r.kind} />
                  <Pressable
                    onPress={() => remove(r)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${r.count} steps`}
                    className="h-10 w-10 items-center justify-center active:opacity-60"
                  >
                    <Icon name="trash-2" className="text-danger" />
                  </Pressable>
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Log */}
        <Card>
          <View className="flex-row items-center justify-between">
            <Title>Log</Title>
            <TextButton label="Clear" onPress={log.clear} />
          </View>
          <LogPanel lines={log.lines} />
        </Card>
      </ScrollView>

      {/* Overlap prompt */}
      <Sheet visible={overlap !== null} onClose={() => answerOverlap('cancel')}>
        <View className="h-12 w-12 items-center justify-center rounded-[14px] bg-warn-soft">
          <Icon name="copy" size={20} className="text-warn" />
        </View>
        <Text className="font-display text-[26px] text-fg">That overlaps a record</Text>
        <Text className="font-sans text-[15px] leading-[22px] text-fg-muted">
          {overlap?.count === 1 ? '1 of this app’s records already covers' : `${overlap?.count ?? 0} of this app’s records already cover`} part of{' '}
          <Text className="font-mono text-fg">{overlap ? overlap.hits.map(span).join(', ') : ''}</Text>. Auto-shift moves the new one to the
          next free slot.
        </Text>
        <Button label="Auto-shift" onPress={() => answerOverlap('shift')} />
        <Button label="Insert anyway" variant="secondary" onPress={() => answerOverlap('anyway')} />
        <TextButton label="Cancel" tone="muted" onPress={() => answerOverlap('cancel')} />
      </Sheet>
    </SafeAreaView>
  );
}

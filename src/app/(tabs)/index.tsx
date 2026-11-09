// Home tab: today's total, Health Connect status, and fake-step injection.

import { useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Card, Field, Icon, Pill, ScreenHeader, Sheet, TextButton, Title, type Tone } from '@/components/ui';
import { mark, useApp, type HcStatus } from '@/lib/app-state';
import { planInsert } from '@/lib/changes';
import { readOwnRecords, type PermissionState } from '@/lib/health';
import { autoShift, findOverlaps, MAX_SANE_PACE, spreadAcrossToday, validateChunk, type Range } from '@/lib/steps';
import { formatInput, formatNumber, formatTime, HOUR, MINUTE, parseInput, startOfToday } from '@/lib/time';
import { errMsg } from '@/lib/useLog';

type OverlapChoice = 'shift' | 'anyway' | 'cancel';

/** The button that opens the platform's health permissions. */
const HEALTH_SETTINGS = Platform.OS === 'ios' ? 'Health app' : 'HC settings';

const span = (r: Range) => `${formatTime(new Date(r.start))}–${formatTime(new Date(r.end))}`;

/** Status pill + optional banner for each Health Connect state. */
function describe(status: HcStatus, perms: PermissionState, ready: boolean) {
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
    : status === 'error' ? { title: 'Couldn’t reach Health Connect.', text: 'See the Logs tab, then tap Re-check.' }
    : null;
  return { pill, banner };
}

export default function Home() {
  const { status, perms, ready, total, checkStatus, grant, openHcSettings, log, commit } = useApp();
  const addLog = log.add;
  const [count, setCount] = useState('1000');
  const [startText, setStartText] = useState(() => formatInput(new Date(Date.now() - HOUR)));
  const [endText, setEndText] = useState(() => formatInput(new Date()));
  const [busy, setBusy] = useState(false);

  // Overlap bottom sheet: what it shows, and the pending promise it resolves.
  const [overlap, setOverlap] = useState<Range[] | null>(null);
  const overlapResolve = useRef<((c: OverlapChoice) => void) | null>(null);

  const askOverlap = (hits: Range[]) =>
    new Promise<OverlapChoice>((resolve) => {
      overlapResolve.current = resolve;
      setOverlap(hits);
    });

  const answerOverlap = (choice: OverlapChoice) => {
    overlapResolve.current?.(choice);
    overlapResolve.current = null;
    setOverlap(null);
  };

  const { pill, banner } = describe(status, perms, ready);

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
      // Journaled in History (undoable); commit() logs and refreshes.
      await commit(() => planInsert('inject', [{ ...range, count: steps }]));
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
      addLog(`Spread plan: ${chunks.length} chunks, ${Math.round(minutes)} min walking.`);
      // Preview every generated chunk before writing.
      await commit(() => planInsert('spread', chunks), { review: true, confirmLabel: `Insert ${chunks.length} record${chunks.length === 1 ? '' : 's'}` });
    } catch (e) {
      addLog(`Spread failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Live validation for the form.
  const n = Number(count);
  const v = validateChunk(n, parseInput(startText), parseInput(endText));
  const countOk = !v.fields.count;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Stompers Faker" logo />

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
              {`Grant read and write access to Steps. If no dialog opens, use ${HEALTH_SETTINGS}.`}
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
                Permissions: read {mark(perms.read)} · write {mark(perms.write)}
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
            <Button label={HEALTH_SETTINGS} variant="small" onPress={openHcSettings} className="flex-[1.3]" />
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
      </ScrollView>

      {/* Overlap prompt */}
      <Sheet visible={overlap !== null} onClose={() => answerOverlap('cancel')}>
        <View className="h-12 w-12 items-center justify-center rounded-[14px] bg-warn-soft">
          <Icon name="copy" size={20} className="text-warn" />
        </View>
        <Text className="font-display text-[26px] text-fg">That overlaps a record</Text>
        <Text className="font-sans text-[15px] leading-[22px] text-fg-muted">
          {overlap?.length === 1 ? '1 of this app’s records already covers' : `${overlap?.length ?? 0} of this app’s records already cover`} part of{' '}
          <Text className="font-mono text-fg">{overlap ? overlap.map(span).join(', ') : ''}</Text>. Auto-shift moves the new one to the next
          free slot.
        </Text>
        <Button label="Auto-shift" onPress={() => answerOverlap('shift')} />
        <Button label="Insert anyway" variant="secondary" onPress={() => answerOverlap('anyway')} />
        <TextButton label="Cancel" tone="muted" onPress={() => answerOverlap('cancel')} />
      </Sheet>
    </SafeAreaView>
  );
}

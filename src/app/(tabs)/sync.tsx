// Sync tab: real-step sync (phone step counter → Health Connect). Off by default.

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestPermission } from 'react-native-health-connect';
import { Button, Card, Icon, KeyValue, Pill, ScreenHeader, Title, usePalette, type Tone } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { formatInput, formatNumber } from '@/lib/time';
import { errMsg } from '@/lib/useLog';
import * as StepSync from '../../../modules/step-sync';

const when = (ms: number | null) => (ms ? formatInput(new Date(ms)) : '—');

/** One "✓ Enabled" style chip in the 2×2 status grid. */
const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <View className="flex-1 flex-row items-center gap-2 rounded-field bg-bg px-3 py-2.5">
    <Icon name={ok ? 'check' : 'x'} size={16} className={ok ? 'text-ok' : 'text-danger'} />
    <Text className="font-sans-medium text-[15px] text-fg">{label}</Text>
  </View>
);

export default function Sync() {
  const [status, setStatus] = useState<StepSync.StepSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { log, refresh, ready } = useApp();
  const addLog = useCallback((msg: string) => log.add(`Sync: ${msg}`), [log]);
  const palette = usePalette();

  const reload = useCallback(() => {
    try {
      setStatus(StepSync.getStatus());
    } catch (e) {
      addLog(errMsg(e));
    }
  }, [addLog]);

  // Reload whenever the tab is opened: the background job may have run meanwhile.
  useFocusEffect(
    useCallback(() => {
      Promise.resolve().then(reload);
    }, [reload]),
  );

  const sync = async () => {
    setBusy(true);
    try {
      addLog(await StepSync.syncNow());
      if (ready) await refresh(); // new real records show up in Records / today's total
    } catch (e) {
      addLog(`failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const toggle = async (on: boolean) => {
    try {
      if (on) {
        if (!(await StepSync.requestActivityPermission())) {
          addLog('physical activity permission denied; sync not enabled.');
          return;
        }
        // Optional: lets the background job read our own records to avoid overlaps.
        // If Health Connect doesn't offer it, the app's mirrored ranges are used instead.
        await requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }]).catch(() => {});
        StepSync.enableSync();
        addLog('enabled.');
        await sync(); // stores the baseline right away
      } else {
        StepSync.disableSync();
        addLog('disabled.');
        reload();
      }
    } catch (e) {
      addLog(errMsg(e));
    }
  };

  const enabled = status?.enabled ?? false;
  const health: { tone: Tone; label: string } = !enabled
    ? { tone: 'neutral', label: 'Off' }
    : status?.lastError
      ? { tone: 'danger', label: 'Error' }
      : status?.baselineSet
        ? { tone: 'ok', label: 'Healthy' }
        : { tone: 'warn', label: 'Starting' };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8">
        <ScreenHeader title="Real-step sync" />

        {!StepSync.isAvailable ? (
          <Card>
            <Text className="font-sans text-[15px] text-danger">
              The StepSync native module is missing from this build. Rebuild with bunx expo run:android.
            </Text>
          </Card>
        ) : (
          <>
            {/* Toggle */}
            <Card>
              <View className="flex-row items-center justify-between">
                <Title>Sync phone steps</Title>
                <Switch
                  value={enabled}
                  onValueChange={toggle}
                  trackColor={{ false: palette.track, true: palette.real }}
                  thumbColor={palette.thumb}
                  accessibilityLabel="Real-step sync"
                />
              </View>
              <Text className="font-sans text-[15px] leading-[22px] text-fg-muted">
                Reads the phone’s step counter about every 15 min and writes new steps to Health Connect, even with the app
                closed. Real and fake records never overlap.
              </Text>
            </Card>

            {/* Status */}
            <Card>
              <View className="flex-row items-center justify-between">
                <Title>Sync status</Title>
                <Pill tone={health.tone} label={health.label} dot />
              </View>
              <View className="gap-2">
                <View className="flex-row gap-2">
                  <Check ok={enabled} label="Enabled" />
                  <Check ok={status?.sensorAvailable ?? false} label="Sensor" />
                </View>
                <View className="flex-row gap-2">
                  <Check ok={status?.hasActivityPermission ?? false} label="Activity perm." />
                  <Check ok={status?.baselineSet ?? false} label="Baseline set" />
                </View>
              </View>
              <View>
                <KeyValue label="Last run" value={when(status?.lastRunTime ?? null)} />
                <KeyValue label="Last write" value={when(status?.lastSyncTime ?? null)} />
                <KeyValue
                  label="Last delta"
                  value={status?.lastDelta != null ? `+${formatNumber(status.lastDelta)} steps` : '—'}
                  valueClass="text-real"
                />
                <KeyValue label="Message" value={status?.lastMessage ?? '—'} />
                <KeyValue
                  label="Last error"
                  value={status?.lastError ?? 'None'}
                  valueClass={status?.lastError ? 'text-danger' : 'text-fg-muted'}
                />
              </View>
              <View className="flex-row gap-2.5">
                <Button label={busy ? 'Syncing…' : 'Sync now'} variant="small-primary" onPress={sync} disabled={!enabled || busy} className="h-12 flex-1" />
                <Button label="Refresh" variant="small" onPress={reload} className="h-12 flex-1" />
              </View>
            </Card>

            {/* Huawei note */}
            <View className="flex-row gap-3 rounded-card bg-warn-soft p-4">
              <Icon name="battery" size={18} className="mt-0.5 text-warn" />
              <Text className="flex-1 font-sans text-[15px] leading-[22px] text-fg">
                <Text className="font-sans-bold">Huawei phones: </Text>
                Settings → Battery → App launch → Stompers Faker → Manage manually, then turn on all 3 toggles. Otherwise
                background sync stops.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

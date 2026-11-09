// Records tab: today's hourly chart (real vs fake), this app's records for today with
// delete, and bulk actions (each previewed in the review sheet before anything changes).

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StepsChart, useChartColors } from '@/components/StepsChart';
import { Button, Card, Icon, IconButton, Pill, ScreenHeader, Tag, Title, usePalette } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { planDeleteAll, planDeleteFake } from '@/lib/changes';
import { hourlySteps, type HourBucket } from '@/lib/health';
import { formatNumber, formatTime, HOUR, startOfToday } from '@/lib/time';
import { errMsg } from '@/lib/useLog';

/** 24 hourly buckets for today, zero-filled (the platform omits empty hours). */
async function loadToday(): Promise<HourBucket[]> {
  const day = startOfToday().getTime();
  const got = await hourlySteps(day, Date.now());
  const byStart = new Map(got.map((b) => [b.start, b]));
  return Array.from({ length: 24 }, (_, h) => byStart.get(day + h * HOUR) ?? { start: day + h * HOUR, total: 0, own: 0 });
}

export default function Records() {
  const { ready, records, refresh, refreshing, removeRecord, commit, dataVersion, log } = useApp();
  const palette = usePalette();
  const colors = useChartColors();
  const [buckets, setBuckets] = useState<HourBucket[] | null>(null);
  const addLog = log.add;

  const reload = useCallback(async () => {
    if (!ready) return;
    await refresh();
    try {
      setBuckets(await loadToday());
    } catch (e) {
      addLog(`Chart failed: ${errMsg(e)}`);
    }
  }, [ready, refresh, addLog]);

  // Reload when the tab is opened and after any change (dataVersion bumps on commit).
  useFocusEffect(
    useCallback(() => {
      Promise.resolve().then(reload);
    }, [reload, dataVersion]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sorted = [...records].sort((a, b) => b.start - a.start); // newest first
  const sum = (kind: 'fake' | 'legacy') => records.filter((r) => r.kind === kind).reduce((a, r) => a + r.count, 0);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={reload} enabled={ready} colors={[palette.primary]} progressBackgroundColor={palette.surface} />
        }
      >
        <ScreenHeader title="Records" />

        {!ready ? (
          <Card>
            <Text className="font-sans text-[15px] text-fg-muted">Connect the health app on the Home tab to see records.</Text>
          </Card>
        ) : (
          <>
            <Card>
              <Title>Today by hour</Title>
              {buckets ? <StepsChart buckets={buckets} /> : <Text className="font-sans text-[14px] text-fg-muted">Loading…</Text>}
            </Card>

            <Card>
              <View className="flex-row items-center justify-between">
                <Text className="font-display text-xl text-fg">
                  Today’s records <Text className="text-fg-muted">{records.length}</Text>
                </Text>
                <IconButton icon="refresh-cw" label="Refresh" onPress={reload} />
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Pill tone="neutral" label={`Fake ${formatNumber(sum('fake'))}`} />
                {sum('legacy') > 0 ? <Pill tone="neutral" label={`Legacy ${formatNumber(sum('legacy'))}`} /> : null}
              </View>
              {sorted.length === 0 ? (
                <Text className="border-t border-line pt-3 font-sans text-[14px] text-fg-muted">No records from this app today.</Text>
              ) : (
                sorted.map((r) => (
                  <View key={r.id} className="flex-row items-center gap-3 border-t border-line pt-3">
                    {/* Same color as the fake series in the chart. */}
                    <View style={{ backgroundColor: r.kind === 'fake' ? colors.fake : palette.line }} className="h-8 w-1 rounded-full" />
                    <View className="flex-1">
                      <Text className="font-display text-lg text-fg">{formatNumber(r.count)}</Text>
                      <Text className="font-mono text-[13px] text-fg-muted">
                        {formatTime(new Date(r.start))} – {formatTime(new Date(r.end))}
                      </Text>
                    </View>
                    <Tag kind={r.kind} />
                    <Pressable
                      onPress={() => removeRecord(r)}
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

            <Card>
              <Title>Clean up</Title>
              <Text className="font-sans text-[14px] leading-5 text-fg-muted">
                Only records this app wrote can be removed; steps from other apps are never touched. You’ll see exactly what
                changes first, and a snapshot is taken automatically so it can be undone.
              </Text>
              <Button
                label="Delete all fake records…"
                variant="secondary"
                onPress={() => commit(planDeleteFake, { review: true, confirmLabel: 'Delete fake records' })}
              />
              <Button
                label="Delete everything this app wrote…"
                variant="secondary"
                onPress={() => commit(planDeleteAll, { review: true, confirmLabel: 'Delete everything' })}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

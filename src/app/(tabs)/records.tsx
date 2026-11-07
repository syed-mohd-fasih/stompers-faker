// Records tab: this app's Steps records for today, with delete and pull-to-refresh.

import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Icon, IconButton, Pill, ScreenHeader, Tag, usePalette } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { formatNumber, formatTime } from '@/lib/time';

export default function Records() {
  const { ready, records, refresh, refreshing, removeRecord } = useApp();
  const palette = usePalette();

  // Reload whenever the tab is opened (e.g. after the background sync wrote something).
  useFocusEffect(
    useCallback(() => {
      if (ready) refresh();
    }, [ready, refresh]),
  );

  const sorted = [...records].sort((a, b) => b.start - a.start); // newest first
  const sum = (kind: 'fake' | 'real') => records.filter((r) => r.kind === kind).reduce((a, r) => a + r.count, 0);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            enabled={ready}
            colors={[palette.primary]}
            progressBackgroundColor={palette.surface}
          />
        }
      >
        <ScreenHeader title="Records" />

        {!ready ? (
          <Card>
            <Text className="font-sans text-[15px] text-fg-muted">Connect Health Connect on the Home tab to see records.</Text>
          </Card>
        ) : (
          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="font-display text-xl text-fg">
                Today’s records <Text className="text-fg-muted">{records.length}</Text>
              </Text>
              <IconButton icon="refresh-cw" label="Refresh" onPress={refresh} />
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Pill tone="neutral" label={`Fake ${formatNumber(sum('fake'))}`} />
              <Pill tone="neutral" label={`Real ${formatNumber(sum('real'))}`} />
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
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

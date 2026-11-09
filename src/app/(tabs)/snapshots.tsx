// Snapshots tab: save the set of records this app has written, and restore it later
// (deleting anything added since, re-adding anything removed). Every action is previewed.

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Icon, ScreenHeader, Title, usePalette } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { planRestore, planSnapshot } from '@/lib/changes';
import { deleteSnapshot, listSnapshots, type Snapshot } from '@/lib/db';
import { formatInput, formatNumber } from '@/lib/time';

export default function Snapshots() {
  const { ready, commit, dataVersion } = useApp();
  const palette = usePalette();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState('');

  const reload = useCallback(() => setSnaps(listSnapshots()), []);
  useFocusEffect(
    useCallback(() => {
      Promise.resolve().then(reload);
    }, [reload, dataVersion]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const take = async () => {
    const name = label.trim() || `Snapshot ${formatInput(new Date())}`;
    const res = await commit(() => planSnapshot(name), { review: true, confirmLabel: 'Save snapshot' });
    if (res) setLabel('');
  };

  const remove = (s: Snapshot) =>
    Alert.alert('Delete snapshot?', `“${s.label}” will be removed. Health data is not changed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteSnapshot(s.id);
          reload();
        },
      },
    ]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Snapshots" />

        <Card>
          <Title>Take a snapshot</Title>
          <Text className="font-sans text-[14px] leading-5 text-fg-muted">
            Saves which records this app has written right now. Restoring makes this app’s records match it again. To get
            back to your real-only steps, restore a snapshot taken before faking, or use “Delete all fake records” on the
            Records tab.
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Label (optional), e.g. Before the joke"
            placeholderTextColor={palette.muted}
            className="h-12 rounded-field border-[1.5px] border-line bg-bg px-3 font-sans text-[15px] text-fg"
          />
          <Button label="Preview snapshot" onPress={take} disabled={!ready} />
        </Card>

        <Card>
          <Text className="font-display text-xl text-fg">
            Saved <Text className="text-fg-muted">{snaps.length}</Text>
          </Text>
          {snaps.length === 0 ? <Text className="font-sans text-[14px] text-fg-muted">No snapshots yet.</Text> : null}
          {snaps.map((s) => (
            <View key={s.id} className="gap-2 border-t border-line pt-3">
              <View className="flex-row items-start gap-3">
                <View className="flex-1">
                  <Text className="font-sans-semibold text-[15px] text-fg">{s.label}</Text>
                  <Text className="font-mono text-[12px] text-fg-muted">
                    {formatInput(new Date(s.createdAt))} · {s.author} · {s.recordCount} records · {formatNumber(s.stepSum)} steps
                  </Text>
                </View>
                <Pressable
                  onPress={() => remove(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete snapshot ${s.label}`}
                  className="h-9 w-9 items-center justify-center active:opacity-60"
                >
                  <Icon name="x" className="text-fg-muted" />
                </Pressable>
              </View>
              <Button
                label="Restore…"
                variant="small"
                disabled={!ready}
                onPress={() => commit(() => planRestore(s.id), { review: true, confirmLabel: 'Restore' })}
                className="self-start"
              />
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

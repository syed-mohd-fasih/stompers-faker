// History tab: every change this phone made to Health data (persistent, newest first),
// with Undo — like rolling back a database migration, previewed first. Below it, the
// in-memory debug log for this session.

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, LogPanel, Pill, ScreenHeader, TextButton, type Tone } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { planRollback } from '@/lib/changes';
import { countOperationsBefore, listOperations, pruneOperations, type Operation, type OpStatus } from '@/lib/db';
import { formatInput, HOUR } from '@/lib/time';

const STATUS: Record<OpStatus, { tone: Tone; label: string }> = {
  applied: { tone: 'ok', label: 'Applied' },
  partial: { tone: 'warn', label: 'Partial' },
  failed: { tone: 'danger', label: 'Failed' },
  rolled_back: { tone: 'neutral', label: 'Undone' },
};

const KIND_LABEL: Record<Operation['kind'], string> = {
  inject: 'Inject',
  spread: 'Spread',
  delete: 'Delete',
  delete_fake: 'Delete fake',
  delete_all: 'Delete all',
  snapshot: 'Snapshot',
  restore: 'Restore',
  rollback: 'Undo',
};

/** Snapshots change nothing; failed/undone ops have nothing left to undo. */
const undoable = (op: Operation) => op.kind !== 'snapshot' && (op.status === 'applied' || op.status === 'partial');

const DAY = 24 * HOUR;
const AGES: { label: string; days: number }[] = [
  { label: 'Older than 7 days', days: 7 },
  { label: 'Older than 30 days', days: 30 },
  { label: 'Older than 90 days', days: 90 },
  { label: 'Everything', days: 0 },
];

export default function History() {
  const { ready, commit, dataVersion, log } = useApp();
  const [ops, setOps] = useState<Operation[]>([]);
  const [showLog, setShowLog] = useState(false);

  const reload = useCallback(() => setOps(listOperations()), []);

  /** Ask which age, show how many entries that removes, confirm, delete. */
  const cleanUp = () =>
    Alert.alert('Delete old history', 'Which entries? Health data and snapshots are not affected.', [
      ...AGES.map((a) => ({
        text: a.label,
        onPress: () => {
          const before = a.days === 0 ? Infinity : Date.now() - a.days * DAY;
          const n = countOperationsBefore(before);
          if (n === 0) return Alert.alert('Nothing to delete', `No entries ${a.days ? `older than ${a.days} days` : 'yet'}.`);
          Alert.alert(`Delete ${n} entr${n === 1 ? 'y' : 'ies'}?`, 'They can no longer be undone afterwards.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                const removed = pruneOperations(before);
                log.add(`History: deleted ${removed} entr${removed === 1 ? 'y' : 'ies'} (${a.label.toLowerCase()})`);
                reload();
              },
            },
          ]);
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  useFocusEffect(
    useCallback(() => {
      Promise.resolve().then(reload);
    }, [reload, dataVersion]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8">
        <ScreenHeader title="History" />

        <Card>
          <View className="flex-row items-center justify-between">
            <Text className="font-display text-xl text-fg">
              Operations <Text className="text-fg-muted">{ops.length}</Text>
            </Text>
            {ops.length > 0 ? <TextButton label="Delete old…" tone="muted" onPress={cleanUp} /> : null}
          </View>
          <Text className="font-sans text-[13px] text-fg-muted">Stored on this phone. Undo shows exactly what it will change first.</Text>
          {ops.length === 0 ? <Text className="font-sans text-[14px] text-fg-muted">Nothing yet.</Text> : null}
          {ops.map((op) => (
            <View key={op.id} className="gap-2 border-t border-line pt-3">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-mono text-[12px] text-fg-muted">#{op.id}</Text>
                <Text className="font-sans-semibold text-[15px] text-fg">{KIND_LABEL[op.kind]}</Text>
                <Pill tone={STATUS[op.status].tone} label={STATUS[op.status].label} />
              </View>
              <Text className="font-sans text-[14px] leading-5 text-fg">{op.summary}</Text>
              <Text className="font-mono text-[12px] text-fg-muted">
                {formatInput(new Date(op.createdAt))} · {op.author}
                {op.rollbackOf ? ` · undoes #${op.rollbackOf}` : ''}
              </Text>
              {undoable(op) ? (
                <Button
                  label="Undo…"
                  variant="small"
                  disabled={!ready}
                  onPress={() => commit(() => planRollback(op.id), { review: true, confirmLabel: 'Undo' })}
                  className="self-start"
                />
              ) : null}
            </View>
          ))}
        </Card>

        <Card>
          <View className="flex-row items-center justify-between">
            <Text className="font-display text-xl text-fg">
              Debug log <Text className="text-fg-muted">{log.lines.length}</Text>
            </Text>
            <View className="flex-row">
              <TextButton label={showLog ? 'Hide' : 'Show'} tone="muted" onPress={() => setShowLog((v) => !v)} />
              <TextButton label="Clear" onPress={log.clear} />
            </View>
          </View>
          {showLog ? <LogPanel lines={log.lines} /> : null}
          <Text className="font-sans text-[13px] text-fg-muted">This session only (last 200 lines).</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

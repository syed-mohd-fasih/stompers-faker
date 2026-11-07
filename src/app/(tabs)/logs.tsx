// Logs tab: everything the app did this session (inject, sync, errors), newest first.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, LogPanel, ScreenHeader, TextButton } from '@/components/ui';
import { useApp } from '@/lib/app-state';

export default function Logs() {
  const { log } = useApp();
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8">
        <ScreenHeader title="Logs" />
        <Card>
          <View className="flex-row items-center justify-between">
            <Text className="font-display text-xl text-fg">
              This session <Text className="text-fg-muted">{log.lines.length}</Text>
            </Text>
            <TextButton label="Clear" onPress={log.clear} />
          </View>
          <LogPanel lines={log.lines} />
          <Text className="font-sans text-[13px] text-fg-muted">
            Kept in memory only (last 200). Background sync runs outside the app; its result shows on the Sync tab.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

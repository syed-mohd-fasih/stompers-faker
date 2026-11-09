import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Feather>['name'];


// Bottom tabs: Home (today + inject), Records (chart + cleanup), Snapshots, History.
// App settings is a separate stack screen opened from the gear in each header.
export default function TabsLayout() {
  const { palette } = useTheme();
  // Icon tint comes from our palette (the navigator's color prop is a loose ColorValue).
  const tab = (title: string, icon: IconName) => ({
    title,
    tabBarIcon: ({ focused, size }: { focused: boolean; size: number }) => (
      <Feather name={icon} color={focused ? palette.primary : palette.muted} size={size - 2} />
    ),
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.line },
        tabBarLabelStyle: { fontFamily: 'Inter-SemiBold', fontSize: 12 },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen name="index" options={tab('Home', 'home')} />
      <Tabs.Screen name="records" options={tab('Records', 'list')} />
      <Tabs.Screen name="snapshots" options={tab('Snapshots', 'archive')} />
      <Tabs.Screen name="history" options={tab('History', 'clock')} />
    </Tabs>
  );
}

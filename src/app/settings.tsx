// App settings: appearance (System/Light/Dark), accent color, and about.

import Constants from 'expo-constants';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Icon, KeyValue, ScreenHeader, Title } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { ACCENTS, accentHex, useTheme, type Accent, type ThemeMode } from '@/lib/theme';

const MODES: { value: ThemeMode; label: string; icon: 'smartphone' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'System', icon: 'smartphone' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const appIcon = require('../../assets/brand/icon-96.png');

export default function AppSettings() {
  const { mode, setMode, accent, setAccent, scheme } = useTheme();
  const { openHcSettings } = useApp();
  const cfg = Constants.expoConfig;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-8">
        <ScreenHeader title="Settings" back settings={false} />

        {/* Appearance */}
        <Card>
          <Title>Appearance</Title>
          <View className="flex-row gap-1 rounded-[14px] bg-surface-2 p-1" accessibilityRole="radiogroup">
            {MODES.map((m) => {
              const on = m.value === mode;
              return (
                <Pressable
                  key={m.value}
                  onPress={() => setMode(m.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  className={`h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-[11px] ${on ? 'bg-surface' : ''}`}
                >
                  <Icon name={m.icon} size={16} className={on ? 'text-primary' : 'text-fg-muted'} />
                  <Text className={`font-sans-semibold text-[15px] ${on ? 'text-fg' : 'text-fg-muted'}`}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Accent */}
        <Card>
          <Title>Accent color</Title>
          <Text className="font-sans text-[14px] text-fg-muted">Used for buttons and fake records. Real records stay blue.</Text>
          <View className="flex-row justify-between" accessibilityRole="radiogroup">
            {(Object.keys(ACCENTS) as Accent[]).map((a) => {
              const on = a === accent;
              return (
                <Pressable
                  key={a}
                  onPress={() => setAccent(a)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={ACCENTS[a].label}
                  className="items-center gap-1.5"
                >
                  <View className={`h-14 w-14 items-center justify-center rounded-full border-2 ${on ? 'border-fg' : 'border-transparent'}`}>
                    <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: accentHex(a, scheme) }}>
                      {on ? <Icon name="check" size={20} className="text-primary-fg" /> : null}
                    </View>
                  </View>
                  <Text className={`font-sans-medium text-[13px] ${on ? 'text-fg' : 'text-fg-muted'}`}>{ACCENTS[a].label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Health Connect shortcut */}
        <Card>
          <Title>Health Connect</Title>
          <Pressable onPress={openHcSettings} accessibilityRole="button" className="flex-row items-center gap-3 active:opacity-70">
            <Icon name="heart" className="text-primary" />
            <Text className="flex-1 font-sans-medium text-[15px] text-fg">Open Health Connect settings</Text>
            <Icon name="external-link" size={16} className="text-fg-muted" />
          </Pressable>
        </Card>

        {/* About */}
        <Card>
          <View className="flex-row items-center gap-3">
            <Image source={appIcon} className="h-12 w-12 rounded-[12px]" accessibilityIgnoresInvertColors />
            <View className="flex-1">
              <Text className="font-display text-xl text-fg">Stompers Faker</Text>
              <Text className="font-sans text-[14px] text-fg-muted">Version {cfg?.version ?? '?'}</Text>
            </View>
          </View>
          <Text className="font-sans text-[15px] leading-[22px] text-fg-muted">
            Personal tool that writes Steps records to Health Connect, so Stompers can read them. Fake steps are added by hand;
            real steps come from the phone’s step counter.
          </Text>
          <View>
            <KeyValue label="Package" value={cfg?.android?.package ?? '?'} />
            <KeyValue label="Expo SDK" value={cfg?.sdkVersion ?? '?'} />
            <KeyValue label="Build" value={__DEV__ ? 'Debug' : 'Release'} />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

// Shared building blocks for the Stompers Faker theme (NativeWind classes).
// Colors come from CSS variables in global.css, so light/dark is automatic.
// Note: font weights are separate families (font-sans-bold etc.), see tailwind.config.js.

import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import type { ComponentProps, ReactNode } from 'react';
import { Image, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/lib/theme';

// Lets icons take a className like "text-primary" (mapped to their `color` prop).
cssInterop(Feather, { className: { target: 'style', nativeStyleToProp: { color: true } } });

export type IconName = ComponentProps<typeof Feather>['name'];

export const Icon = ({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) => (
  <Feather name={name} size={size} className={className} />
);

/** Raw colors for the few native props that can't take a className (Switch, tab bar, ...). */
export const usePalette = () => useTheme().palette;

const appIcon = require('../../assets/brand/icon-96.png');

/**
 * Screen title row. `logo` shows the app icon (Home), `back` shows a back chevron,
 * and tab screens get a settings gear on the right.
 */
export function ScreenHeader({ title, logo, back, settings = true }: { title: string; logo?: boolean; back?: boolean; settings?: boolean }) {
  return (
    <View className="flex-row items-center gap-3 px-1 pt-3">
      {back ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="-ml-2 h-11 w-11 items-center justify-center active:opacity-60"
        >
          <Icon name="chevron-left" size={24} className="text-fg" />
        </Pressable>
      ) : null}
      {logo ? <Image source={appIcon} className="h-9 w-9 rounded-[10px]" accessibilityIgnoresInvertColors /> : null}
      <Text className="flex-1 font-display text-[22px] text-fg" accessibilityRole="header">
        {title}
      </Text>
      {settings ? <IconButton icon="settings" label="App settings" onPress={() => router.push('/settings')} /> : null}
    </View>
  );
}

export const Card = ({ children }: { children: ReactNode }) => (
  <View className="gap-3.5 rounded-card border border-line bg-surface p-5">{children}</View>
);

export const Title = ({ children }: { children: ReactNode }) => (
  <Text className="font-display text-xl text-fg">{children}</Text>
);

type BtnProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** primary = big filled CTA, secondary = outlined, chip = small rounded, small = compact filled/outlined row button */
  variant?: 'primary' | 'secondary' | 'chip' | 'small-primary' | 'small';
  className?: string;
};

export function Button({ label, onPress, disabled, variant = 'primary', className = '' }: BtnProps) {
  const box = {
    primary: disabled ? 'h-14 rounded-btn bg-off-bg' : 'h-14 rounded-btn bg-primary',
    secondary: 'h-12 rounded-[14px] border-[1.5px] border-line bg-surface',
    chip: 'h-11 px-3.5 rounded-full border border-line bg-surface-2',
    'small-primary': disabled ? 'h-11 px-3 rounded-[12px] bg-off-bg' : 'h-11 px-3 rounded-[12px] bg-primary',
    small: disabled ? 'h-11 px-3 rounded-[12px] bg-off-bg' : 'h-11 px-3 rounded-[12px] border-[1.5px] border-line bg-surface',
  }[variant];
  const filled = variant === 'primary' || variant === 'small-primary';
  const text = disabled
    ? 'text-off-fg'
    : filled
      ? 'text-primary-fg'
      : 'text-fg';
  const font = variant === 'primary' ? 'font-sans-bold text-[17px]' : 'font-sans-semibold text-[15px]';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      className={`items-center justify-center active:opacity-80 ${box} ${className}`}
    >
      <Text className={`${font} ${text}`}>{label}</Text>
    </Pressable>
  );
}

/** Square outlined button holding one icon (header settings, refresh). */
export const IconButton = ({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    className="h-11 w-11 items-center justify-center rounded-[12px] border border-line bg-surface active:opacity-70"
  >
    <Icon name={icon} className="text-fg" />
  </Pressable>
);

/** Plain text button (e.g. "Clear"). */
export const TextButton = ({ label, onPress, tone = 'primary' }: { label: string; onPress: () => void; tone?: 'primary' | 'muted' }) => (
  <Pressable onPress={onPress} accessibilityRole="button" className="items-center px-1 py-2 active:opacity-60">
    <Text className={`font-sans-semibold text-[15px] ${tone === 'primary' ? 'text-primary' : 'text-fg-muted'}`}>{label}</Text>
  </Pressable>
);

/** `className` styles the wrapper (e.g. flex-1 when side by side in a row). */
type FieldProps = { label: string; error?: string; big?: boolean; className?: string } & Omit<ComponentProps<typeof TextInput>, 'className'>;

export function Field({ label, error, big, className = '', ...p }: FieldProps) {
  const palette = usePalette();
  return (
    <View className={`gap-1.5 ${className}`}>
      <Text className="font-sans-semibold text-[13px] text-fg-muted">{label}</Text>
      <TextInput
        placeholderTextColor={palette.muted}
        {...p}
        className={`rounded-field border-[1.5px] bg-bg px-3 text-fg ${error ? 'border-danger' : 'border-line'} ${
          big ? 'h-16 font-display text-[32px]' : 'h-12 font-mono text-[15px]'
        }`}
      />
      {error ? <Text className="font-sans text-[13px] text-danger">{error}</Text> : null}
    </View>
  );
}

export const Tag = ({ kind }: { kind: 'fake' | 'real' | 'other' }) => {
  const [bg, fg] = {
    fake: ['bg-primary-soft', 'text-primary-ink'],
    real: ['bg-real-soft', 'text-real'],
    other: ['bg-surface-2', 'text-fg-muted'],
  }[kind];
  return (
    <View className={`rounded-full px-2.5 py-1 ${bg}`}>
      <Text className={`font-sans-bold text-xs tracking-wide ${fg}`}>{kind.toUpperCase()}</Text>
    </View>
  );
};

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

const toneBg: Record<Tone, string> = { ok: 'bg-ok-soft', warn: 'bg-warn-soft', danger: 'bg-danger-soft', neutral: 'bg-surface-2' };
const toneFg: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-fg' };
const toneDot: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-fg-muted' };

/** Small rounded status pill, optionally with a dot. */
export const Pill = ({ tone, label, dot = false }: { tone: Tone; label: string; dot?: boolean }) => (
  <View className={`flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1.5 ${toneBg[tone]}`}>
    {dot ? <View className={`h-2 w-2 rounded-full ${toneDot[tone]}`} /> : null}
    <Text className={`font-sans-semibold text-[13px] ${toneFg[tone]}`}>{label}</Text>
  </View>
);

/** Tinted message box with an icon; `title` is shown bold before the text. */
export const Banner = ({ tone, icon, title, children }: { tone: Exclude<Tone, 'ok' | 'neutral'>; icon: IconName; title?: string; children: string }) => (
  <View className={`flex-row gap-2.5 rounded-field p-3 ${toneBg[tone]}`}>
    <Icon name={icon} size={16} className={`mt-0.5 ${toneFg[tone]}`} />
    <Text className={`flex-1 font-sans text-sm leading-5 ${toneFg[tone]}`}>
      {title ? <Text className="font-sans-bold">{title} </Text> : null}
      {children}
    </Text>
  </View>
);

export interface LogLine {
  time: string;
  msg: string;
  tone: 'normal' | 'warn' | 'danger';
}

/** Monospace log box; empty state included. */
export const LogPanel = ({ lines }: { lines: LogLine[] }) => (
  <View className="gap-2 rounded-field bg-bg p-3">
    {lines.length === 0 ? <Text className="font-mono text-[13px] text-fg-muted">Nothing yet.</Text> : null}
    {lines.map((l, i) => (
      <View key={i} className="flex-row gap-2.5">
        <Text className="font-mono text-[13px] leading-[18px] text-fg-muted">{l.time}</Text>
        <Text
          className={`flex-1 font-mono text-[13px] leading-[18px] ${
            l.tone === 'warn' ? 'text-warn' : l.tone === 'danger' ? 'text-danger' : 'text-fg'
          }`}
        >
          {l.msg}
        </Text>
      </View>
    ))}
  </View>
);

/** Label on the left, monospace value on the right, hairline on top. */
export const KeyValue = ({ label, value, valueClass = 'text-fg' }: { label: string; value: string; valueClass?: string }) => (
  <View className="flex-row items-start justify-between gap-4 border-t border-line py-2.5">
    <Text className="font-sans text-[15px] text-fg-muted">{label}</Text>
    <Text className={`flex-shrink text-right font-mono text-[14px] ${valueClass}`}>{value}</Text>
  </View>
);

/** Bottom sheet over a dimmed backdrop. Tapping the backdrop or back closes it. */
export const Sheet = ({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable className="flex-1 bg-black/45" onPress={onClose} accessibilityLabel="Close" />
    <View className="gap-3.5 rounded-t-[28px] bg-surface px-5 pb-10 pt-3">
      <View className="mb-2 h-1 w-10 self-center rounded-full bg-line" />
      {children}
    </View>
  </Modal>
);

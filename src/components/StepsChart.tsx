// Hourly steps for one day as stacked bars: real (other apps) at the bottom, fake (this
// app) on top. Tap a bar for exact numbers. Built from plain Views (no chart library).
//
// Colors: real is always orange (the app's original brand); fake follows the accent,
// and turns red when the accent itself is orange. Each pair was checked with the dataviz
// palette validator (lightness, chroma, color-blind separation, contrast) per theme,
// which is why the chart uses its own tuned steps rather than the UI accent tokens.

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { HourBucket } from '@/lib/health';
import { useTheme, type Accent } from '@/lib/theme';
import { formatNumber } from '@/lib/time';

const REAL = { light: '#FF5A1F', dark: '#EA580C' };
const FAKE: Record<Accent, { light: string; dark: string }> = {
  orange: { light: '#C8102E', dark: '#C81E5A' }, // red, because "orange" is taken by real
  teal: { light: '#0D9488', dark: '#0EA5A0' },
  violet: { light: '#6D28D9', dark: '#8B5CF6' },
  pink: { light: '#BE185D', dark: '#EC4899' },
};

const HEIGHT = 140;
const GAP = 2; // surface gap between stacked segments

const pad = (n: number) => String(n).padStart(2, '0');
const hourLabel = (ms: number) => `${pad(new Date(ms).getHours())}:00`;

/** Chart colors for the current theme (also used for the FAKE tag dot). */
export function useChartColors() {
  const { scheme, accent } = useTheme();
  return { real: REAL[scheme], fake: FAKE[accent][scheme] };
}

export function StepsChart({ buckets }: { buckets: HourBucket[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { real: realColor, fake: fakeColor } = useChartColors();

  const bars = buckets.map((b) => ({ start: b.start, fake: b.own, real: Math.max(0, b.total - b.own) }));
  const max = Math.max(1, ...bars.map((b) => b.fake + b.real));
  const sel = selected !== null ? bars[selected] : null;
  const totals = bars.reduce((a, b) => ({ real: a.real + b.real, fake: a.fake + b.fake }), { real: 0, fake: 0 });

  return (
    <View className="gap-3">
      {/* Legend (identity never by color alone: swatch + text) */}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Legend color={realColor} label={`Real ${formatNumber(totals.real)}`} />
        <Legend color={fakeColor} label={`Fake ${formatNumber(totals.fake)}`} />
      </View>

      {/* Readout for the tapped hour (text stays in text colors, not series colors) */}
      <Text className="h-5 font-mono text-[13px] text-fg-muted">
        {sel
          ? `${hourLabel(sel.start)}  real ${formatNumber(sel.real)} · fake ${formatNumber(sel.fake)}`
          : `Peak hour ${formatNumber(max)} steps · tap a bar`}
      </Text>

      <View style={{ height: HEIGHT }} className="flex-row items-end gap-[2px] border-b border-line" accessibilityRole="image" accessibilityLabel={`Hourly steps: real ${totals.real}, fake ${totals.fake}`}>
        {bars.map((b, i) => {
          const realH = (b.real / max) * HEIGHT;
          const fakeH = (b.fake / max) * HEIGHT;
          const both = realH > 0 && fakeH > 0;
          const dim = selected !== null && selected !== i;
          return (
            // Hit target is the full column height, bigger than the mark itself.
            <Pressable
              key={b.start}
              onPress={() => setSelected(selected === i ? null : i)}
              className="h-full flex-1 justify-end"
              accessibilityLabel={`${hourLabel(b.start)}: real ${b.real}, fake ${b.fake}`}
            >
              <View style={{ opacity: dim ? 0.35 : 1 }}>
                {fakeH > 0 ? (
                  <View
                    style={{
                      height: Math.max(2, fakeH - (both ? GAP : 0)),
                      backgroundColor: fakeColor,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      marginBottom: both ? GAP : 0,
                    }}
                  />
                ) : null}
                {realH > 0 ? (
                  <View
                    style={{
                      height: Math.max(2, realH),
                      backgroundColor: realColor,
                      borderTopLeftRadius: fakeH > 0 ? 0 : 4,
                      borderTopRightRadius: fakeH > 0 ? 0 : 4,
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Sparse x-axis labels */}
      <View className="flex-row justify-between">
        {[0, 6, 12, 18, 23].map((h) => (
          <Text key={h} className="font-mono text-[11px] text-fg-muted">
            {pad(h)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ backgroundColor: color }} className="h-2.5 w-2.5 rounded-[3px]" />
      <Text className="font-sans-medium text-[13px] text-fg-muted">{label}</Text>
    </View>
  );
}

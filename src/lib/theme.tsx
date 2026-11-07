// Appearance settings: light/dark mode and accent color, saved to a small JSON file.
//
// - Mode goes through NativeWind's colorScheme.set(), which sets Android's Appearance,
//   so the prefers-color-scheme block in global.css (and the status bar) follow it.
// - Accent overrides the --primary* CSS variables with NativeWind's vars() on a root View.

import { File, Paths } from 'expo-file-system';
import { colorScheme as nwColorScheme, useColorScheme, vars } from 'nativewind';
import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Accent = 'orange' | 'teal' | 'violet' | 'pink';

/** "R G B" triples, the format global.css uses. */
type Rgb = string;
interface AccentSet {
  primary: Rgb;
  fg: Rgb;
  soft: Rgb;
  ink: Rgb;
}

export const ACCENTS: Record<Accent, { label: string; light: AccentSet; dark: AccentSet }> = {
  orange: {
    label: 'Orange',
    light: { primary: '196 61 12', fg: '255 255 255', soft: '253 231 220', ink: '154 47 8' },
    dark: { primary: '255 122 69', fg: '26 10 3', soft: '58 30 18', ink: '255 176 143' },
  },
  teal: {
    label: 'Teal',
    light: { primary: '15 118 110', fg: '255 255 255', soft: '214 241 238', ink: '17 94 89' },
    dark: { primary: '45 212 191', fg: '4 26 23', soft: '17 50 46', ink: '153 246 228' },
  },
  violet: {
    label: 'Violet',
    light: { primary: '109 40 217', fg: '255 255 255', soft: '237 233 254', ink: '91 33 182' },
    dark: { primary: '167 139 250', fg: '20 10 40', soft: '40 30 70', ink: '221 214 254' },
  },
  pink: {
    label: 'Pink',
    light: { primary: '190 24 93', fg: '255 255 255', soft: '252 231 243', ink: '157 23 77' },
    dark: { primary: '244 114 182', fg: '40 5 20', soft: '66 20 42', ink: '251 207 232' },
  },
};

/** Base colors from global.css, as hex, for native props that can't take a className. */
const BASE = {
  light: { bg: '#F7F6F2', surface: '#FFFFFF', line: '#E2DFD8', fg: '#17161A', muted: '#5F5C66', real: '#2557D6', thumb: '#FFFFFF' },
  dark: { bg: '#111113', surface: '#1B1B1F', line: '#303037', fg: '#F2F1EE', muted: '#A3A0AA', real: '#7AA7FF', thumb: '#F2F1EE' },
};

const toHex = (rgb: Rgb) => '#' + rgb.split(' ').map((n) => Number(n).toString(16).padStart(2, '0')).join('');

export type Palette = (typeof BASE)['light'] & { primary: string; track: string };

// ---- persistence -------------------------------------------------------------

interface Prefs {
  mode: ThemeMode;
  accent: Accent;
}
const DEFAULTS: Prefs = { mode: 'system', accent: 'orange' };
const prefsFile = () => new File(Paths.document, 'prefs.json');

function loadPrefs(): Prefs {
  try {
    const f = prefsFile();
    if (!f.exists) return DEFAULTS;
    const p = JSON.parse(f.textSync()) as Partial<Prefs>;
    return {
      mode: p.mode === 'light' || p.mode === 'dark' ? p.mode : 'system',
      accent: p.accent && p.accent in ACCENTS ? p.accent : 'orange',
    };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(p: Prefs) {
  try {
    const f = prefsFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(p)).catch(() => {});
  } catch {
    // Not fatal: the choice just won't survive a restart.
  }
}

// ---- context -----------------------------------------------------------------

interface ThemeCtx {
  mode: ThemeMode;
  accent: Accent;
  scheme: 'light' | 'dark';
  palette: Palette;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: Accent) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const scheme = useColorScheme().colorScheme === 'dark' ? 'dark' : 'light';

  // Apply the mode before paint so a forced theme doesn't flash the system one.
  useLayoutEffect(() => {
    nwColorScheme.set(prefs.mode);
  }, [prefs.mode]);

  const value = useMemo<ThemeCtx>(() => {
    const a = ACCENTS[prefs.accent][scheme];
    const update = (p: Partial<Prefs>) =>
      setPrefs((old) => {
        const next = { ...old, ...p };
        savePrefs(next);
        return next;
      });
    return {
      ...prefs,
      scheme,
      palette: { ...BASE[scheme], primary: toHex(a.primary), track: BASE[scheme].line },
      setMode: (mode) => update({ mode }),
      setAccent: (accent) => update({ accent }),
    };
  }, [prefs, scheme]);

  const a = ACCENTS[prefs.accent][scheme];
  const accentVars = vars({ '--primary': a.primary, '--primary-fg': a.fg, '--primary-soft': a.soft, '--primary-ink': a.ink });

  return (
    <Ctx.Provider value={value}>
      <View style={accentVars} className="flex-1 bg-bg">
        {children}
      </View>
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** Swatch color for an accent in the current scheme (for the picker). */
export const accentHex = (a: Accent, scheme: 'light' | 'dark') => toHex(ACCENTS[a][scheme].primary);

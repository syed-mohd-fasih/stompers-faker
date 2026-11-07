/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  // `presets` gives NativeWind's RN defaults; colors below read the CSS variables in global.css.
  presets: [require('nativewind/preset')],
  darkMode: 'media', // follows the phone's system theme via global.css
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        surface: { DEFAULT: c('surface'), 2: c('surface-2') },
        fg: { DEFAULT: c('text'), muted: c('muted') },
        line: c('border'),
        primary: { DEFAULT: c('primary'), fg: c('primary-fg'), soft: c('primary-soft'), ink: c('primary-ink') },
        real: { DEFAULT: c('real'), soft: c('real-soft') },
        warn: { DEFAULT: c('warn'), soft: c('warn-soft') },
        danger: { DEFAULT: c('danger'), soft: c('danger-soft') },
        ok: { DEFAULT: c('ok'), soft: c('ok-soft') },
        off: { bg: c('off-bg'), fg: c('off-fg') },
        brand: '#FF5A1F', // icon/splash only, fixed in both themes
      },
      fontFamily: {
        // Embedded at build time by the expo-font plugin (app.json); names = files in assets/fonts.
        // Each weight is its own family, so use these instead of font-bold/font-semibold
        // (those are Tailwind font-weight classes and would clash on Android).
        display: ['SpaceGrotesk-Bold'],
        sans: ['Inter-Regular'],
        'sans-medium': ['Inter-Medium'],
        'sans-semibold': ['Inter-SemiBold'],
        'sans-bold': ['Inter-Bold'],
        mono: ['JetBrainsMono-Regular'],
      },
      borderRadius: { card: '20px', btn: '16px', field: '12px' },
    },
  },
  plugins: [],
};

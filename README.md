# stompers-faker

Personal-use Android app (Expo + TypeScript) that writes Steps records to
Health Connect, so they show up in Stompers.

- **Main screen:** Health Connect status/permissions, inject steps for a time range,
  presets (+1k / +5k / spread N steps across today), today's total (Health Connect
  aggregate, deduped across apps), this app's records with delete, and a log.
- **Overlaps:** before inserting, the app checks its own existing records in that
  window and offers *Auto-shift*, *Insert anyway* or *Cancel*.
- Records get a `clientRecordId` prefix (`fake-` / `real-`) so the list can tell them apart.
- **Settings → Real-step sync** (off by default): a local Kotlin module
  (`modules/step-sync`) reads the phone's `TYPE_STEP_COUNTER` sensor from a WorkManager job
  every ~15 min and writes the new steps to Health Connect, even with the app closed.

### How real-step sync works

- Enabling clears the baseline; the first run only stores the counter value and writes nothing.
- Each run: delta = counter − last value (after a reboot the counter restarts at 0, so
  delta = counter). Zero deltas are skipped. The record covers *last reading → now*.
- Overlap with fake records is avoided by writing only into the free parts of that window.
  The job tries to read this app's records itself (needs the optional *background read*
  Health Connect permission); as a fallback the main screen mirrors today's fake ranges
  into the native store every time it refreshes. If the whole window is taken, the steps are
  kept and written on a later run.
- Status (last run / sync / delta / error) is in Settings. Logs: `adb logcat -s StepSync`.

## UI / theme

- **NativeWind 4** (Tailwind 3 classes on RN components). Theme colors are CSS variables in
  `global.css` with a dark block under `prefers-color-scheme`, so the app follows the phone's
  light/dark setting (`userInterfaceStyle: "automatic"`). Tokens: `bg`, `surface`, `fg`,
  `fg-muted`, `line`, `primary` (fake), `real`, `warn`, `danger`, `ok`, `off`.
- **Fonts are bundled in the APK** (`assets/fonts/`, linked by the `expo-font` config plugin,
  OFL license in `assets/fonts/OFL.txt`). No runtime download. Each weight is its own family:
  use `font-display` (Space Grotesk Bold), `font-sans`, `font-sans-medium`,
  `font-sans-semibold`, `font-sans-bold` (Inter), `font-mono` (JetBrains Mono), not `font-bold`.
- Screens: bottom tabs Home / Records / Sync / Logs (`src/app/(tabs)/`), plus App settings
  (`src/app/settings.tsx`: System/Light/Dark, accent color, about). Theme choice is saved to
  `prefs.json` in the app's document directory (`src/lib/theme.tsx`). Shared state (log, HC
  status, records) lives in `src/lib/app-state.tsx`.
- `patches/`: a `bun patch` for `react-native-css-interop` (NativeWind) that stops it touching
  RN's deprecated `ImageBackground`, which logged a warning on every start. Re-applied
  automatically by `bun install`; drop it once NativeWind ships a fix.
- Shared components: `src/components/ui.tsx`. Icons: Feather from `@expo/vector-icons`.
- Brand assets: `assets/brand/` (SVG sources + rendered icon, adaptive icon, splash logo).
  Re-render after editing an SVG, e.g. `rsvg-convert -w 1024 -h 1024 assets/brand/adaptive-foreground.svg -o assets/brand/adaptive-foreground-1024.png`.

## Layout

```
src/app/          screens (Expo Router)
src/components/   shared NativeWind UI components
src/lib/health.ts Health Connect wrapper
src/lib/steps.ts  validation, overlap/auto-shift, "spread across today" generator
src/lib/time.ts   date helpers
modules/step-sync local Expo module (Kotlin): sensor reading, WorkManager job, HC writes
```

## Build & run (bun)

```bash
bun install
bunx expo prebuild --platform android      # only after changing app.json / plugins / native deps
bunx expo run:android                      # debug build onto the USB-connected phone
bun start                                  # JS bundler only (= expo start --dev-client); open the installed app
                                           # don't use plain `expo start` + `a`: that tries to install Expo Go
bunx tsc --noEmit && bunx expo lint        # typecheck + lint
```

`android/` is generated (Continuous Native Generation) and git-ignored. Never edit it
by hand; change `app.json` or a config plugin and re-run prebuild. Avoid `--clean`
unless something is really broken, because it forces a slow full rebuild.

## Release APK for sideloading

```bash
bunx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

The generated project signs release builds with the debug keystore, which is fine for
personal sideloading. If you ever switch to your own keystore, uninstall the old build
first (Android refuses to update an app signed with a different key).

To build only for the phone's ABI (faster, smaller):
`./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`

## Troubleshooting

**Permission screen doesn't open / Grant does nothing**
- The library's Expo module registers `HealthConnectPermissionDelegate` in `MainActivity`
  automatically, so no custom plugin is needed. If it still fails, check the log panel and
  `adb logcat | grep -i health`.
- Make sure `android.permission.health.READ_STEPS` / `WRITE_STEPS` are in the generated
  `android/app/src/main/AndroidManifest.xml` (they come from `app.json` → `android.permissions`).
  If not, re-run prebuild.
- Fallback: tap **Open HC settings** → App permissions → stompers-faker → allow Steps.

**Health Connect "unavailable" or "update_required"**
- On Android 12 (EMUI 14.2) Health Connect is the standalone APK
  `com.google.android.apps.healthdata`. Without Play Services you need to sideload a
  recent version of it. `update_required` means the installed APK is too old for the client library.
- After installing/updating, tap **Re-check**.

**Huawei kills the app in the background / real-step sync stops**
- Settings → Battery → App launch → stompers-faker → *Manage manually*, enable all 3 toggles
  (Auto-launch, Secondary launch, Run in background).
- WorkManager's 15 min is a minimum; Android may run it later under Doze. Check
  *Last run* in Settings, or `adb logcat -s StepSync`.
- "Step counter gave no reading": some phones only report the counter while the screen is
  on or after a new step; the next run usually works.

**Gradle runs out of memory (8 GB machine)**
- In `android/gradle.properties`, set `org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m`
  (the default is already ~2 GB). That file is regenerated by `prebuild --clean`, so
  re-apply it after a clean prebuild. Close other heavy apps, and consider
  `org.gradle.parallel=false`. Building for a single ABI (see above) helps a lot.
- `cd android && ./gradlew --stop` kills stuck daemons.

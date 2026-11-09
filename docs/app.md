# App architecture (shared React Native / Expo)

Developer notes for the parts that are the same on Android and iOS. Platform specifics:
[android.md](android.md), [ios.md](ios.md).

Stack: Expo SDK 58, React Native 0.88, TypeScript (strict), Expo Router, NativeWind 4,
`expo-sqlite`. Package manager: **bun** (`bunx expo install <pkg>` for anything native).

## Layout

```
src/app/                 screens (Expo Router)
  _layout.tsx            providers: Theme → Review → AppState, then the Stack
  (tabs)/                Home (index) · Records · Snapshots · History
  settings.tsx           your name, theme/accent, health shortcut, about + updates
src/components/
  ui.tsx                 shared NativeWind building blocks (Card, Button, Field, Sheet, …)
  ReviewSheet.tsx        "preview before change" bottom sheet + useReview()
  StepsChart.tsx         hourly real-vs-fake bar chart (plain Views)
  UpdateCard.tsx         Check for updates flow (Android)
src/lib/
  health.ts              app-level wrapper around modules/health-store
  changes.ts             plan / preview / apply / rollback engine
  db.ts                  SQLite schema + migrations: history, snapshots, settings
  app-state.tsx          shared state + commit()
  steps.ts               validation, overlap/auto-shift, "spread across today" (pure)
  updates.ts             GitHub Releases check/download/verify (Android)
  theme.tsx              System/Light/Dark + accent, saved to prefs.json
  time.ts, useLog.ts     helpers, in-memory debug log
modules/
  health-store/          native module: Kotlin (Health Connect) + Swift (HealthKit)
  app-updater/           native module: Android APK install helper
plugins/                 local config plugins (release signing)
patches/                 bun patches applied on install
```

## Build, run, check

```bash
bun install
bunx expo prebuild --platform android   # after changing app.json / plugins / native code
bunx expo run:android                   # debug build onto a USB-connected phone
bun start                               # JS bundler only (= expo start --dev-client)
bunx tsc --noEmit && bunx expo lint     # run before every commit
```

- `android/` and `ios/` are generated (Continuous Native Generation) and git-ignored. Never
  edit them; change `app.json` or a config plugin and re-run prebuild.
- Don't use plain `expo start` + `a`: without `expo-dev-client` that tries to install Expo Go.
- After adding/removing native code, the app needs a native rebuild, not just Metro.

## The health-store module (one API, two platforms)

`modules/health-store/index.ts` defines the contract; Kotlin and Swift implement exactly
the same functions and result shapes. Times are epoch **milliseconds**.

| Function | Returns |
|---|---|
| `getStatus()` | `'available' \| 'unavailable' \| 'update_required'` |
| `getPermissions()` / `requestPermissions()` | `{ read: boolean \| 'unknown', write: boolean }` |
| `insertSteps([{start,end,count,clientId}])` | platform ids, same order |
| `readOwnSteps(start, end)` | this app's records touching the range |
| `deleteSteps(ids)` | — (only this app's records can be deleted) |
| `totalSteps(start, end)` | all sources, deduplicated by the platform |
| `hourlySteps(start, end)` | `[{start, total, own}]` per hour |
| `openHealthSettings()` | opens Health Connect / the Health app |

Screens never call the module directly; they use `src/lib/health.ts`.

`clientId` tags our records: `fake-<start>-<end>` for injected ones, `real-…` for records from
the removed v1.0 background sync (shown as "legacy").

## Changes: plan → preview → apply → history

Every write to health data goes through `src/lib/changes.ts`:

1. `plan…()` builds a **ChangeSet** `{ inserts, deletes, ownBefore, … }` without touching
   anything: `planInsert`, `planDelete`, `planDeleteFake`, `planDeleteAll`, `planSnapshot`,
   `planRestore(snapshotId)`, `planRollback(opId)`.
2. Screens call `commit(plan, { review: true })` from `useApp()`. With `review`, the
   ReviewSheet shows every record that would be inserted/deleted and before → after totals.
3. `apply()` executes it and writes one `operations` row plus one `changes` row per record
   (with the platform id), so the operation can be rolled back later.
4. Bulk deletions (`delete_fake`, `delete_all`, `restore`, `rollback`) first save an
   automatic snapshot.

Rollback = the inverse ChangeSet of a past operation: delete what it inserted (if still
there), re-insert what it deleted (if not back already). Re-inserted records get new ids.

"Everything this app wrote" means what the platform still lets us read: `LOOKBACK_MS` in
`changes.ts` (30 days on Android because of the standalone Health Connect limit).

## Database (`src/lib/db.ts`)

`expo-sqlite`, file `stompers.db`, sync API. Tables: `operations`, `changes` (cascade),
`snapshots`, `snapshot_records` (cascade), `settings`.

Schema changes: append a new SQL string to `MIGRATIONS` (never edit an old one). The index
is the schema version, stored in `PRAGMA user_version`; pending migrations run in a
transaction on app start.

History cleanup (`pruneOperations`) deletes old operations and their changes; those can't
be undone afterwards. Snapshots are deleted individually.

## UI and theme

- **NativeWind 4** (Tailwind 3). Colors are CSS variables in `global.css` with a dark block
  under `prefers-color-scheme`. `darkMode: 'class'` in `tailwind.config.js` only so
  `colorScheme.set()` is allowed (System/Light/Dark in Settings); it goes through
  Appearance, so the media block follows it. The accent overrides `--primary*` via `vars()`
  on a root View (`src/lib/theme.tsx`).
- Tokens: `bg`, `surface`, `surface-2`, `fg`, `fg-muted`, `line`, `primary(-fg/-soft/-ink)`,
  `warn`, `danger`, `ok`, `off`.
- **Fonts are bundled** (`assets/fonts/`, `expo-font` config plugin; OFL in
  `assets/fonts/OFL.txt`). Each weight is its own family: `font-display`, `font-sans`,
  `font-sans-medium`, `font-sans-semibold`, `font-sans-bold`, `font-mono`. Don't use
  `font-bold` etc. (Tailwind weight classes would clash on Android).
- NativeWind doesn't resolve conflicting classes by order: add a variant (see `Button`'s
  `danger`) instead of overriding `bg-*` via `className`.
- Native props that can't take classes (Switch, tab bar, RefreshControl) use
  `usePalette()`.
- Icons: Feather from `@expo/vector-icons` (`Icon` in `ui.tsx`, colored by className).
- Chart colors (`StepsChart.tsx`) are separate tuned steps per theme, validated for
  color-blind separation and contrast: real = orange, fake = accent (red when the accent is
  orange). Re-validate if you change them.
- Brand assets: `assets/brand/` (SVG sources + rendered PNGs). Re-render after editing, e.g.
  `rsvg-convert -w 1024 -h 1024 assets/brand/adaptive-foreground.svg -o assets/brand/adaptive-foreground-1024.png`.

## Patches

`patches/react-native-css-interop@0.2.7.patch` (`bun patch`): stops NativeWind's interop
from reading RN's deprecated `ImageBackground`, which logged a warning on every start.
Re-applied by `bun install`; drop it once NativeWind ships a fix.

## Versioning and releases

`version` in `app.json` (MAJOR.MINOR.PATCH) is the single source. `app.config.js` derives
the Android `versionCode` (`major*10000 + minor*100 + patch`).

```bash
# bump "version" in app.json, e.g. 1.1.1, then:
git commit -am "Release v1.1.1"
git tag v1.1.1
git push origin main v1.1.1   # tag push → CI builds APK + IPA → GitHub Release
```

`.github/workflows/release.yml`: `version` check → `android` + `ios` builds in parallel →
`publish` (needs the APK; attaches the IPA if it built). "Run workflow" in the Actions tab
builds artifacts without releasing. Details per platform in the other docs.

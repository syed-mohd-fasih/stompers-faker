# Android

Developer notes for the Android side. Shared architecture: [app.md](app.md).

App id: `dev.fasih.stompersfaker`. Health data goes to **Health Connect**.
Reference device: Huawei Nova 11i, EMUI 14.2 (Android 12), no Google Play Services,
standalone Health Connect APK (`com.google.android.apps.healthdata`).

## Native code

### `modules/health-store` (Kotlin)

`android/src/main/java/expo/modules/healthstore/HealthStoreModule.kt`, using
`androidx.health.connect:connect-client:1.1.0` directly.

- **Permissions:** Health Connect's dialog is an Activity-for-result. The module registers
  `PermissionController.createRequestPermissionResultContract()` through Expo's
  `RegisterActivityContracts` / `registerForActivityResult` and launches it on the main
  thread, then re-reads what is actually granted.
- **Manifest:** the module manifest declares `READ_STEPS` / `WRITE_STEPS` and a `<queries>`
  entry for the Health Connect app. `app.plugin.js` adds what has to live on the app's
  activity: the `ACTION_SHOW_PERMISSIONS_RATIONALE` intent-filter (Android ≤ 13) and the
  `ViewPermissionUsageActivity` alias (Android 14+). Without these, Health Connect won't let
  users grant access.
- **Writes:** `StepsRecord` with `Metadata.unknownRecordingMethod(clientId, …)`.
- **Reads:** `readRecords` filtered by our `DataOrigin`, paged. Some Health Connect versions
  return `""` instead of `null` on the last page, so the loop checks for empty strings.
- **Totals:** `aggregate(COUNT_TOTAL)`. Hourly: `aggregateGroupByDuration` twice (all
  sources, and own `DataOrigin`); the chart shows real = total − own. Health Connect
  deduplicates by source priority, so if another app is preferred for an hour, our steps may
  not count in the total for that hour (same as what Stompers sees).

### `modules/app-updater` (Kotlin)

`canInstallPackages()`, `openInstallPermissionSettings()`, `sha256(uri)`, `installApk(uri)`.
The APK is shared with the system installer through **expo-file-system's FileProvider**
(`${applicationId}.FileSystemFileProvider`, cache + files dirs), so no extra provider is
needed. Declares `REQUEST_INSTALL_PACKAGES`.

## Health Connect limits worth knowing

- Apps can only delete or modify their own records.
- Android 12/13 standalone Health Connect: apps can read about **30 days** back. This is
  why `LOOKBACK_MS` is 29 days on Android; `readOwnRecords` adds one day so records that
  started before a range are found, which makes 30 (snapshots, "delete all", undo reach that far).
- `getSdkStatus()` = `update_required` means the installed Health Connect is too old for
  the client library: sideload a newer Health Connect APK.

## Building

```bash
bunx expo prebuild --platform android
bunx expo run:android        # debug, installs on the USB phone, then launch from the launcher
```

Release build locally (signed with the private key):

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

Always test a release build after native changes: R8 (minify) only runs there. v1.0.0
crashed at startup because R8 stripped a reflective constructor (WorkManager, since
removed); add keep rules as `consumerProguardFiles` in the module that needs them.

### Signing

`plugins/withReleaseSigning.js` makes release builds use `keystore.properties` in the
project root (git-ignored):

```properties
storeFile=/home/<you>/.android/stompers-faker-release.jks
storePassword=...
keyAlias=stompers-faker
keyPassword=...
```

Without that file a release build fails on purpose instead of silently using the debug key.
**Back up the `.jks` and its passwords**: Android only installs updates signed with the same
key. Debug builds keep using the debug key, so a debug build and a release build can't be
installed over each other (uninstall first).

### CI (`android` job)

Linux runner → `bun install` → `expo prebuild` → writes `keystore.properties` from secrets →
`assembleRelease` (arm64) → `stompers-faker-vX.apk` + `.sha256`.

Secrets (repo → Settings → Secrets and variables → Actions), or with `gh`:

```bash
base64 -w0 ~/.android/stompers-faker-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEY_ALIAS --body stompers-faker
grep '^storePassword=' keystore.properties | cut -d= -f2- | tr -d '\n' | gh secret set ANDROID_KEYSTORE_PASSWORD
grep '^keyPassword=' keystore.properties | cut -d= -f2- | tr -d '\n' | gh secret set ANDROID_KEY_PASSWORD
```

### In-app updates

`src/lib/updates.ts` reads `releases/latest` from the GitHub API without a token (works once
the repo is public), downloads the `.apk` to the cache dir, compares its SHA-256 with the
published `.apk.sha256`, then opens the system installer (the user confirms; data is kept).

## Troubleshooting

**Grant does nothing / no permission screen**
- Check the generated `android/app/src/main/AndroidManifest.xml` has the rationale
  intent-filter and `ViewPermissionUsageActivity`; re-run prebuild if not.
- Debug log (History tab) and `adb logcat | grep -i health`.
- Fallback: HC settings → App permissions → Stompers Faker → allow Steps.

**Splash shows no logo (plain background)**
- Normal when started by `adb` / `expo run:android` / `monkey`: on Android 12, EMUI uses the
  plain-color splash for non-launcher starts (`icon_preferred` only works on 13+). Tapping
  the home-screen icon shows the logo.

**"Gradle build daemon disappeared unexpectedly" / out of memory (8 GB machine)**
- The daemon was OOM-killed. Stop Metro and other heavy apps during native builds.
- `android/gradle.properties`: `org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m`,
  consider `org.gradle.parallel=false`. Re-apply after `prebuild --clean`.
- Build only arm64 (`-PreactNativeArchitectures=arm64-v8a`). `./gradlew --stop` kills stuck
  daemons.

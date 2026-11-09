# iOS

Developer notes for the iOS side. Shared architecture: [app.md](app.md).

Bundle id: `dev.fasih.stompersfaker`. Health data goes to **HealthKit** (Apple Health).

> **Status:** the Swift code is compiled only by the CI `ios` job (macOS runner). It has not
> been run on a real iPhone yet. Distribution to friends (SideStore vs. paid ad hoc builds)
> is still to be decided; see the open question at the end.

## Native code: `modules/health-store` (Swift)

`ios/HealthStoreModule.swift` + `ios/HealthStore.podspec` (iOS 16.4+, links HealthKit).
Same functions and result shapes as the Kotlin side (see the table in [app.md](app.md)).

- **Store:** one shared `HKHealthStore`, type `HKQuantityType(.stepCount)`.
- **Permissions:** `requestAuthorization(toShare:read:)`. HealthKit **never reveals read
  access** (privacy), so `read` is always `'unknown'`; only write status is real
  (`authorizationStatus(for:)`). The app treats unknown read as OK.
- **Writes:** `HKQuantitySample` with our id in metadata key `StompersClientId`. We
  deliberately don't use `HKMetadataKeySyncIdentifier`: HealthKit would replace/ignore
  samples with the same id, which breaks "Insert anyway" and restores.
- **Reads:** `HKSampleQueryDescriptor` with `predicateForObjects(from: .default())` (our
  samples only) and an overlapping date predicate.
- **Deletes:** `deleteObjects(of:predicate:)` by UUID. HealthKit only deletes what this app
  wrote.
- **Totals:** `HKStatisticsQuery(.cumulativeSum)`; hourly via `HKStatisticsCollectionQuery`
  with `.separateBySource`, own = `sumQuantity(for: .default())`. "No data" errors return 0.
- **Settings shortcut:** opens the Health app (`x-apple-health://`); permissions are under
  Sharing → Apps.
- No step-history limit like Android's 30 days, so `LOOKBACK_MS` is 10 years on iOS.
- The iPhone records its own steps into Health, so iOS needs no background sync.

## Config (`modules/health-store/app.plugin.js`)

Adds the `com.apple.developer.healthkit` entitlement and the two Info.plist strings iOS
shows in the permission sheet (`NSHealthShareUsageDescription`,
`NSHealthUpdateUsageDescription`). The app crashes on `requestAuthorization` without them.

## Building

You can't build iOS on Linux. Options:

- **CI (current):** the `ios` job in `.github/workflows/release.yml` on `macos-latest`:
  `expo prebuild -p ios` (runs `pod install`) → `xcodebuild archive` with code signing off →
  **ad-hoc sign** the `.app` with our entitlements file (`codesign --sign -`) → zip
  `Payload/` → `stompers-faker-vX.ipa` + `.sha256`. Without the ad-hoc signature the HealthKit
  entitlement isn't embedded, and SideStore wouldn't request it when re-signing. Run it from
  the Actions tab ("Run workflow") to get the IPA as an artifact.
- **A Mac:** `bunx expo prebuild -p ios`, open `ios/*.xcworkspace` in Xcode, select a team,
  run on a device.
- **EAS Build** (Expo's cloud Macs) works too, but always signs device builds with Apple
  credentials, so it fits the paid ad hoc route rather than SideStore.

macOS minutes count 10× on private repos (free once the repo is public).

## Distribution (to decide)

- **SideStore / AltStore (free Apple ID):** friends install the IPA and SideStore signs it
  with their own Apple ID. Apps must be refreshed every 7 days (SideStore does this on-device
  with its VPN helper running); max 3 sideloaded apps; first setup needs a computer once.
  Updates: open `sidestore://install?url=<ipa url>` from the app, or publish a SideStore
  "source" JSON so updates show up in SideStore. (Verify the exact URL scheme when building
  the iOS update button.)
- **Paid Apple Developer Program ($99/year), ad hoc:** register each friend's device UDID
  (up to 100/year), builds last a year, no refreshing, no Apple review.
- **Not possible:** App Store / external TestFlight. Apple's rules forbid writing inaccurate
  data to HealthKit, so review would reject it.

**Open question:** whether free-account signing gets the HealthKit entitlement. Sources
disagree (one project reports Xcode refusing "Personal development teams … do not support
the HealthKit capability"). First test: one friend sideloads a CI IPA via SideStore, taps
Grant, injects 1 step. If HealthKit is refused, use the paid ad hoc route.

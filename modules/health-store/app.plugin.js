// Config plugin for the health-store module.
//
// Android (Health Connect): the permission screen only lets users grant access if the
// app's launcher activity can show a "privacy policy / rationale" screen:
//   - Android ≤ 13: an intent-filter for ACTION_SHOW_PERMISSIONS_RATIONALE on MainActivity
//   - Android 14+:  an activity-alias guarded by START_VIEW_PERMISSION_USAGE
// (Same as what react-native-health-connect's plugin did; that library is no longer used.)
//
// iOS (HealthKit): the HealthKit entitlement, plus the two usage strings iOS shows in
// its permission sheet (the app crashes on requestAuthorization without them).

const { AndroidConfig, withAndroidManifest, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const RATIONALE_ACTION = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';
const ALIAS = 'ViewPermissionUsageActivity';

function withHealthConnectManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);

    main['intent-filter'] = main['intent-filter'] ?? [];
    const hasRationale = main['intent-filter'].some((f) =>
      (f.action ?? []).some((a) => a.$['android:name'] === RATIONALE_ACTION),
    );
    if (!hasRationale) main['intent-filter'].push({ action: [{ $: { 'android:name': RATIONALE_ACTION } }] });

    app['activity-alias'] = app['activity-alias'] ?? [];
    if (!app['activity-alias'].some((a) => a.$['android:name'] === ALIAS)) {
      app['activity-alias'].push({
        $: {
          'android:name': ALIAS,
          'android:exported': 'true',
          'android:targetActivity': main.$['android:name'],
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
          },
        ],
      });
    }
    return cfg;
  });
}

function withHealthKit(config) {
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.healthkit'] = true;
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSHealthShareUsageDescription ??=
      'Stompers Faker reads your step count to show today’s total and the records it wrote.';
    cfg.modResults.NSHealthUpdateUsageDescription ??=
      'Stompers Faker writes step records that you add, so other apps like Stompers can read them.';
    return cfg;
  });
}

module.exports = (config) => withHealthKit(withHealthConnectManifest(config));

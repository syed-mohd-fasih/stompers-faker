// Config plugin: sign release builds with our own keystore (instead of the debug key
// the Expo template uses), so it survives `expo prebuild --clean`.
//
// Credentials come from `keystore.properties` in the project root (git-ignored):
//   storeFile=/absolute/path/to/release.jks   (or a path relative to the project root)
//   storePassword=...
//   keyAlias=...
//   keyPassword=...
// Locally you create it once (see README); in CI the workflow writes it from secrets.
// Debug builds are unchanged. A release build without the file fails with a clear error
// rather than silently falling back to the debug key.

const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @stompers-faker release signing';

const signingBlock = `
        ${MARKER}
        release {
            def ksFile = rootProject.file('../keystore.properties')
            if (ksFile.exists()) {
                def ks = new Properties()
                ksFile.withInputStream { ks.load(it) }
                def store = new File(ks['storeFile'])
                storeFile store.isAbsolute() ? store : rootProject.file('../' + ks['storeFile'])
                storePassword ks['storePassword']
                keyAlias ks['keyAlias']
                keyPassword ks['keyPassword']
            }
        }`;

const failIfMissing = `
${MARKER}
gradle.taskGraph.whenReady { graph ->
    def wantsRelease = graph.allTasks.any { it.name.toLowerCase().contains('release') && it.project.name == 'app' }
    if (wantsRelease && !rootProject.file('../keystore.properties').exists()) {
        throw new GradleException('Release signing: keystore.properties not found in the project root. See README → Release APK.')
    }
}
`;

module.exports = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARKER)) return cfg; // already applied

    // 1. Add a `release` signing config next to the template's `debug` one.
    if (!/signingConfigs\s*\{/.test(g)) throw new Error('withReleaseSigning: signingConfigs block not found');
    g = g.replace(/signingConfigs\s*\{/, (m) => m + signingBlock);

    // 2. Point the release build type at it (the template uses signingConfigs.debug).
    const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseType.test(g)) throw new Error('withReleaseSigning: release buildType signingConfig not found');
    g = g.replace(releaseType, '$1signingConfig signingConfigs.release');

    // 3. Fail loudly if someone builds a release without credentials.
    g += failIfMissing;

    cfg.modResults.contents = g;
    return cfg;
  });

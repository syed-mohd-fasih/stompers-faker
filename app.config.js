// Dynamic config on top of app.json. Only derives android.versionCode from the
// semver "version", so every release automatically installs over the previous one:
//   1.2.3 → 10203   (major * 10000 + minor * 100 + patch; minor/patch must stay < 100)
// To release: bump "version" in app.json, commit, tag vX.Y.Z (see README).

module.exports = ({ config }) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(config.version ?? '');
  if (!m) throw new Error(`app.json "version" must be MAJOR.MINOR.PATCH, got "${config.version}"`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error('minor and patch must be ≤ 99 for the versionCode scheme');
  return {
    ...config,
    android: { ...config.android, versionCode: major * 10000 + minor * 100 + patch },
  };
};

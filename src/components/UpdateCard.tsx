// "Check for updates" (Settings → About). Android: download + verify + system installer.
// Other platforms render nothing for now (iOS will hand the .ipa link to SideStore).

import type { File } from 'expo-file-system';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { currentVersion, downloadApk, fetchLatest, install, isNewer, updatesSupported, verifyApk, type ReleaseInfo } from '@/lib/updates';
import { errMsg } from '@/lib/useLog';
import { Button, TextButton } from './ui';

type State =
  | { s: 'idle' }
  | { s: 'checking' }
  | { s: 'latest'; version: string }
  | { s: 'available'; rel: ReleaseInfo }
  | { s: 'downloading'; rel: ReleaseInfo; progress: number }
  | { s: 'ready'; rel: ReleaseInfo; file: File; verified: boolean; needsPermission?: boolean }
  | { s: 'error'; message: string };

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function UpdateCard() {
  const [st, setSt] = useState<State>({ s: 'idle' });
  if (!updatesSupported) return null;

  const check = async () => {
    setSt({ s: 'checking' });
    try {
      const rel = await fetchLatest();
      setSt(isNewer(rel.version, currentVersion) ? { s: 'available', rel } : { s: 'latest', version: rel.version });
    } catch (e) {
      setSt({ s: 'error', message: errMsg(e) });
    }
  };

  const download = async (rel: ReleaseInfo) => {
    setSt({ s: 'downloading', rel, progress: 0 });
    try {
      const file = await downloadApk(rel, (p) => setSt({ s: 'downloading', rel, progress: p }));
      const verified = (await verifyApk(rel, file)) === 'verified';
      setSt({ s: 'ready', rel, file, verified });
    } catch (e) {
      setSt({ s: 'error', message: errMsg(e) });
    }
  };

  const runInstall = (rel: ReleaseInfo, file: File, verified: boolean) => {
    try {
      // false = the "Install unknown apps" setting was opened; user comes back and taps again.
      const started = install(file);
      setSt({ s: 'ready', rel, file, verified, needsPermission: !started });
    } catch (e) {
      setSt({ s: 'error', message: errMsg(e) });
    }
  };

  return (
    <View className="gap-2.5 border-t border-line pt-3">
      {st.s === 'idle' || st.s === 'checking' ? (
        <Button label={st.s === 'checking' ? 'Checking…' : 'Check for updates'} variant="secondary" onPress={check} disabled={st.s === 'checking'} />
      ) : null}

      {st.s === 'latest' ? (
        <>
          <Text className="font-sans text-[15px] text-fg">You’re on the latest version ({currentVersion}).</Text>
          <TextButton label="Check again" tone="muted" onPress={check} />
        </>
      ) : null}

      {st.s === 'available' ? (
        <>
          <Text className="font-sans-semibold text-[15px] text-fg">
            Version {st.rel.version} is available <Text className="font-sans text-fg-muted">(you have {currentVersion})</Text>
          </Text>
          {st.rel.notes ? (
            <Text className="font-sans text-[14px] leading-5 text-fg-muted" numberOfLines={8}>
              {st.rel.notes}
            </Text>
          ) : null}
          <Button label={`Download (${mb(st.rel.apk.size)})`} onPress={() => download(st.rel)} />
          <TextButton label="Open release page" tone="muted" onPress={() => Linking.openURL(st.rel.url)} />
        </>
      ) : null}

      {st.s === 'downloading' ? (
        <>
          <Text className="font-sans text-[15px] text-fg">Downloading {st.rel.version}… {Math.round(st.progress * 100)}%</Text>
          <View className="h-2 overflow-hidden rounded-full bg-surface-2">
            <View className="h-2 rounded-full bg-primary" style={{ width: `${Math.round(st.progress * 100)}%` }} />
          </View>
        </>
      ) : null}

      {st.s === 'ready' ? (
        <>
          <Text className="font-sans text-[15px] text-fg">
            {st.rel.version} downloaded{st.verified ? ' and verified (SHA-256 matches).' : ' (no checksum published, not verified).'}
          </Text>
          {st.needsPermission ? (
            <Text className="font-sans text-[14px] leading-5 text-fg-muted">
              Allow “Install unknown apps” for Stompers Faker in the screen that just opened, then come back and tap Install.
            </Text>
          ) : (
            <Text className="font-sans text-[14px] leading-5 text-fg-muted">
              Android will ask you to confirm. Your records, history and settings are kept.
            </Text>
          )}
          <Button label="Install" onPress={() => runInstall(st.rel, st.file, st.verified)} />
        </>
      ) : null}

      {st.s === 'error' ? (
        <>
          <Text className="font-sans text-[14px] leading-5 text-danger">{st.message}</Text>
          <TextButton label="Try again" tone="muted" onPress={check} />
        </>
      ) : null}
    </View>
  );
}

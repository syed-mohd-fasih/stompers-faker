// "Check for updates" (Android): reads the latest GitHub Release, downloads the APK,
// verifies its SHA-256 against the .sha256 file CI publishes next to it, and opens the
// system installer. Works without a token once the repo is public.

import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import AppUpdater from '../../modules/app-updater';

const REPO = 'syed-mohd-fasih/stompers-faker';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

export const updatesSupported = AppUpdater !== null;
export const currentVersion = Constants.expoConfig?.version ?? '0.0.0';

export interface ReleaseInfo {
  version: string;
  tag: string;
  notes: string;
  url: string;
  apk: { name: string; url: string; size: number };
  sha256Url: string | null;
}

/** "v1.2.3" / "1.2.3" → [1,2,3]; compare a > b. */
const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export async function fetchLatest(): Promise<ReleaseInfo> {
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) throw new Error('No releases found (is the repo still private?)');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const json = (await res.json()) as { tag_name: string; body?: string; html_url: string; assets: GhAsset[] };
  const apk = json.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk) throw new Error(`Release ${json.tag_name} has no APK`);
  const sha = json.assets.find((a) => a.name === `${apk.name}.sha256`);
  return {
    version: json.tag_name.replace(/^v/, ''),
    tag: json.tag_name,
    notes: (json.body ?? '').trim(),
    url: json.html_url,
    apk: { name: apk.name, url: apk.browser_download_url, size: apk.size },
    sha256Url: sha?.browser_download_url ?? null,
  };
}

/** Downloads the APK into the cache dir (replacing an older copy). */
export async function downloadApk(rel: ReleaseInfo, onProgress: (fraction: number) => void): Promise<File> {
  const dest = new File(Paths.cache, rel.apk.name);
  if (dest.exists) dest.delete();
  const out = await File.downloadFileAsync(rel.apk.url, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? bytesWritten / totalBytes : bytesWritten / rel.apk.size),
  });
  return out;
}

/** Compares the file's SHA-256 with the published one. Throws on mismatch. */
export async function verifyApk(rel: ReleaseInfo, file: File): Promise<'verified' | 'unverified'> {
  if (!rel.sha256Url || !AppUpdater) return 'unverified';
  const expected = (await (await fetch(rel.sha256Url)).text()).trim().split(/\s+/)[0].toLowerCase();
  const actual = await AppUpdater.sha256(file.uri);
  if (expected !== actual) {
    file.delete();
    throw new Error('Downloaded file is corrupted (SHA-256 mismatch). Try again.');
  }
  return 'verified';
}

/** Returns false if the user first has to allow "Install unknown apps" (settings opened). */
export function install(file: File): boolean {
  if (!AppUpdater) throw new Error('Updates are only supported on Android');
  if (!AppUpdater.canInstallPackages()) {
    AppUpdater.openInstallPermissionSettings();
    return false;
  }
  AppUpdater.installApk(file.uri);
  return true;
}

// JS side of the app-updater module (Android only; null on iOS, where SideStore
// handles updates).
import { requireOptionalNativeModule } from 'expo';

interface NativeAppUpdater {
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): void;
  sha256(uri: string): Promise<string>;
  installApk(uri: string): void;
}

const AppUpdater = requireOptionalNativeModule<NativeAppUpdater>('AppUpdater');
export default AppUpdater;

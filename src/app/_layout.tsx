import '../../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';

// Dev-only deprecation warning raised inside a dependency, not our code.
LogBox.ignoreLogs(['ImageBackground is deprecated']);

// Screens draw their own headers (see the design), so the native header is hidden.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </>
  );
}

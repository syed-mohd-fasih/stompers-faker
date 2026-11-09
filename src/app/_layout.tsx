import '../../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReviewProvider } from '@/components/ReviewSheet';
import { AppStateProvider } from '@/lib/app-state';
import { ThemeProvider, useTheme } from '@/lib/theme';

// Root: theme + shared app state around a stack of [tabs] → [app settings].
// Screens draw their own headers (see the design), so native headers are hidden.
function Root() {
  const { palette } = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: palette.bg } }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ReviewProvider>
        <AppStateProvider>
          <Root />
        </AppStateProvider>
      </ReviewProvider>
    </ThemeProvider>
  );
}

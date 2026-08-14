import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Colors } from '@/constants/theme';
import { queryClient } from '@/lib/query-client';
import { SessionProvider, useSession } from '@/lib/session-context';

SplashScreen.preventAutoHideAsync();

/**
 * The navigators read their chrome (header, ground, tint, hairlines) from
 * these themes, so the studio palette has to be injected here or every screen
 * would sit on iOS-default white and blue.
 */
const paper = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.light.primary,
    background: Colors.light.background,
    card: Colors.light.card,
    text: Colors.light.text,
    border: Colors.light.border,
  },
};

const ink = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.dark.primary,
    background: Colors.dark.background,
    card: Colors.dark.card,
    text: Colors.dark.text,
    border: Colors.dark.border,
  },
};

function RootNavigator() {
  const { ready, signedIn } = useSession();

  // The splash overlay is still covering the screen at this point, so
  // rendering nothing while the keychain is read never shows as a flash.
  if (!ready) return null;

  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Novels', headerLargeTitle: true }} />
        {/* The wizard is a creation flow, so it presents the way Mail's
            composer does: a sheet carrying its own navigation stack. */}
        <Stack.Screen
          name="new-novel"
          options={{ headerShown: false, presentation: 'modal' }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? ink : paper}>
      {/* Keyboard handling is a project convention: every screen relies on
          react-native-keyboard-controller (never RN's KeyboardAvoidingView),
          so its provider sits once at the root. */}
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <AnimatedSplashOverlay />
            <RootNavigator />
          </SessionProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </ThemeProvider>
  );
}

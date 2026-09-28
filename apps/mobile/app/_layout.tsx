import { Stack, useRouter, useSegments } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { devToolsEnabled } from '../src/state/devTools';
import { ShareIntentHandler } from '../src/share/ShareIntentHandler';
import { AppStateProvider, useAppState } from '../src/state/AppState';
import { colors } from '../src/ui/theme';

// Consentimento vem antes de tudo; depois, login. Rotas públicas: consent, login, about.
function Gate() {
  const { ready, consented, authStatus } = useAppState();
  const segments = useSegments();
  const router = useRouter();
  const current = segments[0] as string | undefined;

  useEffect(() => {
    if (!ready) return;
    if (!consented) {
      if (current !== 'consent' && current !== 'about') router.replace('/consent');
    } else if (authStatus === 'signedOut') {
      if (current !== 'login' && current !== 'about') router.replace('/login');
    } else if (current === 'consent' || current === 'login' || current === undefined) {
      router.replace('/home');
    }
  }, [ready, consented, authStatus, current, router]);

  return null;
}

function Root() {
  const { ready } = useAppState();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <>
      <Stack screenOptions={{ headerTintColor: colors.primary }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="consent" options={{ title: 'Antes de começar', headerBackVisible: false }} />
        <Stack.Screen name="login" options={{ title: 'Entrar', headerBackVisible: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="discover" options={{ title: 'Sugestões' }} />
        <Stack.Screen name="title/[id]" options={{ title: 'Título' }} />
        <Stack.Screen name="list/[id]" options={{ title: 'Lista' }} />
        <Stack.Screen name="share/[id]" options={{ title: 'Compartilhamento' }} />
        <Stack.Screen name="about" options={{ title: 'Sobre' }} />
        {devToolsEnabled ? <Stack.Screen name="dev/share" options={{ title: 'Simulador de share' }} /> : null}
      </Stack>
      <Gate />
      <ShareIntentHandler />
      <StatusBar style="auto" />
    </>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ resetOnBackground: false }}>
      <AppStateProvider>
        <Root />
      </AppStateProvider>
    </ShareIntentProvider>
  );
}

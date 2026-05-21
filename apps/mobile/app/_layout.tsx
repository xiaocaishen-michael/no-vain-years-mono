import '../global.css';

import { useAuthStore } from '@nvy/auth';
import { Stack, useNavigationContainerRef, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { decideAuthRoute } from '../lib/auth-gate-decision';

// PHASE 1 PLACEHOLDER — splash visuals (logo / animation) deferred to mockup.
// Bare RN per ADR-0017 occupy-UI 4 boundaries.
function SplashPlaceholder() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>加载中…</Text>
    </View>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const router = useRouter();
  const navRef = useNavigationContainerRef();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const displayName = useAuthStore((s) => s.displayName);
  const [navReady, setNavReady] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(() => useAuthStore.persist.hasHydrated());

  // Wait for the navigation container to actually mount before any
  // router.replace — Expo Router asserts navigationRef.isReady() and throws
  // "Attempted to navigate before mounting the Root Layout component" otherwise.
  useEffect(() => {
    if (navRef.isReady()) {
      setNavReady(true);
      return;
    }
    const unsubscribe = navRef.addListener('state', () => {
      if (navRef.isReady()) setNavReady(true);
    });
    return unsubscribe;
  }, [navRef]);

  // Subscribe to persist rehydration. US12 demands AuthGate render a splash
  // (not jump routes) while displayName / refreshToken are still being
  // pulled out of SecureStore — otherwise the user sees a flash of
  // /(auth)/login between cold boot and rehydrate.
  useEffect(() => {
    setHasHydrated(useAuthStore.persist.hasHydrated());
    return useAuthStore.persist.onFinishHydration(() => setHasHydrated(true));
  }, []);

  useEffect(() => {
    if (!navReady || !hasHydrated) return;
    const decision = decideAuthRoute({
      isAuthenticated,
      displayName,
      inAuthGroup: segments[0] === '(auth)',
      inOnboarding: segments.includes('onboarding'),
    });
    if (decision.kind === 'replace') {
      router.replace(decision.target as Parameters<typeof router.replace>[0]);
    }
  }, [navReady, hasHydrated, isAuthenticated, displayName, segments, router]);

  if (!hasHydrated) return <SplashPlaceholder />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
    </SafeAreaProvider>
  );
}

// Crypto polyfill — must be the very first import so any subsequent module
// that touches globalThis.crypto.getRandomValues() sees the shim. Defensive:
// expo-crypto.randomUUID() in current stack (SDK 54 / RN 0.81) does NOT need
// this on iOS/Android/Web (uses native module + globalThis.crypto.randomUUID),
// but pinning the polyfill guards against future libs (uuid v9+, nanoid 5,
// etc.) that bypass expo-crypto and read getRandomValues directly.
import 'react-native-get-random-values';
import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useNavigationContainerRef, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '~/auth';
import { decideAuthRoute, resolveDisplayName } from '~/core/auth-gate-decision';
import { queryClient } from '~/core/api/query-client';
import { setupAxios } from '~/core/api/setup';
import { useMe } from '~/core/api/use-me';
import { ErrorBoundary } from '~/core/error-boundary';

// One-shot axios install — baseURL + x-trace-id + Authorization Bearer
// interceptors (per ADR-0027 / ADR-0036 / ADR-0038). Idempotent (booted flag).
// Lives at module top so it runs once before any Orval-generated client
// function is invoked.
setupAxios();

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

  // GET /me — disabled until authenticated; on success it rehydrates
  // displayName / accountId / phone into the store (see use-me.ts). `isFetched`
  // flips true once the query settles (success OR error, never deadlocks), and
  // gates the AuthGate decision: a returning user whose LoginResponse omits
  // displayName (byte-level anti-enumeration, phone-sms-auth.response.ts) is
  // held on a splash until /me lands instead of flashing /(app)/onboarding.
  const profile = useMe();
  const profileLoaded = profile.isFetched;

  // Route on the freshly-fetched /me displayName, NOT the store value alone:
  // useMe syncs displayName into the store via a useEffect that commits one frame
  // AFTER /me settles, so on the settle frame the store is still null while
  // profile.data already has the name. Reading the store alone misroutes a
  // returning user to onboarding for a frame (then races expo-router's bounce).
  // resolveDisplayName closes that gap (see auth-gate-decision.ts).
  const effectiveDisplayName = resolveDisplayName(displayName, profile.data?.displayName);

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

  const decision = decideAuthRoute({
    isAuthenticated,
    displayName: effectiveDisplayName,
    profileLoaded,
    inAuthGroup: segments[0] === '(auth)',
    inOnboarding: segments.includes('onboarding'),
    inAppGroup: segments[0] === '(app)',
  });
  const redirectTarget = decision.kind === 'replace' ? decision.target : null;

  useEffect(() => {
    if (!navReady || !hasHydrated) return;
    if (redirectTarget) {
      router.replace(redirectTarget as Parameters<typeof router.replace>[0]);
    }
  }, [navReady, hasHydrated, redirectTarget, router]);

  // `wait` = authenticated but displayName still null while /me is in flight —
  // hold the splash rather than let `children` paint onboarding for a frame.
  if (!hasHydrated) return <SplashPlaceholder />;
  if (decision.kind === 'wait') return <SplashPlaceholder />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <AuthGate>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthGate>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

// Token-refresh infrastructure for @nvy/auth.
//
// Single-flights concurrent refresh calls to prevent thundering-herd when
// multiple API calls return 401 simultaneously. On failure the session is
// cleared so AuthGate surfaces the login screen.
//
// The actual POST /api/v1/accounts/refresh-token call is stubbed until the
// server endpoint ships (US12 roadmap). All callers should use refreshOnce()
// rather than refreshTokenFlow() directly.

import { useAuthStore } from './store.js';

let inflightRefresh: Promise<void> | null = null;

// Attempts to exchange the persisted refresh token for a new access token.
// On success, updates the store with the new session. On any failure (or when
// no refresh token exists), clears the session and throws SESSION_EXPIRED.
export async function refreshTokenFlow(): Promise<void> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) {
    useAuthStore.getState().clearSession();
    throw new Error('SESSION_EXPIRED');
  }
  // TODO(US12): POST /api/v1/accounts/refresh-token { refreshToken }
  // On success: useAuthStore.getState().setSession({ accountId, accessToken, refreshToken })
  // For now fall through to clearSession so AuthGate redirects to login.
  useAuthStore.getState().clearSession();
  throw new Error('SESSION_EXPIRED');
}

// Returns a shared in-flight refresh promise so concurrent 401 handlers
// share one refresh round rather than triggering multiple.
export function refreshOnce(): Promise<void> {
  if (inflightRefresh !== null) {
    return inflightRefresh;
  }
  inflightRefresh = refreshTokenFlow().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

// Silently rehydrates the session on cold start (US12: rehydrate 不抖).
// Call from AuthGate after persist hydration completes. If the persisted
// refresh token is valid the access token is refreshed silently; if it's
// expired or missing the session is cleared. Resolves without throwing.
export async function rehydrateSession(): Promise<void> {
  const { refreshToken, accessToken } = useAuthStore.getState();
  if (!refreshToken || accessToken) {
    return;
  }
  await refreshOnce().catch(() => {
    // clearSession already called inside refreshTokenFlow; eat the error.
  });
}

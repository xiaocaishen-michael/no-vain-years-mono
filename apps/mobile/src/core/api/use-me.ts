/**
 * useMe — React Query hook for the authenticated account profile.
 *
 * Replaces the legacy `useAuthStore.loadProfile()` imperative method
 * (deleted in PR-5c per ADR-0027 — store no longer owns remote data
 * fetching).
 *
 * Behavior:
 *   - Disabled until isAuthenticated (avoids 401-storm pre-login)
 *   - On success syncs accountId / displayName / phone back into
 *     useAuthStore so AuthGate's persist-driven cold-start path
 *     (apps/mobile/src/core/auth-gate-decision.ts) still works without
 *     a network round-trip
 *   - Errors surface to React Query consumer (handled via the
 *     formatErrorMessage / extractProblemDetail chain in ./errors.ts)
 *
 * Usage in component:
 *   const { data: profile, isLoading, error } = useMe();
 *   if (error) return <Text>{formatErrorMessage(error)}</Text>;
 *   ...
 */
import { useEffect } from 'react';
import {
  useAccountProfileControllerGetProfile,
  type AccountProfileResponse,
} from '@nvy/api-client';
import { useAuthStore } from '~/auth';

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);

  const query = useAccountProfileControllerGetProfile<AccountProfileResponse>({
    query: {
      // Gate on accessToken, not just isAuthenticated: on a cold start / browser
      // reload the persisted refreshToken flips isAuthenticated true (store.ts
      // onRehydrateStorage) while accessToken is still null (in-memory only).
      // Firing /me here would 401 until the response interceptor补刷 — instead we
      // wait for AuthGate's rehydrateSession() to exchange the refresh token, then
      // /me fires with a Bearer and never 401s. Fresh login sets both atomically,
      // so it's unaffected. The 401 interceptor stays as the runtime-expiry net.
      enabled: isAuthenticated && !!accessToken,
      // axios mutator (PR-5c setupAxios) attaches Authorization Bearer
      // from useAuthStore.accessToken — no per-call header inject needed.
      select: (response) => response.data,
    },
  });

  useEffect(() => {
    if (query.data) {
      // sync zustand persist layer so AuthGate has displayName ready (drives
      // the route decision in apps/mobile/src/core/auth-gate-decision.ts)
      useAuthStore.setState({
        accountId: query.data.accountId,
        displayName: query.data.displayName,
        phone: query.data.phone,
      });
    }
  }, [query.data]);

  return query;
}

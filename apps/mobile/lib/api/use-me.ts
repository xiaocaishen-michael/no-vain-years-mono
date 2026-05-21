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
 *     (apps/mobile/lib/auth-gate-decision.ts) still works without
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
import { useAuthStore } from '@nvy/auth';

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setDisplayName = useAuthStore((s) => s.setDisplayName);

  const query = useAccountProfileControllerGetProfile<AccountProfileResponse>({
    query: {
      enabled: isAuthenticated,
      // axios mutator (PR-5c setupAxios) attaches Authorization Bearer
      // from useAuthStore.accessToken — no per-call header inject needed.
      select: (response) => response.data,
    },
  });

  useEffect(() => {
    if (query.data) {
      // sync zustand persist layer so AuthGate cold-start has data ready
      useAuthStore.setState({
        accountId: query.data.accountId,
        displayName: query.data.displayName,
        phone: query.data.phone,
      });
      // setDisplayName intentionally referenced to keep the selector
      // subscribed (devtools introspection); state.setState above also
      // calls into the store
      void setDisplayName;
    }
  }, [query.data, setDisplayName]);

  return query;
}

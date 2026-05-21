/**
 * Mobile-side axios setup (per ADR-0027 + ADR-0036 + ADR-0038).
 *
 * Registers global axios interceptors on the default instance used by
 * Orval-generated client functions (packages/api-client):
 *
 *   request:
 *     - baseURL from EXPO_PUBLIC_API_BASE_URL (else dev default)
 *     - x-trace-id auto-generated via expo-crypto.randomUUID() if not set
 *       → ties client log line + server CLS trace + ProblemDetail body
 *         .traceId per ADR-0036 cross-stack trace propagation
 *     - Authorization Bearer from useAuthStore.accessToken when present
 *       → consolidates the per-call manual header injection that
 *         packages/auth/src/store.ts.loadProfile used to do
 *
 *   response:
 *     - no-op (errors flow back to React Query / useMutation via
 *       AxiosError; type guards in ./errors.ts narrow ProblemDetail shape)
 *
 * Call setupAxios() once at mobile boot (apps/mobile/app/_layout.tsx top
 * import). Subsequent imports are no-ops via the booted flag.
 */
import axios from 'axios';
import * as Crypto from 'expo-crypto';
import { useAuthStore } from '@nvy/auth';

let booted = false;

export function setupAxios(): void {
  if (booted) return;
  booted = true;

  const baseURL =
    process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';
  axios.defaults.baseURL = baseURL;

  axios.interceptors.request.use((config) => {
    // x-trace-id: only set if caller didn't supply one (cross-service
    // propagation case — e.g. test runner injecting deterministic id)
    config.headers = config.headers ?? {};
    if (!config.headers['x-trace-id']) {
      config.headers['x-trace-id'] = Crypto.randomUUID();
    }

    // Authorization: read from auth store; only set if not already on call
    // (allows explicit override for refresh-token flow, smoke tests, etc.)
    if (!config.headers['Authorization']) {
      const accessToken = useAuthStore.getState().accessToken;
      if (accessToken) {
        config.headers['Authorization'] = `Bearer ${accessToken}`;
      }
    }

    return config;
  });
}

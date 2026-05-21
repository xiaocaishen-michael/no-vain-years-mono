// Public surface for the auth module (apps/mobile/src/auth/). T031 introduced
// store + token-refresh modules; T034 (AuthGate root layout) is the first
// consumer and lifts these names into the module facade.

export { useAuthStore } from './store';
export type { AuthState, Session } from './store';

export { refreshOnce, refreshTokenFlow, rehydrateSession } from './token-refresh';

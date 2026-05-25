// Full-device logout wrapper for the auth module (003-tokens US8 client).
//
// Calls the server logout-all endpoint, then UNCONDITIONALLY clears the local
// session in `finally` — even if the server call fails the user is logged out
// locally (residual server-side records self-expire). Server failure must not
// block the logout (FR-C05). AuthGate observes isAuthenticated and routes to
// login; this wrapper does not navigate.
//
// No user-visible logout button ships here — that lands with the settings
// shell (separate spec). This is the logic the button will call.

import { accountTokenControllerLogoutAll } from '@nvy/api-client';

import { useAuthStore } from './store';

export async function logoutAll(): Promise<void> {
  try {
    await accountTokenControllerLogoutAll();
  } catch {
    // Swallow: a failed server call must not block local logout. The local
    // session is cleared in `finally` regardless; orphaned server records
    // expire on their own.
  } finally {
    useAuthStore.getState().clearSession();
  }
}

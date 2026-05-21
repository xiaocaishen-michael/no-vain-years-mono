import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from './store';

// expo-secure-store is pulled in transitively via store.ts; mock it here so
// the store module initialises cleanly in a Node environment.
// (@nvy/api-client mock removed in PR-5c — store.ts no longer imports it.)
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

import { useAuthStore } from './store';
import { rehydrateSession, refreshOnce, refreshTokenFlow } from './token-refresh';

const CLEAN: Partial<AuthState> = {
  accountId: null,
  accessToken: null,
  refreshToken: null,
  displayName: null,
  phone: null,
  isAuthenticated: false,
};

beforeEach(() => {
  useAuthStore.setState(CLEAN);
});

describe('refreshTokenFlow', () => {
  it('clears session and throws SESSION_EXPIRED when no refreshToken', async () => {
    useAuthStore.setState({ accountId: 'acc-1', isAuthenticated: true });
    await expect(refreshTokenFlow()).rejects.toThrow('SESSION_EXPIRED');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accountId).toBeNull();
  });

  it('clears session and throws SESSION_EXPIRED for PoC stub (refreshToken present)', async () => {
    // Current implementation is a PoC stub: even with a valid refreshToken
    // it clears the session and throws until the real endpoint ships (US12).
    useAuthStore.setState({ refreshToken: 'rt', accountId: 'acc-1', isAuthenticated: true });
    await expect(refreshTokenFlow()).rejects.toThrow('SESSION_EXPIRED');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });
});

describe('refreshOnce — single-flight deduplication', () => {
  it('concurrent calls return the same in-flight Promise', async () => {
    useAuthStore.setState({ refreshToken: 'rt' });
    const p1 = refreshOnce();
    const p2 = refreshOnce();
    expect(p1).toBe(p2);
    // Settle both so the module-level inflightRefresh is reset before next test.
    await Promise.allSettled([p1, p2]);
  });

  it('after settling, a subsequent call produces a new Promise', async () => {
    useAuthStore.setState({ refreshToken: 'rt' });
    const p1 = refreshOnce();
    await p1.catch(() => undefined); // inflightRefresh → null via finally
    const p2 = refreshOnce();
    expect(p2).not.toBe(p1);
    await p2.catch(() => undefined);
  });

  it('rejects with SESSION_EXPIRED (PoC stub behaviour)', async () => {
    useAuthStore.setState({ refreshToken: 'rt' });
    await expect(refreshOnce()).rejects.toThrow('SESSION_EXPIRED');
  });
});

describe('rehydrateSession (US12 — rehydrate 不抖)', () => {
  it('resolves immediately when no refreshToken is stored', async () => {
    // No-op: nothing to refresh.
    await expect(rehydrateSession()).resolves.toBeUndefined();
  });

  it('resolves immediately when an accessToken is already in-memory', async () => {
    // Token still valid from a previous session; skip the refresh round-trip.
    useAuthStore.setState({ refreshToken: 'rt', accessToken: 'still-valid-at' });
    await expect(rehydrateSession()).resolves.toBeUndefined();
  });

  it('calls refreshOnce and swallows rejection when refreshToken present but no accessToken', async () => {
    useAuthStore.setState({ refreshToken: 'rt', accessToken: null });
    // Must resolve (not throw) even though the PoC stub always rejects (US12 guarantee).
    await expect(rehydrateSession()).resolves.toBeUndefined();
    // refreshTokenFlow inside refreshOnce clears the session on failure.
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('never propagates a rejection (AuthGate must not crash on cold start)', async () => {
    useAuthStore.setState({ refreshToken: 'stale-rt' });
    await expect(rehydrateSession()).resolves.toBeUndefined();
  });
});

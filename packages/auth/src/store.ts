// Zustand v5 auth store with expo-secure-store persistence.
//
// Persist policy:
//   accountId / refreshToken / displayName / phone → SecureStore (Keychain/Keystore on
//   native, localStorage on web). Survives app restarts.
//   accessToken → in-memory only. Re-derived via refreshTokenFlow on cold start.
//
// displayName is persisted to avoid AuthGate flicker on rehydrate (US12).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { accountProfileControllerGetProfile } from '@nvy/api-client';

// Platform-aware secure storage: native → Keychain/Keystore, web → localStorage fallback.
const secureStorage: StateStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export interface Session {
  accountId: string;
  accessToken: string;
  refreshToken: string;
}

export interface AuthState {
  accountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  displayName: string | null;
  phone: string | null;
  isAuthenticated: boolean;
  setSession: (session: Session) => void;
  setAccessToken: (token: string) => void;
  setDisplayName: (name: string | null) => void;
  clearSession: () => void;
  loadProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accountId: null,
      accessToken: null,
      refreshToken: null,
      displayName: null,
      phone: null,
      isAuthenticated: false,

      setSession: ({ accountId, accessToken, refreshToken }) =>
        set({ accountId, accessToken, refreshToken, isAuthenticated: true }),

      setAccessToken: (token) => set({ accessToken: token }),

      setDisplayName: (name) => set({ displayName: name }),

      clearSession: () =>
        set({
          accountId: null,
          accessToken: null,
          refreshToken: null,
          displayName: null,
          phone: null,
          isAuthenticated: false,
        }),

      loadProfile: async () => {
        const { accessToken } = get();
        if (!accessToken) throw new Error('SESSION_EXPIRED');
        const { data } = await accountProfileControllerGetProfile({
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!data) throw new Error('PROFILE_LOAD_FAILED');
        set({ accountId: data.accountId, displayName: data.displayName, phone: data.phone });
      },
    }),
    {
      name: 'nvy-auth',
      storage: createJSONStorage(() => secureStorage),
      // accessToken intentionally omitted — refreshed on cold start (US12).
      partialize: (state) => ({
        accountId: state.accountId,
        refreshToken: state.refreshToken,
        displayName: state.displayName,
        phone: state.phone,
      }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (rehydratedState?.refreshToken && rehydratedState.accountId !== null) {
          useAuthStore.setState({ isAuthenticated: true });
        }
      },
    },
  ),
);

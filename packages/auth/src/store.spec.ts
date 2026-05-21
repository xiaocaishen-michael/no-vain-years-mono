import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from './store';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@nvy/api-client', () => ({
  accountProfileControllerGetProfile: vi.fn(),
}));

import { accountProfileControllerGetProfile } from '@nvy/api-client';
import { useAuthStore } from './store';

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
  vi.clearAllMocks();
});

describe('initial state', () => {
  it('all data fields are null and isAuthenticated is false', () => {
    const s = useAuthStore.getState();
    expect(s.accountId).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.displayName).toBeNull();
    expect(s.phone).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });
});

describe('setSession', () => {
  const session = { accountId: 'acc-1', accessToken: 'at', refreshToken: 'rt' };

  it('sets accountId, accessToken, refreshToken and isAuthenticated=true', () => {
    useAuthStore.getState().setSession(session);
    const s = useAuthStore.getState();
    expect(s.accountId).toBe('acc-1');
    expect(s.accessToken).toBe('at');
    expect(s.refreshToken).toBe('rt');
    expect(s.isAuthenticated).toBe(true);
  });

  it('does not overwrite pre-existing displayName or phone', () => {
    useAuthStore.setState({ displayName: 'Alice', phone: '+8613800138001' });
    useAuthStore.getState().setSession(session);
    const s = useAuthStore.getState();
    expect(s.displayName).toBe('Alice');
    expect(s.phone).toBe('+8613800138001');
  });
});

describe('setAccessToken', () => {
  it('replaces only accessToken, other fields untouched', () => {
    useAuthStore.setState({ accountId: 'acc-1', isAuthenticated: true, refreshToken: 'rt' });
    useAuthStore.getState().setAccessToken('new-at');
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('new-at');
    expect(s.accountId).toBe('acc-1');
    expect(s.isAuthenticated).toBe(true);
    expect(s.refreshToken).toBe('rt');
  });
});

describe('setDisplayName', () => {
  it('sets displayName to a string value', () => {
    useAuthStore.getState().setDisplayName('Bob');
    expect(useAuthStore.getState().displayName).toBe('Bob');
  });

  it('accepts null to clear displayName', () => {
    useAuthStore.setState({ displayName: 'Bob' });
    useAuthStore.getState().setDisplayName(null);
    expect(useAuthStore.getState().displayName).toBeNull();
  });
});

describe('clearSession', () => {
  it('resets all fields to null/false after a full session', () => {
    useAuthStore.setState({
      accountId: 'acc-1',
      accessToken: 'at',
      refreshToken: 'rt',
      displayName: 'Alice',
      phone: '+8613800138001',
      isAuthenticated: true,
    });
    useAuthStore.getState().clearSession();
    const s = useAuthStore.getState();
    expect(s.accountId).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.displayName).toBeNull();
    expect(s.phone).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });
});

describe('loadProfile', () => {
  it('throws SESSION_EXPIRED when accessToken is null', async () => {
    await expect(useAuthStore.getState().loadProfile()).rejects.toThrow('SESSION_EXPIRED');
  });

  it('throws PROFILE_LOAD_FAILED when API returns no data', async () => {
    useAuthStore.setState({ accessToken: 'valid-at' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(accountProfileControllerGetProfile).mockResolvedValue({ data: undefined } as any);
    await expect(useAuthStore.getState().loadProfile()).rejects.toThrow('PROFILE_LOAD_FAILED');
  });

  it('updates accountId, displayName and phone on success', async () => {
    useAuthStore.setState({ accessToken: 'valid-at' });
    vi.mocked(accountProfileControllerGetProfile).mockResolvedValue({
      data: {
        accountId: 'acc-42',
        displayName: 'Alice',
        phone: '+8613800138001',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await useAuthStore.getState().loadProfile();
    const s = useAuthStore.getState();
    expect(s.accountId).toBe('acc-42');
    expect(s.displayName).toBe('Alice');
    expect(s.phone).toBe('+8613800138001');
  });

  it('preserves null displayName for new users (FR-007)', async () => {
    useAuthStore.setState({ accessToken: 'valid-at' });
    vi.mocked(accountProfileControllerGetProfile).mockResolvedValue({
      data: {
        accountId: 'acc-1',
        displayName: null,
        phone: '+8613800138001',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await useAuthStore.getState().loadProfile();
    expect(useAuthStore.getState().displayName).toBeNull();
  });

  it('passes Bearer accessToken in Authorization header', async () => {
    useAuthStore.setState({ accessToken: 'tok-abc' });
    vi.mocked(accountProfileControllerGetProfile).mockResolvedValue({
      data: {
        accountId: 'acc-1',
        displayName: null,
        phone: '+8613800138001',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await useAuthStore.getState().loadProfile();
    expect(accountProfileControllerGetProfile).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-abc' } }),
    );
  });
});

describe('persist partialize — accessToken is NOT persisted', () => {
  it('persisted slice excludes accessToken and isAuthenticated', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { partialize } = (useAuthStore as any).persist.getOptions() as {
      partialize: (s: Record<string, unknown>) => Record<string, unknown>;
    };
    const persisted = partialize({
      accountId: 'acc-1',
      accessToken: 'secret-must-not-persist',
      refreshToken: 'rt',
      displayName: 'Alice',
      phone: '+8613800138001',
      isAuthenticated: true,
    });
    expect(persisted).not.toHaveProperty('accessToken');
    expect(persisted).not.toHaveProperty('isAuthenticated');
    expect(persisted).toEqual({
      accountId: 'acc-1',
      refreshToken: 'rt',
      displayName: 'Alice',
      phone: '+8613800138001',
    });
  });
});

describe('onRehydrateStorage — isAuthenticated inference', () => {
  it('marks isAuthenticated=true when refreshToken + non-null accountId are present', () => {
    useAuthStore.setState(CLEAN);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { onRehydrateStorage } = (useAuthStore as any).persist.getOptions() as {
      onRehydrateStorage: () => (s: Record<string, unknown>) => void;
    };
    const afterHydrate = onRehydrateStorage();
    afterHydrate({ accountId: 'acc-1', refreshToken: 'rt', displayName: null, phone: null });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('leaves isAuthenticated=false when refreshToken is absent', () => {
    useAuthStore.setState(CLEAN);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { onRehydrateStorage } = (useAuthStore as any).persist.getOptions() as {
      onRehydrateStorage: () => (s: Record<string, unknown>) => void;
    };
    const afterHydrate = onRehydrateStorage();
    afterHydrate({ accountId: 'acc-1', refreshToken: null, displayName: null, phone: null });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('leaves isAuthenticated=false when accountId is null', () => {
    useAuthStore.setState(CLEAN);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { onRehydrateStorage } = (useAuthStore as any).persist.getOptions() as {
      onRehydrateStorage: () => (s: Record<string, unknown>) => void;
    };
    const afterHydrate = onRehydrateStorage();
    afterHydrate({ accountId: null, refreshToken: 'rt', displayName: null, phone: null });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

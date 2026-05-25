// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unit = the wrapper's wiring (onSuccess → setDisplayName with the new value).
// Both deps mocked: the Orval hook so we capture+drive its onSuccess, and ./store
// so the real expo-secure-store chain never loads under happy-dom. Store behaviour
// is store.spec.ts; real react-query/network is the e2e layer (T046).
const h = vi.hoisted(() => ({
  onSuccess: undefined as ((res: { data: unknown }) => void) | undefined,
  setDisplayName: vi.fn(),
}));

vi.mock('@nvy/api-client', () => ({
  useAccountProfileControllerUpdateDisplayName: vi.fn(
    (opts?: { mutation?: { onSuccess?: (res: { data: unknown }) => void } }) => {
      h.onSuccess = opts?.mutation?.onSuccess;
      return { mutateAsync: vi.fn(), isPending: false, error: null };
    },
  ),
}));

vi.mock('./store', () => ({
  useAuthStore: (selector: (s: { setDisplayName: unknown }) => unknown) =>
    selector({ setDisplayName: h.setDisplayName }),
}));

import { useUpdateDisplayName } from './update-display-name';

describe('useUpdateDisplayName', () => {
  beforeEach(() => {
    h.onSuccess = undefined;
    h.setDisplayName.mockClear();
  });

  it('wires mutation onSuccess to setDisplayName with the new value', () => {
    renderHook(() => useUpdateDisplayName());
    expect(h.onSuccess).toBeTypeOf('function');

    h.onSuccess?.({
      data: { accountId: '42', phone: '+8613800138000', displayName: '小明', status: 'ACTIVE' },
    });

    expect(h.setDisplayName).toHaveBeenCalledWith('小明');
  });

  it('does not navigate (AuthGate owns the redirect)', () => {
    // The wrapper exposes only the mutation object; it pulls no router. This is a
    // structural guarantee — onSuccess touches the store, nothing else.
    const { result } = renderHook(() => useUpdateDisplayName());
    expect(result.current).toHaveProperty('mutateAsync');
    expect(result.current).not.toHaveProperty('replace');
  });
});

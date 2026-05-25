// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the two mutation hooks so (a) we drive their mutateAsync and (b) the real
// chains never load (api-client → axios; phone-sms-auth → ./store → expo-secure-
// store → Flow react-native under happy-dom). RHF + zodResolver + zod are
// platform-agnostic (no RN), so they run real. Error paths are T063; this is the
// happy-path core (state machine + countdown + side-effect layering).
const h = vi.hoisted(() => ({
  smsMutateAsync: vi.fn(),
  authMutateAsync: vi.fn(),
}));

vi.mock('@nvy/api-client', () => ({
  useAccountSmsCodeControllerRequest: vi.fn(() => ({
    mutateAsync: h.smsMutateAsync,
    isPending: false,
  })),
}));
vi.mock('./phone-sms-auth', () => ({
  usePhoneSmsAuth: vi.fn(() => ({ mutateAsync: h.authMutateAsync, isPending: false })),
}));

import { useLoginForm } from './use-login-form';

const validPhone = '+8613800138000';
const validCode = '123456';

describe('useLoginForm (core)', () => {
  beforeEach(() => {
    h.smsMutateAsync.mockReset().mockResolvedValue({ data: {} });
    h.authMutateAsync
      .mockReset()
      .mockResolvedValue({ data: { accountId: '1', accessToken: 'a', refreshToken: 'r' } });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle with no countdown', () => {
    const { result } = renderHook(() => useLoginForm());
    expect(result.current.state).toBe('idle');
    expect(result.current.smsCountdown).toBe(0);
  });

  it('requestSms sends the code (phone only), moves to sms_sent, starts 60s countdown', async () => {
    const { result } = renderHook(() => useLoginForm());
    act(() => result.current.form.setValue('phone', validPhone));
    await act(async () => {
      await result.current.requestSms();
    });
    expect(h.smsMutateAsync).toHaveBeenCalledWith({ data: { phone: validPhone } });
    expect(result.current.state).toBe('sms_sent');
    expect(result.current.smsCountdown).toBe(60);
  });

  it('counts the SMS cooldown down each second', async () => {
    const { result } = renderHook(() => useLoginForm());
    act(() => result.current.form.setValue('phone', validPhone));
    await act(async () => {
      await result.current.requestSms();
    });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.smsCountdown).toBe(57);
  });

  it('guards requestSms while the countdown is still ticking', async () => {
    const { result } = renderHook(() => useLoginForm());
    act(() => result.current.form.setValue('phone', validPhone));
    await act(async () => {
      await result.current.requestSms();
    });
    await act(async () => {
      await result.current.requestSms();
    });
    expect(h.smsMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('submit authenticates with {phone, code} and moves to success', async () => {
    const { result } = renderHook(() => useLoginForm());
    act(() => {
      result.current.form.setValue('phone', validPhone);
      result.current.form.setValue('code', validCode);
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(h.authMutateAsync).toHaveBeenCalledWith({
      data: { phone: validPhone, code: validCode },
    });
    expect(result.current.state).toBe('success');
  });
});

import { useAccountSmsCodeControllerRequest } from '@nvy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { phoneSmsAuthSchema, type PhoneSmsAuthValues } from './login-form.schema';
import { usePhoneSmsAuth } from './phone-sms-auth';

// FR-C11 state machine. requesting_sms / submitting are *derived* from pending
// flags (not setState'd) so loading has a single source (铁律 3); idle / sms_sent
// / success / error are persistent latches. error is wired in T063.
export type LoginFormState =
  | 'idle'
  | 'requesting_sms'
  | 'sms_sent'
  | 'submitting'
  | 'success'
  | 'error';

const SMS_COUNTDOWN_SECONDS = 60;

const TOAST = {
  invalid: '手机号或验证码错误',
  rateLimit: '请求过于频繁，请稍后再试',
  network: '网络异常，请检查网络后重试',
  unknown: '登录失败，请稍后再试',
} as const;

// FR-C06 错误映射。AxiosError 判别走 duck-type（`isAxiosError` flag），避免给 apps/mobile
// 加 axios 直接依赖（axios 是 @nvy/api-client 的依赖）。401/400 → 凭证错（不区分 401 子码，
// 反枚举一致）；429 → 限流；无 response（网络/超时）或 5xx → 网络；其余 → 未知。
export function loginErrorToast(error: unknown): string {
  const e = error as { isAxiosError?: boolean; response?: { status?: number } };
  if (e?.isAxiosError) {
    const status = e.response?.status;
    if (status === undefined) return TOAST.network;
    if (status === 401 || status === 400) return TOAST.invalid;
    if (status === 429) return TOAST.rateLimit;
    if (status >= 500) return TOAST.network;
    return TOAST.unknown;
  }
  return TOAST.unknown;
}

export type ErrorScope = 'sms' | 'submit' | null;

export function useLoginForm() {
  const form = useForm<PhoneSmsAuthValues>({
    resolver: zodResolver(phoneSmsAuthSchema),
    mode: 'onChange',
    defaultValues: { phone: '', code: '' },
  });

  // 铁律 2 — side-effect state lives OUTSIDE RHF: the SMS-code request mutation
  // + the 60s cooldown timer are not part of the form submit lifecycle.
  const smsRequest = useAccountSmsCodeControllerRequest();
  const auth = usePhoneSmsAuth();

  const [phase, setPhase] = useState<'idle' | 'sms_sent' | 'success' | 'error'>('idle');
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<ErrorScope>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const startCountdown = useCallback(() => {
    setSmsCountdown(SMS_COUNTDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSmsCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const requestSms = useCallback(async () => {
    if (smsCountdown > 0) return; // button is disabled while ticking; guards races
    setErrorToast(null);
    setErrorScope(null);
    try {
      const phone = form.getValues('phone');
      await smsRequest.mutateAsync({ data: { phone } });
      startCountdown();
      setPhase('sms_sent');
    } catch (e) {
      setErrorToast(loginErrorToast(e));
      setErrorScope('sms');
      setPhase('error');
    }
  }, [smsCountdown, form, smsRequest, startCountdown]);

  // 铁律 1 — caller wraps inputs in <Controller>; submit goes through handleSubmit
  // so formState.isSubmitting is the single loading source (铁律 3).
  const submit = form.handleSubmit(async (values) => {
    setErrorToast(null);
    setErrorScope(null);
    try {
      await auth.mutateAsync({ data: { phone: values.phone, code: values.code } });
      setPhase('success');
    } catch (e) {
      setErrorToast(loginErrorToast(e));
      setErrorScope('submit');
      setPhase('error');
    }
  });

  // error → idle on explicit clear / any input change (FR-C12 / FR-C15).
  const clearError = useCallback(() => {
    setErrorToast(null);
    setErrorScope(null);
    setPhase((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const { isSubmitting } = form.formState;
  const state: LoginFormState = isSubmitting
    ? 'submitting'
    : smsRequest.isPending
      ? 'requesting_sms'
      : phase;

  return {
    form,
    state,
    smsCountdown,
    errorToast,
    errorScope,
    requestSms,
    submit,
    clearError,
    isSubmitting,
  };
}

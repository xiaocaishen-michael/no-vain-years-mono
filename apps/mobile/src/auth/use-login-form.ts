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

  const [phase, setPhase] = useState<'idle' | 'sms_sent' | 'success'>('idle');
  const [smsCountdown, setSmsCountdown] = useState(0);
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
    const phone = form.getValues('phone');
    await smsRequest.mutateAsync({ data: { phone } });
    startCountdown();
    setPhase('sms_sent');
  }, [smsCountdown, form, smsRequest, startCountdown]);

  // 铁律 1 — caller wraps inputs in <Controller>; submit goes through handleSubmit
  // so formState.isSubmitting is the single loading source (铁律 3).
  const submit = form.handleSubmit(async (values) => {
    await auth.mutateAsync({ data: { phone: values.phone, code: values.code } });
    setPhase('success');
  });

  const { isSubmitting } = form.formState;
  const state: LoginFormState = isSubmitting
    ? 'submitting'
    : smsRequest.isPending
      ? 'requesting_sms'
      : phase;

  return { form, state, smsCountdown, requestSms, submit, isSubmitting };
}

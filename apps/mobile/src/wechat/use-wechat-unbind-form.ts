import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  useWechatBindingControllerSendUnbindCodeForMe,
  useWechatBindingControllerUnbindWechatForMe,
} from '@nvy/api-client';

import { useAuthStore } from '~/auth';
import { meQueryKey } from '~/core/api/me-query-key';
import { wechatUnbindFormSchema, type WechatUnbindFormValues } from './wechat-unbind-form.schema';
import { wechatUnbindErrorToast } from './wechat-errors';

// 微信解绑表单 (010 FR-C, RHF 镜像 useDeleteAccountForm 但**去双勾选**(解绑无注销
// 那种不可逆确认) + **去 success-clearSession**(解绑保留 session, 仅刷新 /me))。
// requesting_sms / submitting = pending 派生 (铁律 3 单源); idle/sms_sent/success/
// error 持久 latch。仅 6 位码进 RHF (铁律 2)。
export type WechatUnbindFormState =
  | 'idle'
  | 'requesting_sms'
  | 'sms_sent'
  | 'submitting'
  | 'success'
  | 'error';

const SMS_COUNTDOWN_SECONDS = 60;

export function useWechatUnbindForm() {
  const form = useForm<WechatUnbindFormValues>({
    resolver: zodResolver(wechatUnbindFormSchema),
    mode: 'onChange',
    defaultValues: { code: '' },
  });

  const smsRequest = useWechatBindingControllerSendUnbindCodeForMe();
  const unbind = useWechatBindingControllerUnbindWechatForMe();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<'idle' | 'sms_sent' | 'success' | 'error'>('idle');
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [hasSentCode, setHasSentCode] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
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

  // 发码 (EP2, 无 body, server 由 bearer 取账号)。仅 cooldown 门槛 (无双勾选)。
  const requestSms = useCallback(async () => {
    if (smsCountdown > 0 || smsRequest.isPending) return;
    setErrorToast(null);
    try {
      await smsRequest.mutateAsync();
      setHasSentCode(true);
      startCountdown();
      setPhase('sms_sent');
    } catch (e) {
      setErrorToast(wechatUnbindErrorToast(e));
      setPhase('error');
    }
  }, [smsCountdown, smsRequest, startCountdown]);

  // 铁律 1 — caller 用 <Controller> 包 code input; submit 走 handleSubmit 使
  // formState.isSubmitting 为唯一 loading 源 (铁律 3)。成功**不** clearSession ——
  // 解绑保留登录态, 仅 invalidate /me (wechatBound 刷新); 屏驱动 router.back()。
  const submit = form.handleSubmit(async ({ code }) => {
    setErrorToast(null);
    try {
      await unbind.mutateAsync({ data: { code } });
      await queryClient.invalidateQueries({
        queryKey: meQueryKey(useAuthStore.getState().accountId),
      });
      setPhase('success');
    } catch (e) {
      setErrorToast(wechatUnbindErrorToast(e));
      setPhase('error');
    }
  });

  // error → 回 sms_sent (码已发, input 留活) 或 idle; 清 toast。
  const clearError = useCallback(() => {
    setErrorToast(null);
    setPhase((prev) => (prev === 'error' ? (hasSentCode ? 'sms_sent' : 'idle') : prev));
  }, [hasSentCode]);

  const { isSubmitting } = form.formState;
  const state: WechatUnbindFormState = isSubmitting
    ? 'submitting'
    : smsRequest.isPending
      ? 'requesting_sms'
      : phase;

  const canSendCode = smsCountdown === 0 && state !== 'requesting_sms' && state !== 'submitting';

  return {
    form,
    state,
    canSendCode,
    hasSentCode,
    smsCountdown,
    errorToast,
    requestSms,
    submit,
    clearError,
    isSubmitting,
  };
}

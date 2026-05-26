// Login screen — ported from the legacy app (Strangler-Fig), RHF Golden Sample.
// State machine: idle → requesting_sms → sms_sent → submitting → success | error.
// T064 (skin): layout + <Controller>-wrapped inputs + close × + submit/send wiring.
// T065 (wiring): errorScope red borders + ErrorRow + clear-on-change + success
// overlay (AuthGate redirects). OAuth / help / freeze are deferred (account-migration p3).
import { useRouter } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Pressable, Text, View } from 'react-native';

import { cancelDeletionPath, PHONE_REGEX, remainingFreezeDays, useLoginForm } from '~/auth';
import {
  Button,
  ErrorRow,
  LogoMark,
  PhoneInput,
  SafeAreaView,
  SmsInput,
  Spinner,
  SuccessCheck,
} from '~/ui';

// FR-C11 success terminal — scale-in check + spinner while AuthGate redirects.
// The hook does NOT clearSession on success, so this frame paints stably before
// the redirect (per memory feedback_visual_smoke_unreachable_when_finally_clears_session).
function SuccessOverlay() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View className="flex-1 bg-surface px-lg pb-lg">
        <View className="flex-row items-center h-11 px-1" />
        <View className="flex-1 items-center justify-center gap-4 pb-20">
          <SuccessCheck />
          <Text className="text-xl font-semibold text-ink mt-2">登录成功</Text>
          <View className="flex-row items-center gap-2">
            <Spinner size={12} tone="muted" />
            <Text className="text-sm text-ink-muted">正在进入今日时间线…</Text>
          </View>
        </View>
        {/* Next screen peeking from the bottom */}
        <View className="absolute left-4 right-4 bottom-2 h-24 rounded-2xl bg-surface-alt p-3.5 opacity-60">
          <View className="h-2.5 w-1/3 rounded-sm bg-line mb-2.5" />
          <View className="h-2.5 w-3/4 rounded-sm bg-line mb-2.5" />
          <View className="h-2.5 w-1/2 rounded-sm bg-line" />
        </View>
      </View>
    </SafeAreaView>
  );
}

// FR-C03 拦截 modal — login 撞 FROZEN 账号时覆盖在表单上。撤销 → 跳撤销屏（手机号
// 路由参数预填）；保持 → dismissFreeze 清 form 留登录页。scrim + 卡片走 theme 令牌
// (bg-modal-overlay / shadow-modal)。
function FreezeModal({
  remainingDays,
  onCancel,
  onKeep,
}: {
  remainingDays: number;
  onCancel: () => void;
  onKeep: () => void;
}) {
  return (
    <View className="absolute inset-0 items-center justify-center bg-modal-overlay px-lg">
      <View className="w-full rounded-2xl bg-surface p-lg gap-3 shadow-modal">
        <Text className="text-xl font-semibold text-ink text-center">账号注销冷静期</Text>
        <Text className="text-sm text-ink-muted text-center">
          这个账号正在注销冷静期，还有 {remainingDays} 天将永久注销。撤销注销即可立即恢复使用。
        </Text>
        <View className="mt-2 gap-2.5">
          <Button label="撤销注销" onPress={onCancel} />
          <Pressable
            onPress={onKeep}
            accessibilityRole="button"
            accessibilityLabel="保持注销"
            className="h-11 items-center justify-center"
          >
            <Text className="text-base text-ink-muted">保持注销</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const {
    form,
    state,
    smsCountdown,
    errorToast,
    errorScope,
    freezeUntil,
    requestSms,
    submit,
    clearError,
    dismissFreeze,
  } = useLoginForm();
  const { control, formState } = form;

  const requesting = state === 'requesting_sms';
  const submitting = state === 'submitting';
  const isError = state === 'error';
  // Send button enablement reuses the schema's PHONE_REGEX (single source) — the
  // SMS request is gated on a valid phone (server would 400 otherwise).
  const phoneValid = PHONE_REGEX.test(form.watch('phone'));

  const handleClose = () => {
    if (router.canGoBack()) router.back();
  };

  // success → overlay; AuthGate observes isAuthenticated (set by the mutation's
  // onSuccess) and router.replace's into /(app)/.
  if (state === 'success') return <SuccessOverlay />;

  // FR-C15 — errorScope routes the red border (+ shared ErrorRow): an SMS-request
  // failure faults the phone field; a submit failure faults the code field.
  const phoneErrored = isError && errorScope === 'sms';
  const smsErrored = isError && errorScope === 'submit';
  const errorMessage = isError ? errorToast : null;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View className="flex-1 bg-surface px-lg pb-lg">
        {/* TopBar — close (FR-C08: back if history, else noop) */}
        <View className="flex-row items-center h-11 px-1">
          <Pressable
            onPress={handleClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          >
            <Text className="text-2xl text-ink leading-none">×</Text>
          </Pressable>
        </View>

        {/* Header */}
        <View className="mt-3 items-center gap-2">
          <LogoMark />
          <Text className="text-3xl font-bold text-ink mt-3.5 tracking-tight text-center">
            欢迎回来
          </Text>
          <Text className="text-sm text-ink-muted text-center">把这一段日子，过得不虚此生。</Text>
        </View>

        {/* Form — single form, no tab (FR-C01); inputs via <Controller> (铁律 1) */}
        <View className="mt-9 gap-3">
          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <PhoneInput
                value={field.value.replace(/^\+86/, '')}
                onChangeText={(digits) => {
                  field.onChange(`+86${digits.replace(/\s+/g, '')}`);
                  if (isError) clearError();
                }}
                disabled={submitting || requesting}
                errored={phoneErrored}
              />
            )}
          />
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <SmsInput
                value={field.value}
                onChangeText={(text) => {
                  field.onChange(text);
                  if (isError) clearError();
                }}
                requesting={requesting}
                countdown={smsCountdown > 0 ? smsCountdown : null}
                disabled={submitting}
                errored={smsErrored}
                onSend={() => {
                  if (phoneValid) void requestSms();
                }}
              />
            )}
          />
          {errorMessage ? <ErrorRow text={errorMessage} /> : null}
        </View>

        {/* CTA — "登录" (单接口 login/register 合一) */}
        <View className="mt-7">
          <Button
            label={submitting ? '登录中…' : '登录'}
            loading={submitting}
            disabled={!formState.isValid}
            onPress={() => void submit()}
          />
        </View>
      </View>

      {/* FR-C03 — FROZEN 拦截 modal 覆盖在表单上（state === 'frozen'）。 */}
      {state === 'frozen' && freezeUntil ? (
        <FreezeModal
          remainingDays={remainingFreezeDays(freezeUntil)}
          onCancel={() => router.push(cancelDeletionPath(form.getValues('phone')))}
          onKeep={dismissFreeze}
        />
      ) : null}
    </SafeAreaView>
  );
}

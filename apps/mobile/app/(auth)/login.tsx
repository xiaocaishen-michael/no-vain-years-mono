// Login screen — ported from the legacy app (Strangler-Fig), RHF Golden Sample.
// State machine: idle → requesting_sms → sms_sent → submitting → success | error.
// T064 (skin): layout + <Controller>-wrapped inputs + close × + submit/send wiring
// + a11y. Error display (errorScope borders + ErrorRow) and the success overlay
// land in T065; OAuth / help / freeze are deferred (account-migration p3).
import { useRouter } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Pressable, Text, View } from 'react-native';

import { PHONE_REGEX, useLoginForm } from '~/auth';
import { Button, LogoMark, PhoneInput, SafeAreaView, SmsInput } from '~/ui';

export default function LoginScreen() {
  const router = useRouter();
  const { form, state, smsCountdown, requestSms, submit } = useLoginForm();
  const { control, formState } = form;

  const requesting = state === 'requesting_sms';
  const submitting = state === 'submitting';
  // Send button enablement reuses the schema's PHONE_REGEX (single source) — the
  // SMS request is gated on a valid phone (server would 400 otherwise).
  const phoneValid = PHONE_REGEX.test(form.watch('phone'));

  const handleClose = () => {
    if (router.canGoBack()) router.back();
  };

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
                onChangeText={(digits) => field.onChange(`+86${digits.replace(/\s+/g, '')}`)}
                disabled={submitting || requesting}
              />
            )}
          />
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <SmsInput
                value={field.value}
                onChangeText={field.onChange}
                requesting={requesting}
                countdown={smsCountdown > 0 ? smsCountdown : null}
                disabled={submitting}
                onSend={() => {
                  if (phoneValid) void requestSms();
                }}
              />
            )}
          />
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
    </SafeAreaView>
  );
}

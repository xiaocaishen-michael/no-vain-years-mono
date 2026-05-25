// Public surface for the auth module (apps/mobile/src/auth/). T031 introduced
// store + token-refresh modules; T034 (AuthGate root layout) is the first
// consumer and lifts these names into the module facade.

export { useAuthStore } from './store';
export type { AuthState, Session } from './store';

export {
  refreshOnce,
  refreshTokenFlow,
  rehydrateSession,
  makeAuthRefreshResponseInterceptor,
} from './token-refresh';

export { useDeviceStore, getDeviceHeaders } from './device-store';
export type { DeviceState, DeviceType } from './device-store';

// login slice (account-migration p3): phone-sms-auth mutation wrapper + form schema.
export { usePhoneSmsAuth } from './phone-sms-auth';
export {
  phoneSmsAuthSchema,
  PHONE_REGEX,
  SMS_CODE_REGEX,
  type PhoneSmsAuthValues,
} from './login-form.schema';
export { useLoginForm, loginErrorToast } from './use-login-form';
export type { LoginFormState, ErrorScope } from './use-login-form';

// onboarding slice (account-migration p3): displayName form schema + wrapper + hook.
export { useUpdateDisplayName } from './update-display-name';
export {
  onboardingFormSchema,
  displayNameSchema,
  type OnboardingFormValues,
} from './onboarding-form.schema';
export { useOnboardingForm, onboardingErrorToast } from './use-onboarding-form';
export type { OnboardingFormState } from './use-onboarding-form';

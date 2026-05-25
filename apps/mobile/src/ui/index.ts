// `~/ui` — component primitive facade. login slice (account-migration p3 T059)
// ports PhoneInput / SmsInput / ErrorRow / LogoMark / SuccessCheck from the
// legacy app's packages/ui; PrimaryButton reuses the existing Button (identical
// shape, per plan「Mobile UI Plan」open-decision #1). Presentational — no unit
// tests (covered by Playwright e2e, per mono vitest architecture).

export { Button, type ButtonProps } from './Button';
export { Spinner, type SpinnerProps, type SpinnerTone } from './Spinner';
export { SafeAreaView, type SafeAreaViewProps } from './SafeAreaView';
export { ErrorRow, type ErrorRowProps } from './ErrorRow';
export { PhoneInput, type PhoneInputProps } from './PhoneInput';
export { SmsInput, type SmsInputProps } from './SmsInput';
export { DisplayNameInput, type DisplayNameInputProps } from './DisplayNameInput';
export { LogoMark, type LogoMarkProps } from './LogoMark';
export { SuccessCheck } from './SuccessCheck';

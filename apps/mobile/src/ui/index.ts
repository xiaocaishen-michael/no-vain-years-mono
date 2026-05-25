// `~/ui` — component primitive facade. login slice (account-migration p3 T059)
// ports PhoneInput / SmsInput / ErrorRow / LogoMark / SuccessCheck from the
// legacy app's packages/ui; PrimaryButton reuses the existing Button (identical
// shape, per plan「Mobile UI Plan」open-decision #1). Presentational — no unit
// tests (covered by Playwright e2e, per mono vitest architecture).

export { Button, type ButtonProps } from './Button.js';
export { Spinner, type SpinnerProps, type SpinnerTone } from './Spinner.js';
export { SafeAreaView, type SafeAreaViewProps } from './SafeAreaView.js';
export { ErrorRow, type ErrorRowProps } from './ErrorRow.js';
export { PhoneInput, type PhoneInputProps } from './PhoneInput.js';
export { SmsInput, type SmsInputProps } from './SmsInput.js';
export { LogoMark, type LogoMarkProps } from './LogoMark.js';
export { SuccessCheck } from './SuccessCheck.js';

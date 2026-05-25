import { useAccountProfileControllerUpdateDisplayName } from '@nvy/api-client';
import { useAuthStore } from './store';

// Wraps the Orval update-display-name (PATCH /me) mutation. On success, lifts the
// new displayName into the auth store; AuthGate observes displayName != null and
// redirects to (tabs)/profile — this hook does NOT navigate (FR-032 / FR-014).
// Caller (useOnboardingForm) drives mutateAsync({ data }) and reads error for UI.
// Mirrors phone-sms-auth.ts.
export function useUpdateDisplayName() {
  const setDisplayName = useAuthStore((s) => s.setDisplayName);
  return useAccountProfileControllerUpdateDisplayName({
    mutation: {
      onSuccess: ({ data }) => {
        setDisplayName(data.displayName);
      },
    },
  });
}

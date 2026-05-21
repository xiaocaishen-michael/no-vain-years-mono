// Pure routing decision for AuthGate (apps/mobile/app/_layout.tsx). Extracted
// so the 3-state truth table (per spec FR-014 / CL-009 决议) can be unit-tested
// without mocking expo-router / react-native.
//
// Three states:
//   1. !isAuthenticated                       → /(auth)/login
//   2. isAuthenticated && displayName == null → /(app)/onboarding
//   3. isAuthenticated && displayName != null → /(app)/(tabs)/profile
//
// Each state maps to a target route, with `noop` when the user is already
// where they should be (avoids replace-loop + needless re-renders).

export interface AuthGateInput {
  isAuthenticated: boolean;
  displayName: string | null;
  inAuthGroup: boolean;
  inOnboarding: boolean;
}

export type AuthGateDecision = { kind: 'noop' } | { kind: 'replace'; target: string };

export function decideAuthRoute(input: AuthGateInput): AuthGateDecision {
  const { isAuthenticated, displayName, inAuthGroup, inOnboarding } = input;

  if (!isAuthenticated) {
    if (inAuthGroup) return { kind: 'noop' };
    return { kind: 'replace', target: '/(auth)/login' };
  }

  if (displayName === null) {
    if (inOnboarding) return { kind: 'noop' };
    return { kind: 'replace', target: '/(app)/onboarding' };
  }

  // isAuthenticated + displayName != null — user must NOT linger on (auth) or onboarding.
  if (inAuthGroup || inOnboarding) return { kind: 'replace', target: '/(app)/(tabs)/profile' };
  return { kind: 'noop' };
}

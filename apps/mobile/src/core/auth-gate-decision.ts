// Pure routing decision for AuthGate (apps/mobile/app/_layout.tsx). Extracted
// so the truth table (per spec FR-014 / CL-009 决议) can be unit-tested without
// mocking expo-router / react-native.
//
// States:
//   1. !isAuthenticated                            → /(auth)/login
//   2. auth + displayName == null + !profileLoaded → wait (hold splash)
//   3. auth + displayName == null + profileLoaded  → /(app)/onboarding
//   4. auth + displayName != null                  → /(app)/(tabs)/profile
//
// State 2 (`wait`) closes the fresh-login backfill gap: a returning user with a
// set displayName logs in carrying only tokens in the session — LoginResponse
// omits displayName for byte-level anti-enumeration (see
// apps/server/src/auth/phone-sms-auth.response.ts), so store.displayName is
// momentarily null until useMe (GET /me) rehydrates it. Without the gate
// AuthGate would flash /(app)/onboarding before the profile lands. We hold a
// splash until the profile query settles, then route on the real displayName.
// Cold-start returning users skip the wait — displayName is restored from
// persisted SecureStore (store.ts partialize), so state 4 hits directly.

export interface AuthGateInput {
  isAuthenticated: boolean;
  displayName: string | null;
  // GET /me has settled (success OR error); false while the profile query is in
  // flight or disabled. Gates the displayName==null branch so a returning user
  // is not misrouted to onboarding before /me rehydrates displayName.
  profileLoaded: boolean;
  inAuthGroup: boolean;
  inOnboarding: boolean;
  inTabs: boolean;
}

export type AuthGateDecision =
  | { kind: 'noop' }
  | { kind: 'wait' }
  | { kind: 'replace'; target: string };

export function decideAuthRoute(input: AuthGateInput): AuthGateDecision {
  const { isAuthenticated, displayName, profileLoaded, inAuthGroup, inOnboarding, inTabs } = input;

  if (!isAuthenticated) {
    if (inAuthGroup) return { kind: 'noop' };
    return { kind: 'replace', target: '/(auth)/login' };
  }

  if (displayName === null) {
    // Already on onboarding (a genuine new user filling the form) — stay put;
    // don't flash a splash over their input regardless of profile-load state.
    if (inOnboarding) return { kind: 'noop' };
    // Profile not settled yet → hold a splash rather than assume "new user".
    if (!profileLoaded) return { kind: 'wait' };
    return { kind: 'replace', target: '/(app)/onboarding' };
  }

  // isAuthenticated + displayName != null. The user must land inside (tabs);
  // any other position — (auth) / onboarding / root `/` (which renders null) —
  // is a transient state that AuthGate redirects out of.
  if (inTabs) return { kind: 'noop' };
  return { kind: 'replace', target: '/(app)/(tabs)/profile' };
}

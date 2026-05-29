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
  // True when anywhere inside the /(app)/* group (tabs, settings, onboarding,
  // and any future authed screen). The authed+named branch treats every (app)
  // route as a valid location (except onboarding), so new routes need no gate
  // change — replaces the old per-route `inTabs`/`inSettings` whitelist.
  inAppGroup: boolean;
}

export type AuthGateDecision =
  | { kind: 'noop' }
  | { kind: 'wait' }
  | { kind: 'replace'; target: string };

export function decideAuthRoute(input: AuthGateInput): AuthGateDecision {
  const { isAuthenticated, displayName, profileLoaded, inAuthGroup, inOnboarding, inAppGroup } =
    input;

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

  // isAuthenticated + displayName != null. Every /(app)/* screen is a valid
  // location for a named user EXCEPT onboarding (they already have a name).
  // Redirect to profile only from genuinely wrong/transient positions: the
  // (auth) group, the bare root `/` (app/index.tsx renders null → the #79
  // cold-boot blank screen), or a stale onboarding screen. Leaving every other
  // (app) route alone (tabs, settings, future authed screens) means new routes
  // need no change here — this is a blocklist, not a per-route whitelist.
  if (inAppGroup && !inOnboarding) return { kind: 'noop' };
  return { kind: 'replace', target: '/(app)/(tabs)/profile' };
}

/**
 * Resolve the displayName the route decision should use THIS render.
 *
 * `store.displayName` lags one commit behind GET /me: useMe writes it back via a
 * useEffect (apps/mobile/src/core/api/use-me.ts) that runs AFTER the render where
 * the query data first lands. On that settle frame the store is still null while
 * `profile.data.displayName` already holds the real name — feeding the store
 * value alone into decideAuthRoute misroutes a returning user to
 * /(app)/onboarding for one frame (which then bounces, racing expo-router's two
 * back-to-back replace() calls and sometimes sticking on onboarding). Prefer the
 * store (covers cold-start persisted + post-onboarding setDisplayName) but fall
 * back to the freshly-fetched profile value, so the gate decides on the real name
 * the same frame /me lands — no onboarding flash, deterministically.
 */
export function resolveDisplayName(
  storeDisplayName: string | null,
  profileDisplayName: string | null | undefined,
): string | null {
  return storeDisplayName ?? profileDisplayName ?? null;
}

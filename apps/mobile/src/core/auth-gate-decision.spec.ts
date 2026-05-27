import { describe, expect, it } from 'vitest';

import { decideAuthRoute, type AuthGateInput } from './auth-gate-decision';

// profileLoaded defaults to true so the legacy three-state cases below read as
// "profile already settled" — the wait gate (profileLoaded:false) is exercised
// in its own describe block.
const base: AuthGateInput = {
  isAuthenticated: false,
  displayName: null,
  profileLoaded: true,
  inAuthGroup: false,
  inOnboarding: false,
  inTabs: false,
};

describe('decideAuthRoute — A-002 FR-014 / CL-009 三态决策', () => {
  // ----- !isAuthenticated branch ----- //

  it('!auth + inAuthGroup → noop (already on /(auth)/login)', () => {
    expect(decideAuthRoute({ ...base, inAuthGroup: true })).toEqual({ kind: 'noop' });
  });

  it('!auth + outside any group → replace /(auth)/login', () => {
    expect(decideAuthRoute({ ...base })).toEqual({
      kind: 'replace',
      target: '/(auth)/login',
    });
  });

  it('!auth + on /(app)/onboarding (somehow) → still must go login first', () => {
    expect(decideAuthRoute({ ...base, inOnboarding: true })).toEqual({
      kind: 'replace',
      target: '/(auth)/login',
    });
  });

  // ----- isAuthenticated + displayName === null branch ----- //

  it('auth + displayName null + inAuthGroup → replace /(app)/onboarding', () => {
    expect(decideAuthRoute({ ...base, isAuthenticated: true, inAuthGroup: true })).toEqual({
      kind: 'replace',
      target: '/(app)/onboarding',
    });
  });

  it('auth + displayName null + (app)/ → replace /(app)/onboarding', () => {
    expect(decideAuthRoute({ ...base, isAuthenticated: true })).toEqual({
      kind: 'replace',
      target: '/(app)/onboarding',
    });
  });

  it('auth + displayName null + inOnboarding → noop (gate satisfied)', () => {
    expect(decideAuthRoute({ ...base, isAuthenticated: true, inOnboarding: true })).toEqual({
      kind: 'noop',
    });
  });

  // ----- isAuthenticated + displayName !== null branch — FR-014 target /(app)/(tabs)/profile ----- //

  it('auth + displayName set + inAuthGroup → replace /(app)/(tabs)/profile', () => {
    expect(
      decideAuthRoute({
        ...base,
        isAuthenticated: true,
        displayName: '小明',
        inAuthGroup: true,
      }),
    ).toEqual({ kind: 'replace', target: '/(app)/(tabs)/profile' });
  });

  it('auth + displayName set + already inTabs → noop', () => {
    expect(
      decideAuthRoute({
        ...base,
        isAuthenticated: true,
        displayName: '小明',
        inTabs: true,
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('auth + displayName set + at root `/` (no group, !inTabs) → replace /(app)/(tabs)/profile', () => {
    // Pre-PR-5-tail bug: cold-boot from seeded persist landed on `/` (index.tsx
    // returns null), AuthGate returned noop → blank screen + e2e suite failed.
    expect(decideAuthRoute({ ...base, isAuthenticated: true, displayName: '小明' })).toEqual({
      kind: 'replace',
      target: '/(app)/(tabs)/profile',
    });
  });

  it('auth + displayName set + inOnboarding → replace /(app)/(tabs)/profile (no holding on gate)', () => {
    expect(
      decideAuthRoute({
        ...base,
        isAuthenticated: true,
        displayName: '小明',
        inOnboarding: true,
      }),
    ).toEqual({ kind: 'replace', target: '/(app)/(tabs)/profile' });
  });

  // ----- empty-string displayName treated as set (server FR-005 trim guarantees non-empty) ----- //

  it('auth + displayName empty string (defensive: empty != null, treated as set)', () => {
    // Server FR-005 trims; empty string never reaches the client. But if it
    // does (mid-write race), treat it as set so we don't deadlock the user.
    expect(
      decideAuthRoute({
        ...base,
        isAuthenticated: true,
        displayName: '',
        inTabs: true,
      }),
    ).toEqual({ kind: 'noop' });
  });
});

describe('decideAuthRoute — profileLoaded gate (fresh-login displayName backfill)', () => {
  // A returning user logs in with only tokens (LoginResponse omits displayName
  // for anti-enumeration), so displayName is null until useMe rehydrates it.
  // The gate must hold a splash (wait) instead of flashing onboarding.

  it('auth + displayName null + !profileLoaded (outside onboarding) → wait (hold splash, no onboarding flash)', () => {
    expect(decideAuthRoute({ ...base, isAuthenticated: true, profileLoaded: false })).toEqual({
      kind: 'wait',
    });
  });

  it('auth + displayName null + !profileLoaded + inAuthGroup → wait (returning user mid-login)', () => {
    expect(
      decideAuthRoute({ ...base, isAuthenticated: true, profileLoaded: false, inAuthGroup: true }),
    ).toEqual({ kind: 'wait' });
  });

  it('auth + displayName null + !profileLoaded + inOnboarding → noop (new user already filling form; no splash over input)', () => {
    expect(
      decideAuthRoute({ ...base, isAuthenticated: true, profileLoaded: false, inOnboarding: true }),
    ).toEqual({ kind: 'noop' });
  });

  it('auth + displayName SET + !profileLoaded → tabs (cold-start persisted name skips the wait)', () => {
    expect(
      decideAuthRoute({
        ...base,
        isAuthenticated: true,
        displayName: '小明',
        profileLoaded: false,
      }),
    ).toEqual({ kind: 'replace', target: '/(app)/(tabs)/profile' });
  });

  it('auth + displayName null + profileLoaded → onboarding (profile settled, genuinely no name)', () => {
    expect(decideAuthRoute({ ...base, isAuthenticated: true, profileLoaded: true })).toEqual({
      kind: 'replace',
      target: '/(app)/onboarding',
    });
  });
});

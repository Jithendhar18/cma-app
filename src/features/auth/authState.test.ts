import { describe, expect, it } from 'vitest';
import type { AccountLoad } from './accountApi';
import { accountFromLoad, authReducer, initialAuthState, type AuthState } from './authState';

const A = { id: 'user-a', email: 'a@example.test' };
const B = { id: 'user-b', email: 'b@example.test' };
const ready = (name: string): AccountLoad => ({
  kind: 'ready',
  profile: { id: 'x', displayName: name, timeZone: 'Asia/Kolkata', onboardingCompletedAt: null },
  settings: { dailyTargetHours: 8, weeklyTargetHours: 50, studyStartTime: '06:00:00', studyEndTime: '23:00:00', pomodoroFocusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 4, theme: 'dark' },
});
const signedIn = (user = A): AuthState => ({ status: 'signed-in', user, account: { phase: 'loading' } });

describe('initial state', () => {
  it('follows the configuration', () => {
    expect(initialAuthState({ status: 'disabled' })).toEqual({ status: 'disabled' });
    expect(initialAuthState({ status: 'misconfigured', problem: 'missing-key' })).toEqual({ status: 'misconfigured', problem: 'missing-key' });
    expect(initialAuthState({ status: 'enabled', url: 'https://p.supabase.co', anonKey: 'k' })).toEqual({ status: 'initializing' });
  });
});

describe('disabled and misconfigured states never move', () => {
  it('ignores every action', () => {
    for (const start of [{ status: 'disabled' } as const, { status: 'misconfigured', problem: 'missing-url' } as const]) {
      for (const action of [{ type: 'session', user: A, userInitiated: false }, { type: 'init-failed' }, { type: 'account-reload' }] as const) {
        expect(authReducer(start, action)).toBe(start);
      }
    }
  });
});

describe('restoring the session', () => {
  it('moves from initializing to signed-in with an empty (loading) account', () => {
    expect(authReducer({ status: 'initializing' }, { type: 'session', user: A, userInitiated: false })).toEqual({ status: 'signed-in', user: A, account: { phase: 'loading' } });
  });
  it('moves from initializing to signed-out when there is no session, without calling it an expiry', () => {
    expect(authReducer({ status: 'initializing' }, { type: 'session', user: null, userInitiated: false })).toEqual({ status: 'signed-out', endedUnexpectedly: false, byUser: false });
  });
});

describe('a session that ends', () => {
  const inWithProfile = authReducer(authReducer(signedIn(A), { type: 'account-loaded', userId: 'user-a', load: ready('Asha') }), { type: 'account-reload' });
  it('is reported as unexpected when the user did not ask (expiry, or a sign-out in another tab)', () => {
    expect(authReducer(signedIn(A), { type: 'session', user: null, userInitiated: false })).toEqual({ status: 'signed-out', endedUnexpectedly: true, byUser: false });
    expect(inWithProfile.status).toBe('signed-in');
  });
  it('is reported as the user\'s own choice when they asked', () => {
    expect(authReducer(signedIn(A), { type: 'session', user: null, userInitiated: true })).toEqual({ status: 'signed-out', endedUnexpectedly: false, byUser: true });
  });
  it('drops the profile and settings from memory', () => {
    const loaded = authReducer(signedIn(A), { type: 'account-loaded', userId: 'user-a', load: ready('Asha') });
    expect(JSON.stringify(loaded)).toContain('Asha');
    expect(JSON.stringify(authReducer(loaded, { type: 'session', user: null, userInitiated: false }))).not.toContain('Asha');
  });
  it('stays signed-out when told again', () => {
    const out: AuthState = { status: 'signed-out', endedUnexpectedly: true, byUser: false };
    expect(authReducer(out, { type: 'session', user: null, userInitiated: false })).toBe(out);
  });
});

describe('a refresh or update for the same user', () => {
  it('keeps the loaded profile (no flicker, no reload)', () => {
    const loaded = authReducer(signedIn(A), { type: 'account-loaded', userId: 'user-a', load: ready('Asha') });
    const refreshed = authReducer(loaded, { type: 'session', user: { ...A, email: 'a2@example.test' }, userInitiated: false });
    expect(refreshed).toMatchObject({ status: 'signed-in', user: { id: 'user-a', email: 'a2@example.test' }, account: { phase: 'ready' } });
  });
});

describe('switching between users', () => {
  it('never lets the first user\'s profile appear for the second', () => {
    const asha = authReducer(signedIn(A), { type: 'account-loaded', userId: 'user-a', load: ready('Asha') });
    const switched = authReducer(asha, { type: 'session', user: B, userInitiated: false });
    expect(switched).toEqual({ status: 'signed-in', user: B, account: { phase: 'loading' } });
    expect(JSON.stringify(switched)).not.toContain('Asha');
  });
  it('discards a slow answer for a user who has since gone', () => {
    const onB = authReducer(signedIn(A), { type: 'session', user: B, userInitiated: false });
    // A's late profile arrives after B is current:
    expect(authReducer(onB, { type: 'account-loaded', userId: 'user-a', load: ready('Asha') })).toBe(onB);
  });
  it('discards an answer that arrives after sign-out', () => {
    const out = authReducer(signedIn(A), { type: 'session', user: null, userInitiated: true });
    expect(authReducer(out, { type: 'account-loaded', userId: 'user-a', load: ready('Asha') })).toBe(out);
  });
});

describe('account loading results', () => {
  it('map each outcome to an explicit state', () => {
    expect(accountFromLoad(ready('Asha')).phase).toBe('ready');
    expect(accountFromLoad({ kind: 'incomplete', missing: 'profile' })).toEqual({ phase: 'incomplete', missing: 'profile' });
    expect(accountFromLoad({ kind: 'error', failure: 'network' })).toEqual({ phase: 'error', failure: 'network' });
  });
  it('reload puts the account back to loading', () => {
    const loaded = authReducer(signedIn(A), { type: 'account-loaded', userId: 'user-a', load: { kind: 'error', failure: 'network' } });
    expect(authReducer(loaded, { type: 'account-reload' })).toMatchObject({ account: { phase: 'loading' } });
  });
});

describe('start-up failure and retry', () => {
  it('only an initializing app can fail to start, and only an errored one can retry', () => {
    expect(authReducer({ status: 'initializing' }, { type: 'init-failed' })).toEqual({ status: 'error' });
    const signedOut: AuthState = { status: 'signed-out', endedUnexpectedly: false, byUser: false };
    expect(authReducer(signedOut, { type: 'init-failed' })).toBe(signedOut);
    expect(authReducer({ status: 'error' }, { type: 'init-retry' })).toEqual({ status: 'initializing' });
    expect(authReducer(signedOut, { type: 'init-retry' })).toBe(signedOut);
  });
  it('a late session after a failed start still signs the user in', () => {
    expect(authReducer({ status: 'error' }, { type: 'session', user: A, userInitiated: false })).toMatchObject({ status: 'signed-in' });
  });
});

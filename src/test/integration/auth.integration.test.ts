/**
 * Auth integration test against the LOCAL Supabase stack: real GoTrue, the real `handle_new_user()` trigger, real PostgREST and
 * real row level security, driven by the application's own auth code (authService, accountApi, the client module).
 *
 * It is opt-in, because it needs a running local stack:
 *     bash scripts/db/test-auth-integration.sh
 * A plain `npm test` skips it. It refuses to run against anything but this machine, creates only throwaway users on
 * @example.test, and deletes them afterwards.
 *
 * What it cannot cover: delivery of the confirmation and reset emails and the one-time-code exchange from a real link. The local
 * stack has no mail server, so those are exercised with a mocked SDK in the unit tests and must be rehearsed on the hosted project.
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadAccount } from '@/features/auth/accountApi';
import { validatePassword } from '@/features/auth/validation';
import { requestPasswordReset, resendConfirmation, signIn, signOut, signUp, updatePassword } from '@/features/auth/authService';
import { getSupabaseClient, resetSupabaseClientForTests, type AppSupabaseClient } from '@/lib/supabase/client';
import { readAuthConfig } from '@/lib/supabase/config';
import type { Database } from '@/lib/supabase/database.types';

const URL = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
const ENABLED = process.env.SUPABASE_INTEGRATION === '1';
const RUN = Math.random().toString(36).slice(2, 8);
const emailOf = (who: string) => `m6-int-${RUN}-${who}@example.test`;
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a different battery staple';

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: process.env.PGPORT ?? '54322', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: 'postgres' },
    encoding: 'utf8',
  }).trim();
}
const rawClient = () => createClient<Database>(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The shared test setup clears localStorage before every test, which would wipe the SDK's stored session between the steps of
 * this deliberately sequential flow. This file therefore gets its own storage whose clear() does nothing.
 */
function persistentStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => undefined,
  };
}

describe.skipIf(!ENABLED)('auth against the real local stack', () => {
  let a: AppSupabaseClient; // user A, through the application's own client module
  const idOf = (who: string) => psql(`select id from auth.users where email = '${emailOf(who)}'`);

  beforeAll(async () => {
    vi.stubGlobal('localStorage', persistentStorage());
    // Email-link redirects always use the page's own origin. Use the one the local allow-list holds (supabase/config.toml).
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:5173' });
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) throw new Error(`REFUSED: this test only runs against a local stack (SUPABASE_URL=${URL})`);
    const parsed = readAuthConfig({ VITE_SUPABASE_AUTH_ENABLED: 'true', VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: KEY });
    // The real local anon key must pass the app's own allowlist.
    expect(parsed.status).toBe('enabled');
    resetSupabaseClientForTests();
    const client = await getSupabaseClient(parsed);
    if (!client) throw new Error('no client');
    a = client;
  });

  afterAll(() => {
    // profiles and user_settings are removed by the foreign keys' ON DELETE CASCADE
    psql(`delete from auth.users where email like 'm6-int-${RUN}-%@example.test'`);
    expect(psql(`select count(*) from auth.users where email like 'm6-int-${RUN}-%'`)).toBe('0');
  });

  describe('registration', () => {
    it('with email confirmation on, creates no session, and the trigger builds the profile and settings from the display_name metadata', async () => {
      const result = await signUp(a, { displayName: '  Integration A  ', email: emailOf('a'), password: PASSWORD });
      expect(result).toEqual({ kind: 'confirmation-pending' });
      const id = idOf('a');
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(psql(`select display_name from public.profiles where id = '${id}'`)).toBe('Integration A'); // trimmed, from the metadata key we send
      expect(psql(`select count(*) from public.user_settings where user_id = '${id}'`)).toBe('1');
      expect(psql(`select raw_user_meta_data ->> 'display_name' from auth.users where id = '${id}'`)).toBe('Integration A');
      expect((await a.auth.getSession()).data.session).toBeNull();
    });

    it('creates a second user the same way', async () => {
      expect(await signUp(rawClient() as AppSupabaseClient, { displayName: 'Integration B', email: emailOf('b'), password: PASSWORD })).toEqual({ kind: 'confirmation-pending' });
      expect(psql(`select display_name from public.profiles where id = '${idOf('b')}'`)).toBe('Integration B');
    });

    it('answers a repeated registration exactly like a new one (no way to discover which addresses have accounts)', async () => {
      await wait(1500); // the server allows one email per address per second
      expect(await signUp(rawClient() as AppSupabaseClient, { displayName: 'Someone Else', email: emailOf('a'), password: PASSWORD })).toEqual({ kind: 'confirmation-pending' });
      expect(psql(`select count(*) from auth.users where email = '${emailOf('a')}'`)).toBe('1');
      expect(psql(`select display_name from public.profiles where id = '${idOf('a')}'`)).toBe('Integration A'); // the repeat changed nothing
    });

    it('enforces the same 72-BYTE maximum that the client checks (it rejects, it does not truncate), and counts bytes, not characters', async () => {
      const server = async (who: string, password: string) => {
        const { error } = await rawClient().auth.signUp({ email: emailOf(who), password });
        return error?.code ?? null;
      };
      // Bypasses the app's validation on purpose, to see what the server itself does.
      expect(await server('pw72', 'x'.repeat(72))).toBeNull();
      expect(await server('pw73', 'x'.repeat(73))).toBe('validation_failed');
      expect(await server('pw24hi', 'अ'.repeat(24))).toBeNull(); // 72 bytes, 24 characters
      expect(await server('pw25hi', 'अ'.repeat(25))).toBe('validation_failed'); // 75 bytes, 25 characters
      // The client's rule agrees at every one of those boundaries.
      expect([validatePassword('x'.repeat(72)), validatePassword('x'.repeat(73)) === null, validatePassword('अ'.repeat(24)), validatePassword('अ'.repeat(25)) === null]).toEqual([null, false, null, false]);
    });

    it('can send the confirmation email again (after the server\'s short pause between emails)', async () => {
      await wait(1500);
      expect(await resendConfirmation(rawClient() as AppSupabaseClient, emailOf('b'))).toEqual({ kind: 'sent' });
    });
  });

  describe('sign-in', () => {
    it('refuses an unconfirmed address, but only reveals that after a correct password', async () => {
      expect(await signIn(a, { email: emailOf('a'), password: PASSWORD })).toMatchObject({ kind: 'failed', failure: 'email-not-confirmed' });
      // A wrong password for the same unconfirmed account is just "not correct": nothing about the account leaks.
      expect(await signIn(a, { email: emailOf('a'), password: 'definitely the wrong one' })).toMatchObject({ kind: 'failed', failure: 'invalid-credentials' });
    });

    it('after the address is confirmed, signs in; wrong password and unknown email are indistinguishable', async () => {
      psql(`update auth.users set email_confirmed_at = now() where email in ('${emailOf('a')}', '${emailOf('b')}')`);
      expect(await signIn(a, { email: emailOf('a'), password: 'definitely the wrong one' })).toMatchObject({ failure: 'invalid-credentials', message: 'The email or password is not correct.' });
      expect(await signIn(a, { email: emailOf('nobody'), password: PASSWORD })).toMatchObject({ failure: 'invalid-credentials', message: 'The email or password is not correct.' });
      expect(await signIn(a, { email: emailOf('a'), password: PASSWORD })).toEqual({ kind: 'signed-in' });
      expect((await a.auth.getSession()).data.session?.user.id).toBe(idOf('a'));
    });
  });

  describe('profile and settings, through the real JWT and row level security', () => {
    it('loads the signed-in user\'s own profile and settings with the application\'s own loader', async () => {
      const result = await loadAccount(a, idOf('a'));
      expect(result).toMatchObject({
        kind: 'ready',
        profile: { id: idOf('a'), displayName: 'Integration A', timeZone: 'Asia/Kolkata', onboardingCompletedAt: null },
        settings: { dailyTargetHours: 8, weeklyTargetHours: 50, pomodoroFocusMinutes: 50, longBreakEvery: 4, theme: 'dark' },
      });
    });

    it('sees exactly one profile and one settings row: its own', async () => {
      const profiles = await a.from('profiles').select('id');
      const settings = await a.from('user_settings').select('user_id');
      expect(profiles.error).toBeNull();
      expect(profiles.data).toEqual([{ id: idOf('a') }]);
      expect(settings.data).toEqual([{ user_id: idOf('a') }]);
    });

    it('cannot read another user\'s profile or settings, even when asking for them by id', async () => {
      const profile = await a.from('profiles').select('id').eq('id', idOf('b')).maybeSingle();
      const settings = await a.from('user_settings').select('user_id').eq('user_id', idOf('b')).maybeSingle();
      expect(profile).toMatchObject({ data: null, error: null });
      expect(settings).toMatchObject({ data: null, error: null });
    });

    it('cannot change another user\'s rows (the update matches nothing)', async () => {
      await a.from('profiles').update({ display_name: 'HACKED' }).eq('id', idOf('b'));
      await a.from('user_settings').update({ theme: 'light' }).eq('user_id', idOf('b'));
      expect(psql(`select display_name from public.profiles where id = '${idOf('b')}'`)).toBe('Integration B');
      expect(psql(`select theme from public.user_settings where user_id = '${idOf('b')}'`)).toBe('dark');
    });

    it('cannot create a profile or a settings row: there is no insert grant, so the browser cannot make its own', async () => {
      const profiles = a.from('profiles') as unknown as { insert: (v: unknown) => Promise<{ error: { code?: string } | null }> };
      const settings = a.from('user_settings') as unknown as { insert: (v: unknown) => Promise<{ error: { code?: string } | null }> };
      expect((await profiles.insert({ id: idOf('a'), display_name: 'Forged' })).error?.code).toBe('42501');
      expect((await settings.insert({ user_id: idOf('a') })).error?.code).toBe('42501');
    });

    it('cannot delete its own profile', async () => {
      const profiles = a.from('profiles') as unknown as { delete: () => { eq: (c: string, v: string) => Promise<{ error: { code?: string } | null }> } };
      expect((await profiles.delete().eq('id', idOf('a'))).error?.code).toBe('42501');
      expect(psql(`select count(*) from public.profiles where id = '${idOf('a')}'`)).toBe('1');
    });

    it('can update only the permitted columns of its own rows, and the database still enforces its limits', async () => {
      expect((await a.from('profiles').update({ display_name: 'Integration A2' }).eq('id', idOf('a'))).error).toBeNull();
      expect(psql(`select display_name from public.profiles where id = '${idOf('a')}'`)).toBe('Integration A2');
      const changeId = a.from('profiles') as unknown as { update: (v: unknown) => { eq: (c: string, v: string) => Promise<{ error: { code?: string } | null }> } };
      expect((await changeId.update({ id: idOf('b') }).eq('id', idOf('a'))).error?.code).toBe('42501'); // no column grant on id
      expect((await a.from('user_settings').update({ theme: 'light' }).eq('user_id', idOf('a'))).error).toBeNull();
      expect((await a.from('user_settings').update({ daily_target_hours: 99 }).eq('user_id', idOf('a'))).error?.code).toBe('23514'); // check constraint
      expect((await a.from('profiles').update({ display_name: '' }).eq('id', idOf('a'))).error?.code).toBe('23514');
    });

    it('a signed-out visitor can read nothing from either table', async () => {
      const anon = rawClient();
      expect((await anon.from('profiles').select('id')).error?.code).toBe('42501');
      expect((await anon.from('user_settings').select('user_id')).error?.code).toBe('42501');
    });
  });

  describe('password reset and change', () => {
    it('requests a reset for an existing and an unknown address and says the same for both', async () => {
      await wait(1500);
      expect(await requestPasswordReset(rawClient() as AppSupabaseClient, emailOf('a'))).toEqual({ kind: 'requested' });
      await wait(1500);
      expect(await requestPasswordReset(rawClient() as AppSupabaseClient, emailOf('nobody'))).toEqual({ kind: 'requested' });
    });

    it('changes the password of the signed-in session; the old one stops working and the new one works', async () => {
      expect(await updatePassword(a, NEW_PASSWORD)).toEqual({ kind: 'updated' });
      const fresh = rawClient() as AppSupabaseClient;
      expect(await signIn(fresh, { email: emailOf('a'), password: PASSWORD })).toMatchObject({ failure: 'invalid-credentials' });
      expect(await signIn(fresh, { email: emailOf('a'), password: NEW_PASSWORD })).toEqual({ kind: 'signed-in' });
    });

    it('refuses reusing the current password, in plain words', async () => {
      const result = await updatePassword(a, NEW_PASSWORD);
      expect(result).toMatchObject({ kind: 'failed', failure: 'same-password' });
    });
  });

  describe('sign-out', () => {
    it('ends the session, and the account tables are closed again', async () => {
      expect(await signOut(a)).toEqual({ kind: 'signed-out' });
      expect((await a.auth.getSession()).data.session).toBeNull();
      expect(await loadAccount(a, idOf('a'))).toMatchObject({ kind: 'error' });
    });
  });
});

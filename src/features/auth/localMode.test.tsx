/**
 * Local-mode protection. Accounts are an addition: with the flag off the app must behave exactly as it did before, and with the
 * flag on, signing in, out or switching accounts must never read, upload, change or delete the student's local study data.
 */
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, makeSession, seedUser, type FakeSupabase } from '@/test/fakeSupabase';
import { disableAccounts, enableAccounts, startApp } from '@/test/appHarness';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { resetLinkCacheForTests } from './pkceCallback';

const sdk = vi.hoisted(() => ({ loaded: false, createClient: vi.fn() }));
// If anything imports the SDK, the factory runs and records it. With the flag off it must never run.
vi.mock('@supabase/supabase-js', () => {
  sdk.loaded = true;
  return { createClient: sdk.createClient };
});

const LOCAL_KEYS = ['cma-study-os', 'cma-study-os-timer', 'cma-study-os-ui'];
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Gives the stores real, recognisable local data, persisted to localStorage as the app does. */
function seedLocalData() {
  useStudyStore.getState().updateSettings({ name: 'Local Tester', dailyTargetHours: 7 });
  useUiStore.setState({ sidebarCollapsed: true });
  return snapshot();
}
function snapshot() {
  return {
    storage: Object.fromEntries(LOCAL_KEYS.map((key) => [key, localStorage.getItem(key)])),
    study: JSON.stringify({ settings: useStudyStore.getState().settings, chapters: useStudyStore.getState().chapters, sessions: useStudyStore.getState().sessions, revisions: useStudyStore.getState().revisions }),
    timer: JSON.stringify(useTimerStore.getState()),
  };
}

let xhrOpen: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sdk.loaded = false;
  sdk.createClient.mockReset();
  resetLinkCacheForTests();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('feature flag OFF (the default)', () => {
  beforeEach(() => disableAccounts());

  it('makes no request, creates no client and never even loads the Supabase SDK', async () => {
    for (const path of ['/', '/settings', '/subjects', '/planner', '/timer']) {
      const { unmount } = startApp(path);
      await waitFor(() => expect(document.querySelector('main')).not.toBeNull());
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      unmount();
    }
    expect(sdk.loaded).toBe(false);
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
  });

  it('is also off when the variable is simply not set (no environment at all)', async () => {
    vi.stubEnv('VITE_SUPABASE_AUTH_ENABLED', '');
    startApp('/');
    await screen.findAllByRole('banner');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sdk.loaded).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves the existing pages, routes and header exactly as they were', async () => {
    startApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    const header = (await screen.findAllByRole('banner'))[0];
    expect(header.textContent).not.toMatch(/sign in|account/i);
    expect(screen.queryByRole('link', { name: /sign in|your account/i })).toBeNull();
  });

  it('has no account routes: they fall through to the existing catch-all, back to the dashboard', async () => {
    for (const path of ['/auth/sign-in', '/auth/sign-up', '/auth/callback', '/auth/reset-password', '/account']) {
      const { unmount } = startApp(path);
      await waitFor(() => expect(window.location.pathname).toBe('/'));
      unmount();
    }
    expect(sdk.loaded).toBe(false);
  });

  it('keeps the local stores and their storage keys intact, byte for byte', async () => {
    const before = seedLocalData();
    expect(before.storage['cma-study-os']).toContain('Local Tester');
    startApp('/');
    await screen.findAllByRole('banner');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(snapshot()).toEqual(before);
    // Only the three known keys exist, and nothing belongs to accounts.
    const keys = Object.keys(localStorage);
    expect(keys.every((k) => LOCAL_KEYS.includes(k))).toBe(true);
    expect(keys.some((k) => /auth|supabase|^sb-/i.test(k))).toBe(false);
  });

  it('still lets the student change local settings and persists them under the same key', async () => {
    startApp('/');
    await screen.findAllByRole('banner');
    act(() => useStudyStore.getState().updateSettings({ name: 'Renamed Locally' }));
    expect(JSON.parse(localStorage.getItem('cma-study-os') ?? '{}').state.settings.name).toBe('Renamed Locally');
  });
});

describe('local mode without any Supabase credentials', () => {
  it('works when accounts are on but the settings are missing (the build is misconfigured, not broken)', async () => {
    vi.stubEnv('VITE_SUPABASE_AUTH_ENABLED', 'true');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    seedLocalData();
    startApp('/');
    expect(await screen.findAllByRole('banner')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull(); // no entry point to a broken feature
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sdk.loaded).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('feature flag ON: local data is never touched', () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    enableAccounts();
    fake = createFakeSupabase();
    // The real client module runs; only the SDK it imports is replaced, and createClient hands back the fake.
    sdk.createClient.mockReturnValue(fake.client);
    const { resetSupabaseClientForTests } = await import('@/lib/supabase/client');
    resetSupabaseClientForTests();
  });

  const signIn = async (id: string, email: string) => act(async () => { fake.emit('SIGNED_IN', makeSession(id, email)); });

  it('creates exactly one client, with the validated project and the public key', async () => {
    startApp('/auth/sign-in');
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() => expect(sdk.createClient).toHaveBeenCalledTimes(1));
    const [url, key] = sdk.createClient.mock.calls[0] as unknown as [string, string];
    expect(url).toBe('https://placeholder-project.supabase.co');
    expect(key.split('.')).toHaveLength(3); // the public (anon-role) key, never anything else
  });

  it('signing in does not upload, change or reset local data', async () => {
    seedUser(fake, A, 'Asha');
    const before = seedLocalData();
    startApp('/account');
    await screen.findByRole('heading', { name: 'Sign in' });
    await signIn(A, 'asha@example.test');
    expect(await screen.findByText('Asha')).toBeTruthy();
    expect(snapshot()).toEqual(before);
    // Every table operation is a read of the two account tables: nothing about study data goes anywhere.
    expect(fake.tableCalls.every((c) => c.operation === 'select' && (c.table === 'profiles' || c.table === 'user_settings'))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('signing out does not delete or reset local data', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    const before = seedLocalData();
    const { user } = startApp('/account');
    await screen.findByText('Asha');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(snapshot()).toEqual(before);
    expect(useStudyStore.getState().settings.name).toBe('Local Tester');
  });

  it('a session that ends by itself (expiry, another tab) also leaves local data alone', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    const before = seedLocalData();
    startApp('/account');
    await screen.findByText('Asha');
    await act(async () => { fake.emit('SIGNED_OUT', null); });
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(snapshot()).toEqual(before);
  });

  it('switching accounts never shows the first account\'s profile, and never touches local data', async () => {
    seedUser(fake, A, 'Asha');
    seedUser(fake, B, 'Bharat');
    fake.initialSession = makeSession(A, 'asha@example.test');
    const before = seedLocalData();
    startApp('/account');
    await screen.findByText('Asha');
    const release = fake.holdProfileFor(B);
    await signIn(B, 'bharat@example.test'); // switch accounts without signing out first
    expect(document.body.textContent).not.toContain('Asha');
    expect(document.body.textContent).not.toContain('asha@example.test');
    release();
    expect(await screen.findByText('Bharat')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Asha');
    expect(snapshot()).toEqual(before);
  });

  it('keeps local study data separate from account data: the account page shows the account\'s settings, not the local ones', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    seedLocalData(); // local daily target is 7 hours; the account row says 8
    startApp('/account');
    await screen.findByText('Asha');
    expect(document.body.textContent).toContain('8 h daily target');
    expect(useStudyStore.getState().settings.dailyTargetHours).toBe(7);
  });

  it('the existing dashboard keeps working while signed in', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    startApp('/');
    expect(await screen.findByText(/Good (morning|afternoon|evening)/)).toBeTruthy();
  });
});

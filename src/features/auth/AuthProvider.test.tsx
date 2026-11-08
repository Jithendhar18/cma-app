import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, ENABLED_CONFIG, makeSession, seedUser, type FakeSupabase } from '@/test/fakeSupabase';

const client = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/supabase/client')>()), getSupabaseClient: client.getSupabaseClient }));

import { AuthProvider } from './AuthProvider';
import { useAuth } from './authContext';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Renders the auth state as text so tests can read it. */
function Probe() {
  const { state, signOut, reloadAccount, retry } = useAuth();
  const account = state.status === 'signed-in' ? state.account : null;
  return (
    <div>
      <p data-testid="status">{state.status}</p>
      <p data-testid="ended">{state.status === 'signed-out' ? `${state.endedUnexpectedly}/${state.byUser}` : ''}</p>
      <p data-testid="user">{state.status === 'signed-in' ? state.user.id : ''}</p>
      <p data-testid="phase">{account?.phase ?? ''}</p>
      <p data-testid="name">{account?.phase === 'ready' ? account.profile.displayName : ''}</p>
      <p data-testid="failure">{account?.phase === 'error' ? account.failure : ''}</p>
      <button onClick={() => void signOut()}>sign-out</button>
      <button onClick={reloadAccount}>reload</button>
      <button onClick={retry}>retry</button>
    </div>
  );
}
const status = () => screen.getByTestId('status').textContent;
const name = () => screen.getByTestId('name').textContent;

let fake: FakeSupabase;
beforeEach(() => {
  fake = createFakeSupabase();
  client.getSupabaseClient.mockReset();
  client.getSupabaseClient.mockResolvedValue(fake.client);
});
afterEach(() => {
  cleanup(); // this repo does not enable Vitest globals, so Testing Library cannot clean up by itself
  vi.useRealTimers();
});

const mount = (config = ENABLED_CONFIG) => render(<AuthProvider config={config}><Probe /></AuthProvider>);

describe('accounts disabled or misconfigured', () => {
  it('does nothing at all when disabled: no client, no listener, no timer', async () => {
    const timers = vi.spyOn(window, 'setTimeout');
    mount({ status: 'disabled' } as never);
    expect(status()).toBe('disabled');
    await act(async () => { await Promise.resolve(); });
    expect(client.getSupabaseClient).not.toHaveBeenCalled();
    expect(fake.listenerCount()).toBe(0);
    expect(timers).not.toHaveBeenCalled();
  });

  it('shows misconfigured without creating a client', async () => {
    mount({ status: 'misconfigured', problem: 'missing-key' } as never);
    expect(status()).toBe('misconfigured');
    await act(async () => { await Promise.resolve(); });
    expect(client.getSupabaseClient).not.toHaveBeenCalled();
  });
});

describe('restoring the session', () => {
  it('stays "initializing" until the SDK reports, so nothing redirects early', async () => {
    client.getSupabaseClient.mockReturnValue(new Promise(() => undefined)); // never resolves
    mount();
    expect(status()).toBe('initializing');
  });

  it('becomes signed-out when there is no stored session (and that is not an expiry)', async () => {
    mount();
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(screen.getByTestId('ended').textContent).toBe('false/false');
  });

  it('restores a stored session and then loads the profile and settings', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
    expect(status()).toBe('signed-in');
    expect(name()).toBe('Asha');
  });

  it('only ever reads the two account tables (never inserts a profile or settings)', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
    expect(fake.tableCalls.map((c) => c.operation)).toEqual(['select', 'select']);
    expect(new Set(fake.tableCalls.map((c) => c.table))).toEqual(new Set(['profiles', 'user_settings']));
  });

  it('reports a start-up failure as an error that can be retried', async () => {
    client.getSupabaseClient.mockRejectedValueOnce(new Error('chunk failed to load'));
    mount();
    await waitFor(() => expect(status()).toBe('error'));
    client.getSupabaseClient.mockResolvedValue(fake.client);
    await act(async () => { screen.getByText('retry').click(); });
    await waitFor(() => expect(status()).toBe('signed-out'));
  });

  it('does not spin forever: gives up after the watchdog and reports an error', async () => {
    vi.useFakeTimers();
    client.getSupabaseClient.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(status()).toBe('initializing');
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(status()).toBe('error');
  });
});

describe('profile and settings loading', () => {
  it('shows an explicit "loading" phase first', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    const release = fake.holdProfileFor(A);
    mount();
    await waitFor(() => expect(status()).toBe('signed-in'));
    expect(screen.getByTestId('phase').textContent).toBe('loading');
    release();
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
  });

  it('reports a missing profile as a recoverable state, and never creates one', async () => {
    fake.settings.set(A, { daily_target_hours: 8 });
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('incomplete'));
    expect(fake.tableCalls.every((c) => c.operation === 'select')).toBe(true);
    // The profile appears (the trigger finished): reloading recovers.
    seedUser(fake, A, 'Asha');
    await act(async () => { screen.getByText('reload').click(); });
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
  });

  it('survives a temporary failure and recovers on retry', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    fake.failTablesWith({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' });
    mount();
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('error'));
    expect(screen.getByTestId('failure').textContent).toBe('network');
    expect(status()).toBe('signed-in'); // still signed in: only the profile load failed
    fake.failTablesWith(null);
    await act(async () => { screen.getByText('reload').click(); });
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
  });

  it('does not reload the profile on a token refresh or a user update', async () => {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
    const callsBefore = fake.tableCalls.length;
    await act(async () => { fake.emit('TOKEN_REFRESHED', makeSession(A, 'asha@example.test')); fake.emit('USER_UPDATED', makeSession(A, 'asha@example.test')); });
    expect(screen.getByTestId('phase').textContent).toBe('ready');
    expect(fake.tableCalls.length).toBe(callsBefore);
  });
});

describe('ending the session', () => {
  async function signedInAsAsha() {
    seedUser(fake, A, 'Asha');
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(name()).toBe('Asha'));
  }

  it('handles a sign-out in another tab: signed-out, reported as unexpected, profile gone from memory', async () => {
    await signedInAsAsha();
    await act(async () => { fake.emit('SIGNED_OUT', null); }); // the SDK relays another tab's sign-out like this
    expect(status()).toBe('signed-out');
    expect(screen.getByTestId('ended').textContent).toBe('true/false');
    expect(document.body.textContent).not.toContain('Asha');
  });

  it('handles session expiry the same way', async () => {
    await signedInAsAsha();
    await act(async () => { fake.emit('SIGNED_OUT', null); });
    expect(screen.getByTestId('ended').textContent).toBe('true/false');
  });

  it('records a deliberate sign-out as the user\'s choice and clears the profile', async () => {
    await signedInAsAsha();
    await act(async () => { screen.getByText('sign-out').click(); });
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('ended').textContent).toBe('false/true');
    expect(document.body.textContent).not.toContain('Asha');
  });

  it('stays signed in, and says nothing was cleared, if sign-out fails', async () => {
    await signedInAsAsha();
    fake.auth.signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    await act(async () => { screen.getByText('sign-out').click(); });
    expect(status()).toBe('signed-in');
    expect(name()).toBe('Asha');
    // A later genuine expiry must still be reported as unexpected, because the failed attempt did not stick.
    await act(async () => { fake.emit('SIGNED_OUT', null); });
    expect(screen.getByTestId('ended').textContent).toBe('true/false');
  });
});

describe('switching between users', () => {
  it('never shows the previous user\'s profile for the next user', async () => {
    seedUser(fake, A, 'Asha');
    seedUser(fake, B, 'Bharat');
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(name()).toBe('Asha'));
    const release = fake.holdProfileFor(B); // hold B's load open, so we can look at the moment in between
    await act(async () => { fake.emit('SIGNED_IN', makeSession(B, 'bharat@example.test')); });
    expect(screen.getByTestId('user').textContent).toBe(B);
    expect(screen.getByTestId('phase').textContent).toBe('loading');
    expect(document.body.textContent).not.toContain('Asha'); // A is gone the instant B is current
    release();
    await waitFor(() => expect(name()).toBe('Bharat'));
  });

  it('discards a slow answer for the old user that arrives after the new user is current', async () => {
    seedUser(fake, A, 'Asha');
    seedUser(fake, B, 'Bharat');
    const releaseA = fake.holdProfileFor(A);
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(status()).toBe('signed-in')); // A's profile request is still in flight
    await act(async () => { fake.emit('SIGNED_IN', makeSession(B, 'bharat@example.test')); });
    await waitFor(() => expect(name()).toBe('Bharat'));
    releaseA(); // A's answer finally arrives, out of order
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(name()).toBe('Bharat');
    expect(document.body.textContent).not.toContain('Asha');
  });

  it('also discards an answer that arrives after sign-out', async () => {
    seedUser(fake, A, 'Asha');
    const release = fake.holdProfileFor(A);
    fake.initialSession = makeSession(A, 'asha@example.test');
    mount();
    await waitFor(() => expect(status()).toBe('signed-in'));
    await act(async () => { fake.emit('SIGNED_OUT', null); });
    release();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(status()).toBe('signed-out');
    expect(document.body.textContent).not.toContain('Asha');
  });
});

describe('cleanup', () => {
  it('unsubscribes from auth events when it unmounts', async () => {
    const view = mount();
    await waitFor(() => expect(fake.listenerCount()).toBe(1));
    view.unmount();
    expect(fake.listenerCount()).toBe(0);
  });

  it('does not leak a listener when React StrictMode runs the effect twice', async () => {
    const { StrictMode } = await import('react');
    render(<StrictMode><AuthProvider config={ENABLED_CONFIG}><Probe /></AuthProvider></StrictMode>);
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(fake.listenerCount()).toBe(1);
  });
});

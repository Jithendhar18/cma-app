import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, makeSession, seedUser, type FakeSupabase } from '@/test/fakeSupabase';
import { enableAccounts, startApp } from '@/test/appHarness';
import { resetLinkCacheForTests } from './pkceCallback';

const client = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/supabase/client')>()), getSupabaseClient: client.getSupabaseClient }));

const A = '11111111-1111-4111-8111-111111111111';
const apiError = (code: string, status = 400) => ({ name: 'AuthApiError', code, status, message: 'internal detail that must not reach the user' });

let fake: FakeSupabase;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake = createFakeSupabase();
  client.getSupabaseClient.mockReset();
  client.getSupabaseClient.mockResolvedValue(fake.client);
  resetLinkCacheForTests();
  enableAccounts();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  // No screen may make a network request of its own: every call goes through the (faked) SDK.
  expect(fetchSpy).not.toHaveBeenCalled();
});

const signedInAs = (name = 'Asha') => {
  seedUser(fake, A, name);
  fake.initialSession = makeSession(A, 'asha@example.test');
};
const fill = async (user: ReturnType<typeof startApp>['user'], label: string | RegExp, value: string) => {
  const field = await screen.findByLabelText(label);
  await user.clear(field);
  if (value) await user.type(field, value);
};

describe('registration', () => {
  it('shows field-level errors and sends nothing when the form is empty', async () => {
    const { user } = startApp('/auth/sign-up');
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter the name you want to see in the app.')).toBeTruthy();
    expect(screen.getByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Use at least 10 characters.')).toBeTruthy();
    expect(fake.auth.signUp).not.toHaveBeenCalled();
    expect((await screen.findByLabelText('Display name')).getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects a malformed email, a short password and a mismatch, each on its own field', async () => {
    const { user } = startApp('/auth/sign-up');
    await fill(user, 'Display name', 'Asha');
    await fill(user, 'Email', 'not-an-email');
    await fill(user, 'Password', 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address, like name@example.com.')).toBeTruthy();
    expect(screen.getByText('Use at least 10 characters.')).toBeTruthy();
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'a long enough password');
    await fill(user, 'Confirm password', 'a different password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('The passwords do not match.')).toBeTruthy();
    expect(fake.auth.signUp).not.toHaveBeenCalled();
  });

  it('applies the byte rule to the registration password too', async () => {
    const { user } = startApp('/auth/sign-up');
    await fill(user, 'Display name', 'Asha');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'अ'.repeat(25));
    await fill(user, 'Confirm password', 'अ'.repeat(25));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/Use at most 72 bytes/)).toBeTruthy();
    expect(fake.auth.signUp).not.toHaveBeenCalled();
    await fill(user, 'Password', 'अ'.repeat(24));
    await fill(user, 'Confirm password', 'अ'.repeat(24));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect((fake.auth.signUp.mock.calls[0][0] as { password: string }).password).toBe('अ'.repeat(24));
  });

  it('registers with the display name in the metadata, then shows the confirmation-pending screen', async () => {
    const { user } = startApp('/auth/sign-up');
    await fill(user, 'Display name', '  Asha Rao ');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await fill(user, 'Confirm password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText('asha@example.test')).toBeTruthy();
    expect(screen.getByText(/until the address is confirmed/)).toBeTruthy();
    const options = (fake.auth.signUp.mock.calls[0][0] as { options: { data: unknown; emailRedirectTo: string } }).options;
    expect(options.data).toEqual({ display_name: 'Asha Rao' });
    expect(options.emailRedirectTo).toBe(`${window.location.origin}/auth/callback`);
    expect(fake.tableCalls).toEqual([]); // no profile or settings insert from the browser
  });

  it('can send the confirmation email again, then cools down', async () => {
    const { user } = startApp('/auth/sign-up');
    await fill(user, 'Display name', 'Asha');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await fill(user, 'Confirm password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.click(await screen.findByRole('button', { name: 'Send the email again' }));
    await waitFor(() => expect(fake.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'asha@example.test' })));
    expect(await screen.findByRole('button', { name: /Send again in \d+s/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send again in/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a plain message when the server refuses, and stays on the form', async () => {
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: apiError('weak_password') });
    const { user } = startApp('/auth/sign-up');
    await fill(user, 'Display name', 'Asha');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await fill(user, 'Confirm password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toContain('not strong enough');
    expect(document.body.textContent).not.toContain('internal detail');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('moves straight on when the project does not require email confirmation (does not assume it does)', async () => {
    const session = makeSession(A, 'asha@example.test');
    seedUser(fake, A, 'Asha');
    fake.auth.signUp.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { user: session.user, session }, error: null }; });
    const { user } = startApp('/auth/sign-up');
    await fill(user, 'Display name', 'Asha');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await fill(user, 'Confirm password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
  });

  it('links to sign-in and back to local mode', async () => {
    startApp('/auth/sign-up');
    expect((await screen.findByRole('link', { name: 'Sign in' })).getAttribute('href')).toBe('/auth/sign-in');
    expect(screen.getByRole('link', { name: /Continue in local mode/ }).getAttribute('href')).toBe('/');
  });
});

describe('sign-in', () => {
  it('validates before sending anything', async () => {
    const { user } = startApp('/auth/sign-in');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in and lands on the account screen with the profile loaded', async () => {
    seedUser(fake, A, 'Asha');
    const session = makeSession(A, 'asha@example.test');
    fake.auth.signInWithPassword.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { user: session.user, session }, error: null }; });
    const { user } = startApp('/auth/sign-in');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(await screen.findByText('Asha')).toBeTruthy();
  });

  it('shows a loading state and prevents a double submit', async () => {
    let finish!: () => void;
    fake.auth.signInWithPassword.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ data: {}, error: apiError('invalid_credentials') }); }));
    const { user } = startApp('/auth/sign-in');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish();
    await screen.findByRole('alert');
    expect(fake.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({ data: {}, error: apiError('invalid_credentials') });
    const { user } = startApp('/auth/sign-in');
    await fill(user, 'Email', 'known@example.test');
    await fill(user, 'Password', 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const first = (await screen.findByRole('alert')).textContent;
    await fill(user, 'Email', 'nobody@example.test');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(fake.auth.signInWithPassword).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toBe(first);
    expect(first).toBe('The email or password is not correct.');
  });

  it('offers to resend the confirmation email for an unconfirmed account', async () => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: apiError('email_not_confirmed') });
    const { user } = startApp('/auth/sign-in');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Confirm your email address first');
    await user.click(await screen.findByRole('button', { name: 'Send the email again' }));
    await waitFor(() => expect(fake.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ email: 'asha@example.test' })));
  });

  it('explains a network failure without technical detail', async () => {
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user } = startApp('/auth/sign-in');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toContain('Could not reach the server');
    expect(alert).not.toMatch(/TypeError|fetch/i);
  });

  it('can show and hide the password, and says so to assistive technology', async () => {
    const { user } = startApp('/auth/sign-in');
    const field = (await screen.findByLabelText('Password')) as HTMLInputElement;
    expect(field.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    expect(field.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('links to registration, password reset and local mode', async () => {
    startApp('/auth/sign-in');
    expect((await screen.findByRole('link', { name: 'Create an account' })).getAttribute('href')).toBe('/auth/sign-up');
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/auth/forgot-password');
    expect(screen.getByRole('link', { name: /Continue in local mode/ }).getAttribute('href')).toBe('/');
  });

  it('does not show the sign-in screen to someone who is already signed in', async () => {
    signedInAs();
    startApp('/auth/sign-in');
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('labels every field and announces errors', async () => {
    startApp('/auth/sign-in');
    for (const label of ['Email', 'Password']) expect(await screen.findByLabelText(label)).toBeTruthy();
    expect((await screen.findByLabelText('Email')).getAttribute('autocomplete')).toBe('email');
    expect((await screen.findByLabelText('Password')).getAttribute('autocomplete')).toBe('current-password');
  });
});

describe('password reset', () => {
  it('requests a reset and shows the same confirmation whether or not the address exists', async () => {
    const { user } = startApp('/auth/forgot-password');
    await fill(user, 'Email', 'nobody@example.test');
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: apiError('user_not_found', 404) });
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    const message = (await screen.findByRole('status')).textContent ?? '';
    expect(message).toContain('If an account exists for');
    expect(fake.auth.resetPasswordForEmail).toHaveBeenCalledWith('nobody@example.test', { redirectTo: `${window.location.origin}/auth/reset-password` });
  });

  it('validates the address and reports network trouble', async () => {
    const { user } = startApp('/auth/forgot-password');
    await fill(user, 'Email', 'nope');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address, like name@example.com.')).toBeTruthy();
    expect(fake.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    fake.auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await fill(user, 'Email', 'asha@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
  });

  it('finishes the PKCE link, then lets the person choose a new password', async () => {
    seedUser(fake, A, 'Asha');
    const session = makeSession(A, 'asha@example.test');
    fake.auth.exchangeCodeForSession.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { session, user: session.user }, error: null }; });
    const { user } = startApp('/auth/reset-password?code=one-time-code');
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(window.location.search).toBe(''); // the one-time code is removed from the address
    await fill(user, 'New password', 'a brand new password');
    await fill(user, 'Confirm new password', 'a brand new password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeTruthy();
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'a brand new password' });
    expect(screen.getByRole('link', { name: 'Go to your account' }).getAttribute('href')).toBe('/account');
  });

  it('exchanges the code once even though StrictMode would run the effect twice', async () => {
    const { StrictMode } = await import('react');
    const { render } = await import('@testing-library/react');
    const { default: App } = await import('@/App');
    const session = makeSession(A, 'asha@example.test');
    seedUser(fake, A, 'Asha');
    fake.auth.exchangeCodeForSession.mockImplementation(async () => { fake.emit('SIGNED_IN', session); return { data: { session, user: session.user }, error: null }; });
    window.history.pushState(null, '', '/auth/reset-password?code=strict-mode-code');
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('applies the byte and code-point rule on the new-password form', async () => {
    const session = makeSession(A, 'asha@example.test');
    seedUser(fake, A, 'Asha');
    fake.auth.exchangeCodeForSession.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { session, user: session.user }, error: null }; });
    const { user } = startApp('/auth/reset-password?code=multibyte');
    const tooLong = 'अ'.repeat(25); // 75 bytes: fewer than 72 characters, but too many bytes
    await fill(user, 'New password', tooLong);
    await fill(user, 'Confirm new password', tooLong);
    await user.click(await screen.findByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/Use at most 72 bytes/)).toBeTruthy();
    await fill(user, 'New password', '🔑'.repeat(9)); // 9 code points although .length is 18
    await fill(user, 'Confirm new password', '🔑'.repeat(9));
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeTruthy();
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
    await fill(user, 'New password', '🔑'.repeat(10));
    await fill(user, 'Confirm new password', '🔑'.repeat(10));
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeTruthy();
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: '🔑'.repeat(10) });
  });

  it('checks the new password length and match before sending', async () => {
    const session = makeSession(A, 'asha@example.test');
    seedUser(fake, A, 'Asha');
    fake.auth.exchangeCodeForSession.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { session, user: session.user }, error: null }; });
    const { user } = startApp('/auth/reset-password?code=c1');
    await fill(user, 'New password', 'short');
    await user.click(await screen.findByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeTruthy();
    await fill(user, 'New password', 'a brand new password');
    await fill(user, 'Confirm new password', 'something else entirely');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeTruthy();
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal of an unchanged password in plain words', async () => {
    const session = makeSession(A, 'asha@example.test');
    seedUser(fake, A, 'Asha');
    fake.auth.exchangeCodeForSession.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { session, user: session.user }, error: null }; });
    fake.auth.updateUser.mockResolvedValueOnce({ data: {}, error: apiError('same_password', 422) });
    const { user } = startApp('/auth/reset-password?code=c2');
    await fill(user, 'New password', 'the same old password');
    await fill(user, 'Confirm new password', 'the same old password');
    await user.click(await screen.findByRole('button', { name: 'Update password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('different from your current one');
  });

  it('handles an expired link', async () => {
    startApp('/auth/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(await screen.findByRole('heading', { name: 'We could not use this link' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('invalid, has expired, or has already been used');
    expect(screen.getByRole('link', { name: 'Request a new reset link' }).getAttribute('href')).toBe('/auth/forgot-password');
    expect(fake.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('handles a link that was already used (the server no longer knows the code)', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: apiError('flow_state_not_found', 404) });
    startApp('/auth/reset-password?code=already-used');
    expect(await screen.findByRole('heading', { name: 'We could not use this link' })).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('handles opening the page with no link at all', async () => {
    startApp('/auth/reset-password');
    expect(await screen.findByRole('heading', { name: 'We could not use this link' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('Open the reset link from your email');
  });
});

describe('the email confirmation callback', () => {
  it('confirms the address and continues to the account screen', async () => {
    seedUser(fake, A, 'Asha');
    const session = makeSession(A, 'asha@example.test');
    fake.auth.exchangeCodeForSession.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { session, user: session.user }, error: null }; });
    startApp('/auth/callback?code=confirm-code');
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('confirm-code');
  });

  it('explains an expired confirmation link and points to sign-in', async () => {
    startApp('/auth/callback?error=access_denied&error_code=otp_expired');
    expect(await screen.findByRole('heading', { name: 'We could not confirm your email' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'sign in' }).getAttribute('href')).toBe('/auth/sign-in');
  });

  it('asks for the same browser when the link is opened elsewhere', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthPKCECodeVerifierMissingError', status: 400, message: 'PKCE code verifier not found in storage.' } });
    startApp('/auth/callback?code=elsewhere');
    expect((await screen.findByRole('alert')).textContent).toContain('same browser');
  });
});

describe('the route guard', () => {
  it('does not redirect while the session is still being restored', async () => {
    client.getSupabaseClient.mockReturnValue(new Promise(() => undefined));
    startApp('/account');
    expect(await screen.findByRole('heading', { name: 'Checking your session…' })).toBeTruthy();
    expect(window.location.pathname).toBe('/account');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('keeps a signed-out visitor out of the account page and sends them to sign-in', async () => {
    startApp('/account');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(window.location.pathname).toBe('/auth/sign-in');
    expect(screen.queryByRole('heading', { name: 'Account' })).toBeNull();
  });

  it('returns a signed-out visitor to where they were going after they sign in', async () => {
    seedUser(fake, A, 'Asha');
    const session = makeSession(A, 'asha@example.test');
    fake.auth.signInWithPassword.mockImplementationOnce(async () => { fake.emit('SIGNED_IN', session); return { data: { user: session.user, session }, error: null }; });
    const { user } = startApp('/account');
    await fill(user, 'Email', 'asha@example.test');
    await fill(user, 'Password', 'correct horse battery');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(window.location.pathname).toBe('/account');
  });

  it('lets a signed-in user in', async () => {
    signedInAs();
    startApp('/account');
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeTruthy();
  });

  it('handles an expired session: back to sign-in, with an explanation', async () => {
    signedInAs();
    startApp('/account');
    await screen.findByText('Asha');
    await import('@testing-library/react').then(({ act }) => act(async () => { fake.emit('SIGNED_OUT', null); }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('Your session ended. Sign in again to continue.')).toBeTruthy();
  });

  it('never protects the existing local-mode pages', async () => {
    startApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(window.location.pathname).toBe('/settings');
  });
});

describe('the account screen', () => {
  it('shows the profile and settings, and says plainly that nothing is synchronised yet', async () => {
    signedInAs('Asha Rao');
    startApp('/account');
    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('asha@example.test')).toBeTruthy();
    expect(screen.getByText('Asia/Kolkata')).toBeTruthy();
    expect(screen.getByText('Signing in does not sync your progress yet.')).toBeTruthy();
    expect(screen.getByText(/stored only on this device/)).toBeTruthy();
    expect(screen.getByText(/Signing out does not delete it/)).toBeTruthy();
  });

  it('renders a hostile display name as plain text, never as markup', async () => {
    signedInAs('<img src=x onerror=alert(1)><script>alert(2)</script>');
    startApp('/account');
    const dd = await screen.findByText('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(dd).toBeTruthy();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('script:not([src])')).toBeNull();
  });

  it('shows a recoverable message when the profile is missing, with a way to retry', async () => {
    fake.settings.set(A, { daily_target_hours: 8 });
    fake.initialSession = makeSession(A, 'asha@example.test');
    const { user } = startApp('/account');
    expect((await screen.findByRole('alert')).textContent).toContain('Your account profile is not ready yet.');
    seedUser(fake, A, 'Asha');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Asha')).toBeTruthy();
  });

  it('shows a temporary failure as such and recovers', async () => {
    signedInAs();
    fake.failTablesWith({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' });
    const { user } = startApp('/account');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
    fake.failTablesWith(null);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Asha')).toBeTruthy();
  });

  it('signs out and returns to the app (local mode), not to a sign-in screen', async () => {
    signedInAs();
    const { user } = startApp('/account');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(document.body.textContent).not.toContain('asha@example.test');
  });

  it('reports a failed sign-out and stays signed in', async () => {
    signedInAs();
    fake.auth.signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    const { user } = startApp('/account');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect((await screen.findAllByRole('alert')).some((el) => el.textContent?.includes('Could not reach the server'))).toBe(true);
    expect(screen.getByText('Asha')).toBeTruthy();
  });

  it('offers import and deletion only behind explicit steps: no one-click delete, no file upload, no sync button', async () => {
    signedInAs();
    startApp('/account');
    await screen.findByText('Asha');
    // Since M9 this page has "Start the import", "Download my data" and "Delete my account…". Each must be an entry to a guarded flow:
    // nothing on the page itself deletes, uploads or syncs.
    const controls = [...document.querySelectorAll('main button, main a')].map((el) => el.textContent ?? '').join(' | ');
    expect(controls).toMatch(/Start the import/);
    expect(controls).toMatch(/Delete my account…/);
    expect(controls).not.toMatch(/Delete my account permanently|sync now|upload/i);
    expect(document.querySelector('main select')).toBeNull();
    expect(document.querySelector('main input[type="file"]')).toBeNull();
    // the destructive button does not exist until the confirmation dialog is open
    expect(screen.queryByRole('button', { name: 'Delete my account permanently' })).toBeNull();
  });
});

describe('the header entry', () => {
  it('offers "Sign in" to a signed-out visitor on the dashboard', async () => {
    startApp('/');
    const header = (await screen.findAllByRole('banner'))[0];
    await waitFor(() => expect(within(header).getByRole('link', { name: /Sign in/ }).getAttribute('href')).toBe('/auth/sign-in'));
  });
  it('offers the account link to a signed-in user', async () => {
    signedInAs();
    startApp('/');
    const header = (await screen.findAllByRole('banner'))[0];
    await waitFor(() => expect(within(header).getByRole('link', { name: 'Your account' }).getAttribute('href')).toBe('/account'));
  });
});

describe('a misconfigured build', () => {
  it('explains the problem on the sign-in screen without making any request', async () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    startApp('/auth/sign-in');
    expect(await screen.findByRole('heading', { name: 'Accounts are not set up' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('VITE_SUPABASE_ANON_KEY');
    expect(client.getSupabaseClient).not.toHaveBeenCalled();
  });
});

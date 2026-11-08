import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/test/fakeSupabase';
import { DISPLAY_NAME_METADATA_KEY, requestPasswordReset, resendConfirmation, signIn, signOut, signUp, updatePassword } from './authService';

let fake: FakeSupabase;
beforeEach(() => {
  fake = createFakeSupabase();
  vi.stubGlobal('location', { ...window.location, origin: 'https://app.example.test' });
});

const apiError = (code: string, status = 400) => ({ name: 'AuthApiError', code, status, message: 'internal detail that must not reach the user' });
const GOOD = { displayName: '  Asha Rao  ', email: '  asha@example.test ', password: 'correct horse battery' };

describe('signUp', () => {
  it('passes the display name under the exact metadata key the database trigger reads', async () => {
    expect(DISPLAY_NAME_METADATA_KEY).toBe('display_name'); // handle_new_user(): raw_user_meta_data ->> 'display_name'
    await signUp(fake.client, GOOD);
    expect(fake.auth.signUp).toHaveBeenCalledWith({
      email: 'asha@example.test',
      password: 'correct horse battery',
      options: { data: { display_name: 'Asha Rao' }, emailRedirectTo: 'https://app.example.test/auth/callback' },
    });
  });

  it('sends nothing but the display name as metadata (no way to smuggle other claims)', async () => {
    await signUp(fake.client, GOOD);
    const call = fake.auth.signUp.mock.calls[0][0] as { options: { data: Record<string, unknown> } };
    expect(Object.keys(call.options.data)).toEqual(['display_name']);
  });

  it('never writes a profile or settings row itself', async () => {
    await signUp(fake.client, GOOD);
    expect(fake.tableCalls).toEqual([]);
  });

  it('reports confirmation pending when there is no session (email confirmation is on)', async () => {
    expect(await signUp(fake.client, GOOD)).toEqual({ kind: 'confirmation-pending' });
  });

  it('does not assume sign-up always creates a session, but handles one when it does', async () => {
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'u' }, session: { access_token: 't' } }, error: null });
    expect(await signUp(fake.client, GOOD)).toEqual({ kind: 'signed-in' });
  });

  it('answers a duplicate address exactly like a new one (the server obfuscates it, and so do we)', async () => {
    // GoTrue returns a user with no session and no error for an existing address when confirmation is on.
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'u', identities: [] }, session: null }, error: null });
    expect(await signUp(fake.client, GOOD)).toEqual({ kind: 'confirmation-pending' });
  });

  it('uses neutral wording if a server does report a duplicate', async () => {
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: apiError('user_already_exists') });
    const result = await signUp(fake.client, GOOD);
    expect(result).toMatchObject({ kind: 'failed', failure: 'account-unavailable' });
    expect(JSON.stringify(result)).not.toMatch(/already registered|already exists|taken/i);
  });

  it('turns server errors into plain messages with no internals', async () => {
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: apiError('weak_password') });
    const result = await signUp(fake.client, GOOD);
    expect(result).toMatchObject({ kind: 'failed', failure: 'weak-password' });
    expect(JSON.stringify(result)).not.toContain('internal detail');
  });

  it('survives a thrown network failure', async () => {
    fake.auth.signUp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await signUp(fake.client, GOOD)).toMatchObject({ kind: 'failed', failure: 'network' });
  });

  it('refuses to send invalid input at all', async () => {
    for (const bad of [{ ...GOOD, email: 'nope' }, { ...GOOD, password: 'short' }, { ...GOOD, displayName: '  ' }, { ...GOOD, displayName: 'x'.repeat(81) }]) {
      expect(await signUp(fake.client, bad)).toMatchObject({ kind: 'failed' });
    }
    expect(fake.auth.signUp).not.toHaveBeenCalled();
  });

  it('applies the password rule in bytes and code points before anything is sent', async () => {
    const tooLongHindi = 'अ'.repeat(25); // 75 bytes
    const nineEmoji = '🔑'.repeat(9); // 9 code points, but .length is 18
    for (const password of [tooLongHindi, nineEmoji]) {
      expect(await signUp(fake.client, { ...GOOD, password })).toMatchObject({ kind: 'failed' });
      expect(await updatePassword(fake.client, password)).toMatchObject({ kind: 'failed' });
    }
    expect(fake.auth.signUp).not.toHaveBeenCalled();
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
    // and the same characters within the limits go through
    expect(await signUp(fake.client, { ...GOOD, password: 'अ'.repeat(24) })).toEqual({ kind: 'confirmation-pending' });
    expect(await updatePassword(fake.client, '🔑'.repeat(10))).toEqual({ kind: 'updated' });
  });

  it('always builds the redirect from the origin the page is running on (there is no override)', async () => {
    vi.stubGlobal('location', { ...window.location, origin: 'https://preview-123.vercel.app' });
    await signUp(fake.client, GOOD);
    expect((fake.auth.signUp.mock.calls[0][0] as { options: { emailRedirectTo: string } }).options.emailRedirectTo).toBe('https://preview-123.vercel.app/auth/callback');
  });
});

describe('signIn', () => {
  it('signs in with the trimmed email and the password exactly as typed', async () => {
    expect(await signIn(fake.client, { email: ' a@example.test ', password: ' pw with spaces ' })).toEqual({ kind: 'signed-in' });
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.test', password: ' pw with spaces ' });
  });

  it('gives wrong password and unknown email the same answer', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({ data: {}, error: apiError('invalid_credentials') });
    const result = await signIn(fake.client, { email: 'whoever@example.test', password: 'x' });
    expect(result).toMatchObject({ kind: 'failed', failure: 'invalid-credentials' });
    expect(result).toMatchObject({ message: 'The email or password is not correct.' });
  });

  it('reports an unconfirmed account (the server says so only after the password matched)', async () => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: apiError('email_not_confirmed') });
    expect(await signIn(fake.client, { email: 'a@example.test', password: 'x' })).toMatchObject({ failure: 'email-not-confirmed' });
  });

  it('reports network trouble and rate limits', async () => {
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await signIn(fake.client, { email: 'a@example.test', password: 'x' })).toMatchObject({ failure: 'network' });
    fake.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: apiError('over_request_rate_limit', 429) });
    expect(await signIn(fake.client, { email: 'a@example.test', password: 'x' })).toMatchObject({ failure: 'rate-limited' });
  });
});

describe('signOut', () => {
  it('signs out this device only', async () => {
    expect(await signOut(fake.client)).toEqual({ kind: 'signed-out' });
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('reports a failure instead of pretending it worked', async () => {
    fake.auth.signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    expect(await signOut(fake.client)).toMatchObject({ kind: 'failed', failure: 'network' });
  });
});

describe('resendConfirmation', () => {
  it('asks for a new signup email with the exact callback URL', async () => {
    expect(await resendConfirmation(fake.client, ' a@example.test ')).toEqual({ kind: 'sent' });
    expect(fake.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@example.test', options: { emailRedirectTo: 'https://app.example.test/auth/callback' } });
  });
  it('reports a rate limit', async () => {
    fake.auth.resend.mockResolvedValueOnce({ data: {}, error: apiError('over_email_send_rate_limit', 429) });
    expect(await resendConfirmation(fake.client, 'a@example.test')).toMatchObject({ failure: 'rate-limited' });
  });
});

describe('requestPasswordReset', () => {
  it('requests a reset with the exact reset URL', async () => {
    expect(await requestPasswordReset(fake.client, 'a@example.test')).toEqual({ kind: 'requested' });
    expect(fake.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.test', { redirectTo: 'https://app.example.test/auth/reset-password' });
  });
  it('says "requested" even if the server rejects the address, so the screen cannot reveal which addresses have accounts', async () => {
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: apiError('user_not_found', 404) });
    expect(await requestPasswordReset(fake.client, 'nobody@example.test')).toEqual({ kind: 'requested' });
  });
  it('still reports network trouble and rate limits, which say nothing about the address', async () => {
    fake.auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await requestPasswordReset(fake.client, 'a@example.test')).toMatchObject({ failure: 'network' });
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: apiError('over_email_send_rate_limit', 429) });
    expect(await requestPasswordReset(fake.client, 'a@example.test')).toMatchObject({ failure: 'rate-limited' });
  });
  it('does not call the server for an invalid address', async () => {
    expect(await requestPasswordReset(fake.client, 'nope')).toMatchObject({ kind: 'failed' });
    expect(fake.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('updatePassword', () => {
  it('updates the password of the current session', async () => {
    expect(await updatePassword(fake.client, 'a brand new password')).toEqual({ kind: 'updated' });
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'a brand new password' });
  });
  it('refuses a too-short password without calling the server', async () => {
    expect(await updatePassword(fake.client, 'short')).toMatchObject({ kind: 'failed', failure: 'weak-password' });
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
  });
  it('maps server answers: same password, weak password, missing session', async () => {
    for (const [error, failure] of [[apiError('same_password'), 'same-password'], [apiError('weak_password'), 'weak-password'], [{ name: 'AuthSessionMissingError', message: 'Auth session missing!' }, 'session-missing']] as const) {
      fake.auth.updateUser.mockResolvedValueOnce({ data: {}, error });
      expect(await updatePassword(fake.client, 'a brand new password')).toMatchObject({ failure });
    }
  });
});

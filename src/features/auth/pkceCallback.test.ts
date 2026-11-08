import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/test/fakeSupabase';
import { clearAuthLinkFromAddress, exchangeAuthLink, parseAuthLink, resetLinkCacheForTests } from './pkceCallback';

let fake: FakeSupabase;
beforeEach(() => {
  fake = createFakeSupabase();
  resetLinkCacheForTests();
});

describe('parseAuthLink', () => {
  it('reads the code from the query', () => expect(parseAuthLink('?code=abc123', '')).toEqual({ code: 'abc123', errorCode: null, hasError: false }));
  it('reads an error from the query or the fragment', () => {
    expect(parseAuthLink('?error=access_denied&error_code=otp_expired', '').hasError).toBe(true);
    expect(parseAuthLink('', '#error=access_denied&error_code=otp_expired&error_description=x')).toMatchObject({ hasError: true, errorCode: 'otp_expired' });
  });
  it('sees nothing in a plain address', () => expect(parseAuthLink('', '')).toEqual({ code: null, errorCode: null, hasError: false }));
});

describe('exchangeAuthLink', () => {
  it('exchanges the code for a session', async () => {
    expect(await exchangeAuthLink(fake.client, '?code=good', '')).toEqual({ kind: 'signed-in' });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('good');
  });

  it('exchanges a code only once, even if asked twice at the same moment (React StrictMode runs effects twice)', async () => {
    const [a, b] = await Promise.all([exchangeAuthLink(fake.client, '?code=once', ''), exchangeAuthLink(fake.client, '?code=once', '')]);
    expect(a).toEqual(b);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the address has no link', async () => {
    expect(await exchangeAuthLink(fake.client, '', '')).toEqual({ kind: 'no-link' });
    expect(fake.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('treats an error in the address as a failed link without calling the server', async () => {
    expect(await exchangeAuthLink(fake.client, '?error=access_denied&error_code=otp_expired', '')).toEqual({ kind: 'failed', reason: 'expired' });
    expect(await exchangeAuthLink(fake.client, '?error=access_denied', '')).toEqual({ kind: 'failed', reason: 'invalid' });
    expect(fake.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('reports an expired or already-used code', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthApiError', code: 'flow_state_not_found', status: 404, message: 'invalid flow state' } });
    expect(await exchangeAuthLink(fake.client, '?code=used', '')).toEqual({ kind: 'failed', reason: 'expired' });
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthApiError', code: 'validation_failed', status: 400, message: 'bad code' } });
    expect(await exchangeAuthLink(fake.client, '?code=garbage', '')).toEqual({ kind: 'failed', reason: 'invalid' });
  });

  it('explains when the link is opened in a different browser (the PKCE verifier is missing there)', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthPKCECodeVerifierMissingError', status: 400, message: 'PKCE code verifier not found in storage.' } });
    expect(await exchangeAuthLink(fake.client, '?code=elsewhere', '')).toEqual({ kind: 'failed', reason: 'other-browser' });
  });

  it('reports network failure, whether returned or thrown', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    expect(await exchangeAuthLink(fake.client, '?code=n1', '')).toEqual({ kind: 'failed', reason: 'network' });
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await exchangeAuthLink(fake.client, '?code=n2', '')).toEqual({ kind: 'failed', reason: 'network' });
  });
});

describe('clearAuthLinkFromAddress', () => {
  it('removes the one-time code from the visible address', () => {
    window.history.pushState(null, '', '/auth/reset-password?code=secret-one-time-code#frag');
    clearAuthLinkFromAddress();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/auth/reset-password');
  });
});

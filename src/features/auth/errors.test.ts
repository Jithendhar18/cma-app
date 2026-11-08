import { describe, expect, it } from 'vitest';
import { classifyAuthError, failureMessage, type AuthFailure } from './errors';

const api = (code: string, status = 400, name = 'AuthApiError', message = 'x') => ({ name, code, status, message });

describe('classifyAuthError', () => {
  const cases: Array<[string, unknown, AuthFailure]> = [
    ['wrong credentials', api('invalid_credentials'), 'invalid-credentials'],
    ['unconfirmed email', api('email_not_confirmed'), 'email-not-confirmed'],
    ['rate limit by code', api('over_request_rate_limit', 429), 'rate-limited'],
    ['email send limit', api('over_email_send_rate_limit', 429), 'rate-limited'],
    ['rate limit by status', { name: 'AuthApiError', status: 429, message: '' }, 'rate-limited'],
    ['weak password', api('weak_password'), 'weak-password'],
    ['weak password by class', { name: 'AuthWeakPasswordError', message: '' }, 'weak-password'],
    ['same password', api('same_password'), 'same-password'],
    ['expired link', api('otp_expired'), 'link-expired'],
    ['expired flow state', api('flow_state_expired'), 'link-expired'],
    ['missing session', { name: 'AuthSessionMissingError', message: 'Auth session missing!' }, 'session-missing'],
    ['bad token', api('bad_jwt', 401), 'session-missing'],
    ['sign-up closed', api('signup_disabled'), 'signup-closed'],
    ['duplicate account', api('user_already_exists'), 'account-unavailable'],
    ['duplicate email', api('email_exists'), 'account-unavailable'],
    ['SDK network error', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'network'],
    ['fetch TypeError', new TypeError('Failed to fetch'), 'network'],
    ['status 0', { status: 0, message: '' }, 'network'],
    ['browser offline text', { message: 'NetworkError when attempting to fetch resource.' }, 'network'],
    ['something unexpected', api('database_error', 500), 'unknown'],
    ['null', null, 'unknown'],
    ['a string', 'boom', 'unknown'],
    ['an empty object', {}, 'unknown'],
  ];
  for (const [label, error, expected] of cases) it(label, () => expect(classifyAuthError(error)).toBe(expected));
});

describe('failureMessage', () => {
  const all: AuthFailure[] = ['invalid-credentials', 'email-not-confirmed', 'rate-limited', 'network', 'weak-password', 'same-password', 'link-expired', 'session-missing', 'signup-closed', 'account-unavailable', 'unexpected-data', 'unknown'];

  it('has a plain message for every failure', () => {
    for (const f of all) expect(failureMessage(f).length, f).toBeGreaterThan(15);
  });

  it('never exposes technical detail', () => {
    for (const f of all) expect(failureMessage(f), f).not.toMatch(/\b(40[0-9]|50[0-9]|jwt|postgres|sql|stack|exception|supabase|gotrue|row level|rls|undefined|null)\b/i);
  });

  it('does not reveal whether an address has an account', () => {
    // Wrong password and unknown email are the same failure and the same words.
    expect(failureMessage('invalid-credentials')).not.toMatch(/no account|not registered|does not exist|unknown (user|email)|already (registered|exists|have)/i);
    // The neutral sign-up message must not confirm the account exists either.
    expect(failureMessage('account-unavailable')).not.toMatch(/already (registered|exists)|is taken/i);
  });
});

/**
 * Turns whatever the SDK throws or returns into one of a few kinds the screens can explain in plain language.
 *
 * Two rules:
 *   - A user never sees a stack trace, a status code or raw server text. Unknown errors become one generic message.
 *   - No message confirms whether an address belongs to an account. Wrong password and unknown email read the same,
 *     because the server itself returns the same error for both.
 */

export type AuthFailure =
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'rate-limited'
  | 'network'
  | 'weak-password'
  | 'same-password'
  | 'link-expired'
  | 'session-missing'
  | 'signup-closed'
  | 'account-unavailable'
  | 'unexpected-data'
  | 'unknown';

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
}

const asLike = (error: unknown): ErrorLike => (typeof error === 'object' && error !== null ? (error as ErrorLike) : {});

export function classifyAuthError(error: unknown): AuthFailure {
  if (error instanceof TypeError) return 'network'; // fetch() rejects with a TypeError when the network is down
  const e = asLike(error);
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  if (name === 'AuthRetryableFetchError' || status === 0 || /failed to fetch|networkerror|network request failed|load failed/.test(message)) return 'network';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || code === 'over_sms_send_rate_limit' || status === 429) return 'rate-limited';
  if (code === 'invalid_credentials') return 'invalid-credentials';
  if (code === 'email_not_confirmed') return 'email-not-confirmed';
  if (code === 'weak_password' || name === 'AuthWeakPasswordError') return 'weak-password';
  if (code === 'same_password') return 'same-password';
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'flow_state_not_found') return 'link-expired';
  if (name === 'AuthSessionMissingError' || code === 'session_not_found' || code === 'session_expired' || code === 'bad_jwt') return 'session-missing';
  if (code === 'signup_disabled') return 'signup-closed';
  if (code === 'user_already_exists' || code === 'email_exists') return 'account-unavailable';
  return 'unknown';
}

export function failureMessage(failure: AuthFailure): string {
  switch (failure) {
    case 'invalid-credentials':
      return 'The email or password is not correct.';
    case 'email-not-confirmed':
      return 'Confirm your email address first. Check your inbox for the confirmation link, or send a new one below.';
    case 'rate-limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'network':
      return 'Could not reach the server. Check your connection and try again.';
    case 'weak-password':
      return 'That password is not strong enough. Try a longer one that is harder to guess.';
    case 'same-password':
      return 'Choose a password that is different from your current one.';
    case 'link-expired':
      return 'This link has expired or has already been used. Request a new one.';
    case 'session-missing':
      return 'Your session has ended. Sign in again to continue.';
    case 'signup-closed':
      return 'New registrations are not open right now.';
    case 'account-unavailable':
      return 'We could not create this account. If you already have one, sign in or reset your password.';
    case 'unexpected-data':
      return 'We received something we did not expect. Try again in a moment.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}

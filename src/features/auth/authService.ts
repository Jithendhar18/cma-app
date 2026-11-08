import type { AppSupabaseClient } from '@/lib/supabase/client';
import { authRedirectUrls } from '@/lib/supabase/config';
import { classifyAuthError, failureMessage, type AuthFailure } from './errors';
import { normaliseEmail, validateDisplayName, validateEmail, validatePassword } from './validation';

/**
 * Every call to Supabase Auth lives here. Each function returns a typed result and never throws at the screen: a failure
 * is data (`kind: 'failed'`) carrying a plain-language message.
 *
 * The client never writes a profile or a settings row. The database trigger `handle_new_user()` creates both when the auth
 * user is created, reading the display name from the sign-up metadata key `display_name`.
 */

export const DISPLAY_NAME_METADATA_KEY = 'display_name';

export type Failed = { kind: 'failed'; failure: AuthFailure; message: string };
const failed = (failure: AuthFailure): Failed => ({ kind: 'failed', failure, message: failureMessage(failure) });

// Always the origin this page is running on: the PKCE verifier lives in this browser's storage for this origin only.
const redirects = () => authRedirectUrls(typeof window === 'undefined' ? '' : window.location.origin);

export type SignUpResult = { kind: 'signed-in' } | { kind: 'confirmation-pending' } | Failed;

export async function signUp(
  client: AppSupabaseClient,
  input: { displayName: string; email: string; password: string },
): Promise<SignUpResult> {
  // Re-validate here as well as in the form: this is the last line before the network.
  if (validateDisplayName(input.displayName) || validateEmail(input.email) || validatePassword(input.password)) return failed('unknown');
  try {
    const { data, error } = await client.auth.signUp({
      email: normaliseEmail(input.email),
      password: input.password,
      options: {
        data: { [DISPLAY_NAME_METADATA_KEY]: input.displayName.trim() },
        emailRedirectTo: redirects().callback,
      },
    });
    if (error) return failed(classifyAuthError(error));
    // With email confirmation on there is no session yet. When the address is already registered the server answers exactly
    // as it does for a new one, so the screen cannot be used to discover which addresses have accounts.
    return data.session ? { kind: 'signed-in' } : { kind: 'confirmation-pending' };
  } catch (error) {
    return failed(classifyAuthError(error));
  }
}

export type SignInResult = { kind: 'signed-in' } | Failed;

export async function signIn(client: AppSupabaseClient, input: { email: string; password: string }): Promise<SignInResult> {
  try {
    const { error } = await client.auth.signInWithPassword({ email: normaliseEmail(input.email), password: input.password });
    return error ? failed(classifyAuthError(error)) : { kind: 'signed-in' };
  } catch (error) {
    return failed(classifyAuthError(error));
  }
}

export type SignOutResult = { kind: 'signed-out' } | Failed;

/** Signs this browser out. Other devices stay signed in; every tab here is covered because they share one stored session. */
export async function signOut(client: AppSupabaseClient): Promise<SignOutResult> {
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    return error ? failed(classifyAuthError(error)) : { kind: 'signed-out' };
  } catch (error) {
    return failed(classifyAuthError(error));
  }
}

export type ResendResult = { kind: 'sent' } | Failed;

export async function resendConfirmation(client: AppSupabaseClient, email: string): Promise<ResendResult> {
  if (validateEmail(email)) return failed('unknown');
  try {
    const { error } = await client.auth.resend({
      type: 'signup',
      email: normaliseEmail(email),
      options: { emailRedirectTo: redirects().callback },
    });
    return error ? failed(classifyAuthError(error)) : { kind: 'sent' };
  } catch (error) {
    return failed(classifyAuthError(error));
  }
}

export type ResetRequestResult = { kind: 'requested' } | Failed;

/**
 * Asks for a reset email. The server answers the same whether or not the address has an account, and so does this screen:
 * only network trouble and rate limits are reported, because those say nothing about the address.
 */
export async function requestPasswordReset(client: AppSupabaseClient, email: string): Promise<ResetRequestResult> {
  if (validateEmail(email)) return failed('unknown');
  try {
    const { error } = await client.auth.resetPasswordForEmail(normaliseEmail(email), { redirectTo: redirects().reset });
    if (!error) return { kind: 'requested' };
    const failure = classifyAuthError(error);
    return failure === 'network' || failure === 'rate-limited' ? failed(failure) : { kind: 'requested' };
  } catch (error) {
    const failure = classifyAuthError(error);
    return failure === 'network' || failure === 'rate-limited' ? failed(failure) : { kind: 'requested' };
  }
}

export type UpdatePasswordResult = { kind: 'updated' } | Failed;

export async function updatePassword(client: AppSupabaseClient, password: string): Promise<UpdatePasswordResult> {
  if (validatePassword(password)) return failed('weak-password');
  try {
    const { error } = await client.auth.updateUser({ password });
    return error ? failed(classifyAuthError(error)) : { kind: 'updated' };
  } catch (error) {
    return failed(classifyAuthError(error));
  }
}

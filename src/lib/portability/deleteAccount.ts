import { signIn } from '@/features/auth/authService';
import type { AppSupabaseClient } from '@/lib/supabase/client';

/**
 * Permanent account deletion, through the database's own guarded function `delete_my_account()`. There is no other path: no admin API, no
 * privileged credential, no direct deletes. The function refuses unless the user proved their password within the last five minutes, so
 * this first asks the server to verify the password (a fresh sign-in), and only then calls it.
 *
 * Nothing here signs the user out or reports success on its own: the result is `deleted` only when the server's answer says so.
 */
export const DELETE_PHRASE = 'DELETE MY ACCOUNT';

export type DeleteResult =
  | { kind: 'deleted' }
  | { kind: 'failed'; reason: 'wrong-password' | 'recent-auth' | 'signed-out' | 'network' | 'rate-limited' | 'refused'; message: string };

const failed = (reason: Extract<DeleteResult, { kind: 'failed' }>['reason'], message: string): DeleteResult => ({ kind: 'failed', reason, message });

export async function deleteAccount(client: AppSupabaseClient, input: { email: string; password: string; phrase: string }): Promise<DeleteResult> {
  // The phrase is checked here as well as in the form: this is the last line before anything is sent.
  if (input.phrase.trim() !== DELETE_PHRASE) return failed('refused', `Type ${DELETE_PHRASE} exactly to confirm.`);
  if (input.password.length === 0) return failed('wrong-password', 'Enter your password to confirm.');

  const auth = await signIn(client, { email: input.email, password: input.password });
  if (auth.kind === 'failed') {
    if (auth.failure === 'invalid-credentials') return failed('wrong-password', 'That password is not correct. Nothing was deleted.');
    if (auth.failure === 'network') return failed('network', 'Could not reach the server. Nothing was deleted. Check your connection and try again.');
    if (auth.failure === 'rate-limited') return failed('rate-limited', 'Too many attempts. Wait a moment and try again. Nothing was deleted.');
    return failed('refused', `${auth.message} Nothing was deleted.`);
  }

  try {
    const { error } = await client.rpc('delete_my_account');
    if (!error) return { kind: 'deleted' };
    const e = error as { code?: string; hint?: string; message?: string };
    if (e.code === 'P0401' || e.hint === 'REAUTHENTICATE') return failed('recent-auth', 'For your safety the server needs a fresh password sign-in. Enter your password again. Nothing was deleted.');
    if (e.code === '28000') return failed('signed-out', 'Your session has ended. Sign in again, then retry. Nothing was deleted.');
    if (/failed to fetch|network/i.test(e.message ?? '')) return failed('network', 'Could not reach the server. Nothing was deleted. Check your connection and try again.');
    return failed('refused', 'The server did not delete the account. Nothing was deleted. Try again, or contact support if this continues.');
  } catch {
    return failed('network', 'Could not reach the server. Nothing was deleted. Check your connection and try again.');
  }
}

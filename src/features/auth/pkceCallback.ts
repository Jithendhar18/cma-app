import type { AppSupabaseClient } from '@/lib/supabase/client';
import { classifyAuthError } from './errors';

/**
 * Finishes an email link (confirm email, reset password) using the PKCE flow.
 *
 * The link brings the browser back with `?code=...` (or an error in the query or the fragment). The SDK is configured not
 * to read the address bar itself, so exactly one place does it: this function. A code can be exchanged only once, and React
 * StrictMode runs effects twice in development, so results are cached per code: the second call gets the first call's answer.
 */

export type LinkResult =
  | { kind: 'signed-in' }
  | { kind: 'no-link' }
  | { kind: 'failed'; reason: 'expired' | 'invalid' | 'other-browser' | 'network' };

const results = new Map<string, Promise<LinkResult>>();

interface ParsedLink {
  code: string | null;
  errorCode: string | null;
  hasError: boolean;
}

export function parseAuthLink(search: string, hash: string): ParsedLink {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const pick = (name: string) => query.get(name) ?? fragment.get(name);
  const error = pick('error');
  const errorCode = pick('error_code');
  return { code: query.get('code'), errorCode, hasError: error !== null || errorCode !== null };
}

export function exchangeAuthLink(client: AppSupabaseClient, search: string, hash: string): Promise<LinkResult> {
  const link = parseAuthLink(search, hash);
  if (link.hasError) {
    return Promise.resolve({ kind: 'failed', reason: link.errorCode === 'otp_expired' ? 'expired' : 'invalid' });
  }
  if (!link.code) return Promise.resolve({ kind: 'no-link' });

  const existing = results.get(link.code);
  if (existing) return existing;

  const attempt = client.auth
    .exchangeCodeForSession(link.code)
    .then(({ error }): LinkResult => {
      if (!error) return { kind: 'signed-in' };
      const failure = classifyAuthError(error);
      if (failure === 'network') return { kind: 'failed', reason: 'network' };
      // The browser that asked for the email holds the PKCE verifier. Opening the link elsewhere cannot work.
      if (/code verifier/i.test(String((error as { message?: unknown }).message ?? ''))) return { kind: 'failed', reason: 'other-browser' };
      return { kind: 'failed', reason: failure === 'link-expired' ? 'expired' : 'invalid' };
    })
    .catch((): LinkResult => ({ kind: 'failed', reason: 'network' }));
  results.set(link.code, attempt);
  return attempt;
}

/** Removes the one-time code from the visible address once it has been used (or has failed). */
export function clearAuthLinkFromAddress(win: Pick<Window, 'history' | 'location'> = window): void {
  const { pathname } = win.location;
  win.history.replaceState(win.history.state, '', pathname);
}

/** Test helper. */
export function resetLinkCacheForTests(): void {
  results.clear();
}

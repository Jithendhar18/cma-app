/**
 * Reads and validates the browser-side Supabase configuration. Pure: it takes the environment as an argument, so it
 * can be tested without touching import.meta.env, and it never contacts the network.
 *
 * The three outcomes are deliberate:
 *   disabled       the feature flag is not exactly "true": local mode, nothing is created, no request is ever made
 *   misconfigured  the flag is on but the settings are unusable or unsafe: a clear reason, still no client
 *   enabled        a validated URL and anonymous key
 *
 * Nothing here ever echoes the key. A reason names the problem, never the value.
 */

export type ConfigProblem =
  | 'missing-url'
  | 'invalid-url'
  | 'insecure-url'
  | 'missing-key'
  | 'unsupported-key';

export type AuthConfig =
  | { status: 'disabled' }
  | { status: 'misconfigured'; problem: ConfigProblem }
  | { status: 'enabled'; url: string; anonKey: string };

export interface RawEnv {
  VITE_SUPABASE_AUTH_ENABLED?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Only an exact "true" (any case, surrounding space ignored) enables accounts. "1", "yes" and typos do not. */
export function isFlagOn(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

/** An origin only (no path, query, fragment or credentials). https everywhere; plain http only for this machine. */
function parseOrigin(raw: string): { origin: string } | 'invalid' | 'insecure' {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'invalid';
  }
  if (url.username || url.password || url.search || url.hash) return 'invalid';
  if (url.pathname !== '/' && url.pathname !== '') return 'invalid';
  if (url.protocol === 'https:') return { origin: url.origin };
  if (url.protocol === 'http:') return LOCAL_HOSTS.has(url.hostname) ? { origin: url.origin } : 'insecure';
  return 'invalid';
}

/** Decodes a JWT payload without verifying it. Used only to recognise a public key; nothing is trusted from it. */
function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * An allowlist, not a denylist: only a key that is KNOWN to be public is accepted. That is a legacy anonymous JWT (whose role
 * claim is "anon") or a new-style publishable key. Anything else, including every privileged key and any format we do not
 * recognise, is refused, so a mistake can only fail closed.
 */
export function isPublicKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  return jwtRole(key) === 'anon';
}

export function readAuthConfig(env: RawEnv): AuthConfig {
  if (!isFlagOn(env.VITE_SUPABASE_AUTH_ENABLED)) return { status: 'disabled' };

  const rawUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  if (rawUrl === '') return { status: 'misconfigured', problem: 'missing-url' };
  const parsed = parseOrigin(rawUrl);
  if (parsed === 'invalid') return { status: 'misconfigured', problem: 'invalid-url' };
  if (parsed === 'insecure') return { status: 'misconfigured', problem: 'insecure-url' };

  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (key === '') return { status: 'misconfigured', problem: 'missing-key' };
  if (/\s/.test(key) || !isPublicKey(key)) return { status: 'misconfigured', problem: 'unsupported-key' };

  return { status: 'enabled', url: parsed.origin, anonKey: key };
}

export const CALLBACK_PATH = '/auth/callback';
export const RESET_PATH = '/auth/reset-password';

/**
 * The exact redirect URLs sent with email links. They are fixed paths on the origin the flow STARTED on (the page's own
 * `window.location.origin`), and there is deliberately no way to override that origin.
 *
 * Why: the PKCE verifier that completes the flow is stored in the initiating browser's localStorage, which is scoped to its
 * origin. A flow begun on a preview deployment whose email link returned to production could never be finished (the verifier is
 * not there), and an override would be a way to steer a sign-in flow to another origin. Fixed paths also let the hosted redirect
 * allow-list stay narrow and exact, with no wildcard.
 */
export function authRedirectUrls(locationOrigin: string): { callback: string; reset: string } {
  return { callback: `${locationOrigin}${CALLBACK_PATH}`, reset: `${locationOrigin}${RESET_PATH}` };
}

/** A human description of a configuration problem, for the screen shown when accounts are on but not set up. */
export function describeConfigProblem(problem: ConfigProblem): string {
  switch (problem) {
    case 'missing-url':
      return 'The Supabase URL (VITE_SUPABASE_URL) is not set.';
    case 'invalid-url':
      return 'The Supabase URL (VITE_SUPABASE_URL) is not a valid origin.';
    case 'insecure-url':
      return 'The Supabase URL must use https (plain http is allowed only for localhost).';
    case 'missing-key':
      return 'The anonymous key (VITE_SUPABASE_ANON_KEY) is not set.';
    case 'unsupported-key':
      return 'The key supplied is not a public anonymous key (a legacy anon key or an sb_publishable_ key). A privileged key must never be used in the browser.';
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { readAuthConfig, type AuthConfig } from './config';

export type AppSupabaseClient = SupabaseClient<Database>;

/**
 * The key the SDK stores its session under. Fixed and distinct from every key the local-mode stores use
 * (`cma-study-os`, `cma-study-os-timer`, `cma-study-os-ui`), so signing in or out can never touch local study data.
 */
export const AUTH_STORAGE_KEY = 'cma-study-os-auth';

let cached: { key: string; client: Promise<AppSupabaseClient> } | null = null;

/**
 * Returns the one Supabase client, or null when accounts are off or misconfigured.
 *
 * The SDK is loaded with a dynamic import, so with the feature flag off it is never downloaded, parsed or run, and no
 * request can be made. The client uses the browser PKCE flow, keeps the session in localStorage under AUTH_STORAGE_KEY,
 * and refreshes tokens itself. Email links are handled explicitly by the callback pages (see pkceCallback.ts), so the SDK
 * is told not to scan the address bar.
 */
export function getSupabaseClient(config: AuthConfig = readAuthConfig(import.meta.env)): Promise<AppSupabaseClient | null> {
  if (config.status !== 'enabled') return Promise.resolve(null);
  const key = `${config.url}\n${config.anonKey}`;
  if (cached && cached.key === key) return cached.client;
  const client = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient<Database>(config.url, config.anonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: AUTH_STORAGE_KEY,
      },
    }),
  );
  // A failed import must not be cached forever: allow a later retry.
  client.catch(() => {
    if (cached?.client === client) cached = null;
  });
  cached = { key, client };
  return client;
}

/** Test helper: forget the cached client. */
export function resetSupabaseClientForTests(): void {
  cached = null;
}

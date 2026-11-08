/// <reference types="vite/client" />

/**
 * Every VITE_ variable is compiled into the public bundle, so none of these may ever be a secret.
 * The anonymous key is public by design: all authorisation is enforced by database permissions and row level security.
 */
interface ImportMetaEnv {
  /** "true" turns on account sign-in. Anything else (including unset) keeps the app in its local-only mode. */
  readonly VITE_SUPABASE_AUTH_ENABLED?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

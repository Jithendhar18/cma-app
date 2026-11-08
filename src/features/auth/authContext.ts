import { createContext, useContext } from 'react';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { AuthConfig } from '@/lib/supabase/config';
import type { AuthState } from './authState';
import type { SignOutResult } from './authService';

export interface AuthContextValue {
  state: AuthState;
  config: AuthConfig;
  /** The one Supabase client. Null while accounts are off, misconfigured or still starting. */
  client: AppSupabaseClient | null;
  signOut: () => Promise<SignOutResult>;
  /** Re-reads the profile and settings, for example after a temporary failure. */
  reloadAccount: () => void;
  /** Tries again after the session could not be checked. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}

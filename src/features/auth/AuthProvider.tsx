import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, type AppSupabaseClient } from '@/lib/supabase/client';
import { readAuthConfig, type AuthConfig } from '@/lib/supabase/config';
import { loadAccount } from './accountApi';
import { AuthContext, type AuthContextValue } from './authContext';
import { signOut as signOutService, type SignOutResult } from './authService';
import { authReducer, initialAuthState, type SessionUser } from './authState';

/** If the session cannot be checked within this long, say so instead of spinning forever. */
const INIT_TIMEOUT_MS = 15_000;

const toUser = (session: Session | null): SessionUser | null =>
  session ? { id: session.user.id, email: session.user.email ?? null } : null;

interface AuthProviderProps {
  children: ReactNode;
  /** Injected by tests. In the app it is read from the environment once. */
  config?: AuthConfig;
}

/**
 * Restores the session, follows every later change, and loads the signed-in user's profile and settings.
 *
 * With the feature flag off this does nothing at all: no client, no listener, no timer, no request. It also never touches the
 * local-mode stores, so signing in or out cannot reset, upload or delete local study data.
 */
export function AuthProvider({ children, config: injected }: AuthProviderProps) {
  const config = useMemo(() => injected ?? readAuthConfig(import.meta.env), [injected]);
  const [state, dispatch] = useReducer(authReducer, config, initialAuthState);
  const [client, setClient] = useState<AppSupabaseClient | null>(null);
  const [startNonce, setStartNonce] = useState(0);
  const [accountNonce, setAccountNonce] = useState(0);
  // Set just before the user asks to sign out, so the resulting SIGNED_OUT is not reported as "ended on its own".
  const userInitiatedSignOut = useRef(false);

  // ---- start: create the client, subscribe, and let INITIAL_SESSION report the restored session ------------------------------
  useEffect(() => {
    if (config.status !== 'enabled') return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const watchdog = window.setTimeout(() => dispatch({ type: 'init-failed' }), INIT_TIMEOUT_MS);

    getSupabaseClient(config)
      .then((created) => {
        if (cancelled || !created) return;
        setClient(created);
        // The callback only records the event. Awaiting Supabase calls inside it can deadlock the SDK, so loading happens in an effect.
        const { data } = created.auth.onAuthStateChange((_event, session) => {
          window.clearTimeout(watchdog);
          const user = toUser(session);
          dispatch({ type: 'session', user, userInitiated: userInitiatedSignOut.current });
          if (!user) userInitiatedSignOut.current = false;
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'init-failed' });
      });

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      unsubscribe?.();
    };
  }, [config, startNonce]);

  // ---- load the account whenever the signed-in user changes (not on token refreshes) -----------------------------------------
  const userId = state.status === 'signed-in' ? state.user.id : null;
  useEffect(() => {
    if (!client || !userId) return;
    let current = true;
    loadAccount(client, userId).then((load) => {
      // `current` covers this effect being replaced; the reducer also refuses a result for a different user.
      if (current) dispatch({ type: 'account-loaded', userId, load });
    });
    return () => {
      current = false;
    };
  }, [client, userId, accountNonce]);

  const signOut = useCallback(async (): Promise<SignOutResult> => {
    if (!client) return { kind: 'failed', failure: 'unknown', message: 'Accounts are not available.' };
    userInitiatedSignOut.current = true;
    const result = await signOutService(client);
    if (result.kind === 'failed') userInitiatedSignOut.current = false;
    return result;
  }, [client]);

  const reloadAccount = useCallback(() => {
    dispatch({ type: 'account-reload' });
    setAccountNonce((n) => n + 1);
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: 'init-retry' });
    setStartNonce((n) => n + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, config, client, signOut, reloadAccount, retry }),
    [state, config, client, signOut, reloadAccount, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

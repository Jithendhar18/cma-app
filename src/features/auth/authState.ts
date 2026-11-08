import type { AuthConfig, ConfigProblem } from '@/lib/supabase/config';
import type { AccountLoad, AccountSettings, Profile } from './accountApi';
import type { AuthFailure } from './errors';

/**
 * The whole authentication state as one value, and the pure function that moves it. Keeping the transitions pure is what
 * makes the awkward cases testable: switching users, a session that ends on its own, and a slow profile load that finishes
 * after the user has already changed.
 *
 * Session tokens deliberately do NOT live here (or in Zustand). The SDK owns the session; this holds only what the screens
 * need: who is signed in, and that user's profile and settings.
 */

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Account-scoped data for the signed-in user. It is dropped whenever the user changes or signs out. */
export type AccountState =
  | { phase: 'loading' }
  | { phase: 'ready'; profile: Profile; settings: AccountSettings }
  | { phase: 'incomplete'; missing: 'profile' | 'settings' }
  | { phase: 'error'; failure: AuthFailure };

export type AuthState =
  /** The feature flag is off: local mode, nothing else exists. */
  | { status: 'disabled' }
  /** The flag is on but the settings are unusable. */
  | { status: 'misconfigured'; problem: ConfigProblem }
  /** The stored session is still being restored. Nothing should redirect yet. */
  | { status: 'initializing' }
  /** The session could not be checked (for example the network was down). Recoverable. */
  | { status: 'error' }
  /**
   * `endedUnexpectedly` is true when a signed-in session ended without the user asking (expiry, or sign-out in another tab).
   * `byUser` is true when this tab's user chose to sign out, so the app can return them to local mode instead of a sign-in screen.
   */
  | { status: 'signed-out'; endedUnexpectedly: boolean; byUser: boolean }
  | { status: 'signed-in'; user: SessionUser; account: AccountState };

export type AuthAction =
  | { type: 'session'; user: SessionUser | null; userInitiated: boolean }
  | { type: 'account-loaded'; userId: string; load: AccountLoad }
  | { type: 'account-reload' }
  | { type: 'init-failed' }
  | { type: 'init-retry' };

export function initialAuthState(config: AuthConfig): AuthState {
  if (config.status === 'disabled') return { status: 'disabled' };
  if (config.status === 'misconfigured') return { status: 'misconfigured', problem: config.problem };
  return { status: 'initializing' };
}

export function accountFromLoad(load: AccountLoad): AccountState {
  switch (load.kind) {
    case 'ready':
      return { phase: 'ready', profile: load.profile, settings: load.settings };
    case 'incomplete':
      return { phase: 'incomplete', missing: load.missing };
    case 'error':
      return { phase: 'error', failure: load.failure };
  }
}

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  // A disabled or misconfigured app never changes state: there is no client to produce events.
  if (state.status === 'disabled' || state.status === 'misconfigured') return state;

  switch (action.type) {
    case 'session': {
      if (action.user === null) {
        if (state.status === 'signed-out') return state;
        // Dropping the whole signed-in object is what clears the profile and settings from memory.
        const wasSignedIn = state.status === 'signed-in';
        return { status: 'signed-out', endedUnexpectedly: wasSignedIn && !action.userInitiated, byUser: wasSignedIn && action.userInitiated };
      }
      // Same user (a token refresh, or a user update): keep what we already loaded.
      if (state.status === 'signed-in' && state.user.id === action.user.id) return { ...state, user: action.user };
      // A different user, or the first sign-in: start clean. Nothing of a previous user can survive this line.
      return { status: 'signed-in', user: action.user, account: { phase: 'loading' } };
    }
    case 'account-loaded': {
      // A slow answer for a user who has since gone away is discarded.
      if (state.status !== 'signed-in' || state.user.id !== action.userId) return state;
      return { ...state, account: accountFromLoad(action.load) };
    }
    case 'account-reload':
      return state.status === 'signed-in' ? { ...state, account: { phase: 'loading' } } : state;
    case 'init-failed':
      return state.status === 'initializing' ? { status: 'error' } : state;
    case 'init-retry':
      return state.status === 'error' ? { status: 'initializing' } : state;
  }
}

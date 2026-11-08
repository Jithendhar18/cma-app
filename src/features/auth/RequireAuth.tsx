import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './authContext';
import { SessionChecking } from './components/AuthLayout';
import { SessionError } from './components/SessionError';

/**
 * Guards routes that belong to an account. Local-mode routes are never wrapped in this.
 *
 *   initializing   show a neutral "checking" screen: never redirect before the stored session has been restored
 *   signed out     go to sign-in, remembering where the person was going (and noting if their session ended by itself)
 *   signed in      render the route
 *   disabled       accounts are off, so there is nothing to protect: back to the app
 */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  switch (state.status) {
    case 'disabled':
    case 'misconfigured':
      return <Navigate to="/" replace />;
    case 'initializing':
      return <SessionChecking />;
    case 'error':
      return <SessionError />;
    case 'signed-out':
      // The person chose to sign out here: return them to the app (local mode), not to a sign-in screen.
      if (state.byUser) return <Navigate to="/" replace />;
      return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname + location.search }} />;
    case 'signed-in':
      return <Outlet />;
  }
}

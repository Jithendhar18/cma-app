import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, UserRound } from 'lucide-react';
import { AuthContext } from './authContext';

/**
 * The header link to the account screens. It renders nothing unless accounts are switched on and working, so with the feature
 * flag off the header is exactly what it was.
 */
export function AccountEntry() {
  // Tolerates a missing provider (the header can be rendered on its own, for example in a test) by showing nothing.
  const state = useContext(AuthContext)?.state;
  if (!state) return null;
  if (state.status === 'signed-in') {
    return (
      <Link to="/account" aria-label="Your account" className="flex h-9 items-center gap-2 rounded-lg border bg-surface px-2.5 text-[12px] text-ink-2 transition-colors hover:text-ink">
        <UserRound className="size-4" aria-hidden />
        <span className="hidden lg:inline">Account</span>
      </Link>
    );
  }
  if (state.status === 'signed-out') {
    return (
      <Link to="/auth/sign-in" className="flex h-9 items-center gap-2 rounded-lg border bg-surface px-2.5 text-[12px] text-ink-2 transition-colors hover:text-ink">
        <LogIn className="size-4" aria-hidden />
        <span className="hidden sm:inline">Sign in</span>
        <span className="sr-only sm:hidden">Sign in</span>
      </Link>
    );
  }
  return null;
}

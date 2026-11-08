import { Link, Navigate } from 'react-router-dom';
import { useAuth } from './authContext';
import { useAuthLink } from './useAuthLink';
import { AuthLayout, linkClass } from './components/AuthLayout';
import { ConfigProblemScreen } from './components/ConfigProblemScreen';
import { Notice } from './components/Notice';
import { SessionError } from './components/SessionError';

/** Where the "confirm your email" link lands. */
export default function AuthCallbackPage() {
  const { state } = useAuth();
  if (state.status === 'disabled') return <Navigate to="/" replace />;
  if (state.status === 'misconfigured') return <ConfigProblemScreen problem={state.problem} />;
  if (state.status === 'error') return <SessionError />;
  return <Callback />;
}

function Callback() {
  const { state } = useAuth();
  const link = useAuthLink();

  if (state.status === 'initializing' || link === null) {
    return <AuthLayout title="Confirming your email…" hideLocalLink><p role="status" className="text-[13px] text-ink-2">One moment.</p></AuthLayout>;
  }
  if (link.kind === 'failed') {
    const text =
      link.reason === 'network'
        ? 'We could not reach the server to confirm your email. Check your connection and open the link again.'
        : link.reason === 'other-browser'
          ? 'Open the link in the same browser you used to register. For your security it cannot be finished on another device.'
          : 'This confirmation link is invalid, has expired, or has already been used.';
    return (
      <AuthLayout title="We could not confirm your email" footer={<>Back to <Link to="/auth/sign-in" className={linkClass}>sign in</Link></>}>
        <Notice tone="error">{text}</Notice>
        <p className="mt-4 text-[13px] text-ink-2">If your address is not confirmed yet, sign in and we will offer to send a new link.</p>
      </AuthLayout>
    );
  }
  // Signed in (confirmation succeeded) or nothing to confirm: either way the account page or sign-in is the right next step.
  return <Navigate to={state.status === 'signed-in' ? '/account' : '/auth/sign-in'} replace />;
}


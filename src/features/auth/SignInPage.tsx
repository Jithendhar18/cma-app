import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from './authContext';
import { signIn } from './authService';
import { safeReturnPath } from './returnPath';
import { validateSignIn, type FieldErrors } from './validation';
import { AuthLayout, SessionChecking, linkClass } from './components/AuthLayout';
import { ConfigProblemScreen } from './components/ConfigProblemScreen';
import { Notice } from './components/Notice';
import { PasswordInput, TextInput } from './components/TextInput';
import { ResendConfirmation } from './components/ResendConfirmation';
import { SessionError } from './components/SessionError';

export default function SignInPage() {
  const { state } = useAuth();
  const location = useLocation();
  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  if (state.status === 'disabled') return <Navigate to="/" replace />;
  if (state.status === 'misconfigured') return <ConfigProblemScreen problem={state.problem} />;
  if (state.status === 'initializing') return <SessionChecking />;
  if (state.status === 'error') return <SessionError />;
  // A signed-in user has no reason to see this screen.
  if (state.status === 'signed-in') return <Navigate to={from ?? '/account'} replace />;
  return <SignInForm sessionEnded={state.endedUnexpectedly} />;
}

function SignInForm({ sessionEnded }: { sessionEnded: boolean }) {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<'email' | 'password'>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; needsConfirmation: boolean } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !client) return;
    setFailure(null);
    const found = validateSignIn({ email, password });
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();
    setBusy(true);
    const result = await signIn(client, { email, password });
    setBusy(false);
    // Success needs no handling here: the session change moves the provider to "signed in" and this screen redirects.
    if (result.kind === 'failed') setFailure({ message: result.message, needsConfirmation: result.failure === 'email-not-confirmed' });
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Use your account to connect this app. Your study progress on this device stays where it is."
      footer={<>New here? <Link to="/auth/sign-up" className={linkClass}>Create an account</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {sessionEnded && <Notice tone="info">Your session ended. Sign in again to continue.</Notice>}
        <TextInput ref={emailRef} label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordInput ref={passwordRef} label="Password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        {failure && <Notice tone="error">{failure.message}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !client}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        <p className="text-center text-[13px]"><Link to="/auth/forgot-password" className={linkClass}>Forgot your password?</Link></p>
      </form>
      {failure?.needsConfirmation && <div className="mt-4 border-t pt-4"><ResendConfirmation email={email} /></div>}
    </AuthLayout>
  );
}

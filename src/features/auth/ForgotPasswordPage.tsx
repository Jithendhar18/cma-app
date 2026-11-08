import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from './authContext';
import { requestPasswordReset } from './authService';
import { validateEmail } from './validation';
import { AuthLayout, SessionChecking, linkClass } from './components/AuthLayout';
import { ConfigProblemScreen } from './components/ConfigProblemScreen';
import { Notice } from './components/Notice';
import { TextInput } from './components/TextInput';
import { SessionError } from './components/SessionError';

export default function ForgotPasswordPage() {
  const { state } = useAuth();
  if (state.status === 'disabled') return <Navigate to="/" replace />;
  if (state.status === 'misconfigured') return <ConfigProblemScreen problem={state.problem} />;
  if (state.status === 'initializing') return <SessionChecking />;
  if (state.status === 'error') return <SessionError />;
  return <ForgotPasswordForm />;
}

function ForgotPasswordForm() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !client) return;
    setFailure(null);
    const problem = validateEmail(email);
    setError(problem ?? undefined);
    if (problem) return emailRef.current?.focus();
    setBusy(true);
    const result = await requestPasswordReset(client, email);
    setBusy(false);
    if (result.kind === 'requested') setSentTo(email.trim());
    else setFailure(result.message);
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={<>Back to <Link to="/auth/sign-in" className={linkClass}>sign in</Link></>}>
        <Notice tone="success">
          If an account exists for <strong className="break-all">{sentTo}</strong>, we have sent a link to reset the password. It can be used once and expires after a while.
        </Notice>
        <p className="mt-4 text-[12px] leading-5 text-ink-3">Nothing arrived? Check your spam folder, or <button type="button" onClick={() => setSentTo(null)} className={linkClass}>try another address</button>.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" description="Enter your email address and we will send you a link to choose a new password." footer={<>Remembered it? <Link to="/auth/sign-in" className={linkClass}>Sign in</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextInput ref={emailRef} label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        {failure && <Notice tone="error">{failure}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !client}>{busy ? 'Sending…' : 'Send reset link'}</Button>
      </form>
    </AuthLayout>
  );
}

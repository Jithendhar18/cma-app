import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from './authContext';
import { updatePassword } from './authService';
import { useAuthLink } from './useAuthLink';
import { PASSWORD_MIN, validateNewPassword, type FieldErrors } from './validation';
import { AuthLayout, linkClass } from './components/AuthLayout';
import { ConfigProblemScreen } from './components/ConfigProblemScreen';
import { Notice } from './components/Notice';
import { PasswordInput } from './components/TextInput';
import { SessionError } from './components/SessionError';

/** Where the "reset your password" link lands: finish the link, then let the person choose a new password. */
export default function ResetPasswordPage() {
  const { state } = useAuth();
  if (state.status === 'disabled') return <Navigate to="/" replace />;
  if (state.status === 'misconfigured') return <ConfigProblemScreen problem={state.problem} />;
  if (state.status === 'error') return <SessionError />;
  return <Reset />;
}

function Reset() {
  const { state } = useAuth();
  const link = useAuthLink();

  if (state.status === 'initializing' || link === null) {
    return <AuthLayout title="Checking your link…" hideLocalLink><p role="status" className="text-[13px] text-ink-2">One moment.</p></AuthLayout>;
  }
  if (link.kind === 'failed') {
    const text =
      link.reason === 'network'
        ? 'We could not reach the server. Check your connection and open the link again.'
        : link.reason === 'other-browser'
          ? 'Open the reset link in the same browser you used to request it. For your security it cannot be finished on another device.'
          : 'This reset link is invalid, has expired, or has already been used.';
    return <InvalidLink text={text} />;
  }
  // The link just signed this person in, or they are already signed in (for example after reloading this page).
  if (state.status === 'signed-in') return <NewPasswordForm />;
  return <InvalidLink text="Open the reset link from your email to choose a new password." />;
}

function InvalidLink({ text }: { text: string }) {
  return (
    <AuthLayout title="We could not use this link" footer={<>Back to <Link to="/auth/sign-in" className={linkClass}>sign in</Link></>}>
      <Notice tone="error">{text}</Notice>
      <p className="mt-4"><Link to="/auth/forgot-password" className={`${linkClass} text-[13px]`}>Request a new reset link</Link></p>
    </AuthLayout>
  );
}

function NewPasswordForm() {
  const { client } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors<'password' | 'confirmPassword'>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !client) return;
    setFailure(null);
    const found = validateNewPassword({ password, confirmPassword: confirm });
    setErrors(found);
    if (found.password) return passwordRef.current?.focus();
    if (found.confirmPassword) return confirmRef.current?.focus();
    setBusy(true);
    const result = await updatePassword(client, password);
    setBusy(false);
    if (result.kind === 'updated') {
      setPassword('');
      setConfirm('');
      setDone(true);
    } else {
      setFailure(result.message);
    }
  }

  if (done) {
    return (
      <AuthLayout title="Password updated" hideLocalLink>
        <Notice tone="success">Your password has been changed. You are signed in.</Notice>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/account" className="inline-flex h-9 items-center justify-center rounded-lg bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500">Go to your account</Link>
          <Link to="/" className="inline-flex h-9 items-center justify-center rounded-lg border bg-elevated px-4 text-[13px] font-medium text-ink hover:bg-ink/[0.06]">Open the app</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" description="Pick a password you do not use anywhere else." hideLocalLink>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <PasswordInput ref={passwordRef} label="New password" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={`At least ${PASSWORD_MIN} characters.`} />
        <PasswordInput ref={confirmRef} label="Confirm new password" name="confirmPassword" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirmPassword} />
        {failure && <Notice tone="error">{failure}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !client}>{busy ? 'Saving…' : 'Update password'}</Button>
      </form>
    </AuthLayout>
  );
}

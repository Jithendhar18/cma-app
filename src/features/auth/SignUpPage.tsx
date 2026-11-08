import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from './authContext';
import { signUp } from './authService';
import { DISPLAY_NAME_MAX, PASSWORD_MIN, validateSignUp, type FieldErrors, type SignUpFields } from './validation';
import { AuthLayout, SessionChecking, linkClass } from './components/AuthLayout';
import { ConfigProblemScreen } from './components/ConfigProblemScreen';
import { Notice } from './components/Notice';
import { PasswordInput, TextInput } from './components/TextInput';
import { ResendConfirmation } from './components/ResendConfirmation';
import { SessionError } from './components/SessionError';

export default function SignUpPage() {
  const { state } = useAuth();
  if (state.status === 'disabled') return <Navigate to="/" replace />;
  if (state.status === 'misconfigured') return <ConfigProblemScreen problem={state.problem} />;
  if (state.status === 'initializing') return <SessionChecking />;
  if (state.status === 'error') return <SessionError />;
  if (state.status === 'signed-in') return <Navigate to="/account" replace />;
  return <SignUpForm />;
}

function SignUpForm() {
  const { client } = useAuth();
  const [fields, setFields] = useState<SignUpFields>({ displayName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors<keyof SignUpFields>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const refs = {
    displayName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmPassword: useRef<HTMLInputElement>(null),
  };
  const set = (key: keyof SignUpFields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !client) return;
    setFailure(null);
    const found = validateSignUp(fields);
    setErrors(found);
    const first = (['displayName', 'email', 'password', 'confirmPassword'] as const).find((key) => found[key]);
    if (first) return refs[first].current?.focus();
    setBusy(true);
    const result = await signUp(client, { displayName: fields.displayName, email: fields.email, password: fields.password });
    setBusy(false);
    if (result.kind === 'confirmation-pending') {
      setPendingEmail(fields.email.trim());
      setFields((f) => ({ ...f, password: '', confirmPassword: '' })); // do not keep passwords in memory longer than needed
    } else if (result.kind === 'failed') {
      setFailure(result.message);
    }
    // 'signed-in' (a project without email confirmation) needs no handling: the session change redirects.
  }

  if (pendingEmail) {
    return (
      <AuthLayout title="Check your email" footer={<>Back to <Link to="/auth/sign-in" className={linkClass}>sign in</Link></>}>
        <div className="space-y-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500"><MailCheck className="size-5" aria-hidden /></div>
          <p className="text-[13px] leading-5 text-ink-2">
            We have sent a confirmation link to <strong className="break-all text-ink">{pendingEmail}</strong>. Open it to finish creating your account. You will not be able to sign in until the address is confirmed.
          </p>
          <p className="text-[12px] leading-5 text-ink-3">Nothing arrived? Check your spam folder, make sure the address is spelled correctly, or send it again.</p>
          <ResendConfirmation email={pendingEmail} />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="An account lets this app connect to your own space. Your current study progress stays on this device."
      footer={<>Already have an account? <Link to="/auth/sign-in" className={linkClass}>Sign in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextInput ref={refs.displayName} label="Display name" name="displayName" autoComplete="nickname" maxLength={DISPLAY_NAME_MAX + 20} value={fields.displayName} onChange={set('displayName')} error={errors.displayName} hint={`Up to ${DISPLAY_NAME_MAX} characters.`} />
        <TextInput ref={refs.email} label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={fields.email} onChange={set('email')} error={errors.email} />
        <PasswordInput ref={refs.password} label="Password" name="password" autoComplete="new-password" value={fields.password} onChange={set('password')} error={errors.password} hint={`At least ${PASSWORD_MIN} characters.`} />
        <PasswordInput ref={refs.confirmPassword} label="Confirm password" name="confirmPassword" autoComplete="new-password" value={fields.confirmPassword} onChange={set('confirmPassword')} error={errors.confirmPassword} />
        {failure && <Notice tone="error">{failure}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !client}>{busy ? 'Creating account…' : 'Create account'}</Button>
      </form>
    </AuthLayout>
  );
}

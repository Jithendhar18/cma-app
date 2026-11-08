import { useContext, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Notice } from '@/features/auth/components/Notice';
import { useStoreMode } from '@/lib/account/storeSwap';
import { CurriculumContext } from '@/lib/curriculum/curriculumContext';
import { useAccountMode } from './accountContext';
import OnboardingPage from './OnboardingPage';

function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4 py-12" data-testid="gate-skeleton">
      <div className="mx-auto h-6 w-48 animate-pulse rounded bg-ink/10" />
      <div className="mx-auto h-24 w-full max-w-xl animate-pulse rounded-xl bg-ink/[0.06]" />
      <p className="text-center text-[13px] text-ink-3">{label}</p>
    </div>
  );
}

function Problem({ title, message, onRetry, onLocal }: { title: string; message: string; onRetry: () => void; onLocal: () => void }) {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={title} />
      <Notice tone="error">{message}</Notice>
      <div className="flex gap-3"><Button variant="primary" onClick={onRetry}>Try again</Button><Button onClick={onLocal}>Use local mode instead</Button></div>
    </div>
  );
}

/**
 * Decides what the study pages show:
 *   local mode      the pages, exactly as before (and never while the stores still hold account data)
 *   account mode    a skeleton while the account loads; onboarding when there is no enrolment; an error with Retry; and the pages only
 *                   once the stores are switched to THIS user's account data for THIS enrolment.
 */
export function ModeGate({ children }: { children: ReactNode }) {
  const account = useAccountMode();
  const curriculum = useContext(CurriculumContext);
  const storeMode = useStoreMode();
  const { pathname } = useLocation();

  // The account page holds sign-out and the choice of mode, and shows only account data (never study data), so it is always reachable.
  if (pathname === '/account') return <>{children}</>;
  if (account.mode === 'local') return storeMode.kind === 'account' ? <Skeleton label="Switching to local mode…" /> : <>{children}</>;

  const local = () => account.setPreference('local');
  if (account.phase === 'checking') return <Skeleton label="Loading your account…" />;
  if (account.phase === 'loading') return <Skeleton label="Loading your enrolment…" />;
  if (account.phase === 'error') return <Problem title="Could not load your account" message={account.error ?? 'Something went wrong.'} onRetry={() => void account.refresh()} onLocal={local} />;
  if (account.phase === 'none' || !account.enrollment) return <OnboardingPage />;

  if (!curriculum || curriculum.status === 'loading') return <Skeleton label="Loading your curriculum…" />;
  if (curriculum.status === 'error') return <Problem title="Could not load your curriculum" message={curriculum.error ?? 'Something went wrong.'} onRetry={curriculum.retry} onLocal={local} />;

  const bound = storeMode.kind === 'account' && storeMode.userId === account.userId && storeMode.enrollmentId === account.enrollment.id;
  return bound ? <>{children}</> : <Skeleton label="Preparing your study data…" />;
}

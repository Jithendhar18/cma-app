import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Notice } from '@/features/auth/components/Notice';
import type { EnrollmentOption } from '@/lib/curriculum/types';
import { useAccountMode } from './accountContext';
import { EnrollmentForm } from './EnrollmentForm';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; options: EnrollmentOption[] };

/**
 * Shown to a signed-in student with no active enrolment. Options come only from `enrollment_options` (verified, enabled, complete
 * combinations). An EMPTY result is a normal state, not a failure: it means enrolment is not open yet, and local mode stays available.
 */
export default function OnboardingPage() {
  const account = useAccountMode();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchOptions = useCallback(() => {
    if (!account.services) return;
    setLoad({ status: 'loading' });
    account.services.curriculum
      .listEnrollmentOptions()
      .then(({ options }) => setLoad({ status: 'ready', options }))
      .catch(() => setLoad({ status: 'error' }));
  }, [account.services]);
  useEffect(fetchOptions, [fetchOptions]);

  const useLocal = <Button onClick={() => account.setPreference('local')}>Use local mode instead</Button>;

  if (load.status === 'loading') return <div role="status" className="py-24 text-center text-[13px] text-ink-3">Loading course options…</div>;

  if (load.status === 'error') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Choose your course" />
        <Notice tone="error">We could not load the course options. Check your connection and try again.</Notice>
        <div className="flex gap-3"><Button variant="primary" onClick={fetchOptions}>Try again</Button>{useLocal}</div>
      </div>
    );
  }

  if (load.options.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <EmptyState
            icon={Hourglass}
            title="Enrolment is not open yet"
            description="Verified course options are not currently available."
            action={<div className="flex flex-col items-center gap-2">{useLocal}<p className="max-w-xs text-[12px] text-ink-3">Your local study data on this device is untouched and keeps working.</p></div>}
          />
        </Card>
      </div>
    );
  }

  const actions = account.actions;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="Choose your course" subtitle="Pick the course, syllabus version, exam attempt and groups you are preparing for." eyebrow={<GraduationCap className="size-5 text-violet-500" aria-hidden />} />
      <Card>
        <CardHeader title="Your enrolment" description="You can change the attempt or groups later in Settings." />
        <EnrollmentForm
          options={load.options}
          submitLabel="Start studying"
          onSubmit={async (input) => {
            if (!actions) throw new Error('not ready');
            await actions.create(input);
            account.onEnrolled();
          }}
          onAlreadyActive={() => void account.refresh()}
        />
      </Card>
      <p className="text-center text-[12px] text-ink-3">Prefer to keep studying on this device only? {useLocal}</p>
    </div>
  );
}

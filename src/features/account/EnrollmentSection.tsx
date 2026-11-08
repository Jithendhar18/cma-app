import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Archive, History, Plus, Repeat, Users } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { Notice } from '@/features/auth/components/Notice';
import { formatLongDate } from '@/lib/dates';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
import type { EnrollmentOption } from '@/lib/curriculum/types';
import { classifyEnrollmentError, type Enrollment } from '@/lib/enrollment/types';
import { useAccountMode } from './accountContext';
import { EnrollmentForm } from './EnrollmentForm';
import { describeExamDate } from './examDate';

type Dialog = null | { kind: 'attempt' } | { kind: 'groups' } | { kind: 'another' } | { kind: 'archive' } | { kind: 'activate'; enrollment: Enrollment };

const examDateText = (e: Enrollment) =>
  e.attemptStartDate ? describeExamDate({ examStartDate: e.attemptStartDate, dateStatus: e.dateStatus }) : 'Exam date not announced yet.';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * Account-mode enrolment management. Every change is confirmed in plain language first, is blocked while a timer is running (and, once sync
 * exists, until pending changes for the current enrolment have been saved), and goes through the database's own functions.
 */
export function EnrollmentSection() {
  const account = useAccountMode();
  const { groups } = useCurriculum();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [options, setOptions] = useState<EnrollmentOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attemptId, setAttemptId] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const enrollment = account.enrollment;

  useEffect(() => {
    if (!account.services || account.mode !== 'account') return;
    let alive = true;
    account.services.curriculum.listEnrollmentOptions().then(({ options: o }) => alive && setOptions(o)).catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [account.services, account.mode, enrollment?.id]);

  const close = useCallback(() => {
    setDialog(null);
    setError(null);
  }, []);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setDialog(null);
    } catch (e) {
      setError(classifyEnrollmentError(e).message);
    } finally {
      setBusy(false);
    }
  }, []);

  if (account.mode !== 'account' || !enrollment || !account.actions) return null;
  const actions = account.actions;
  const sameSyllabusAttempts = (options ?? []).filter((o) => o.csvId === enrollment.csvId && o.attemptId !== enrollment.examAttemptId);
  const hasOwnDates = enrollment.examDateOverride !== null || enrollment.finalRevisionDate !== null;

  return (
    <Card>
      <CardHeader title="Enrolment" description="The course, syllabus version, attempt and groups your account is preparing for." />
      <dl className="space-y-2.5 text-[13px]">
        <Row label="Course">{enrollment.courseName}</Row>
        <Row label="Syllabus version">{enrollment.syllabusName}</Row>
        <Row label="Exam attempt">{enrollment.attemptLabel}</Row>
        <Row label="Exam date">{enrollment.examDateOverride ? `${formatLongDate(enrollment.examDateOverride)} (your own date)` : examDateText(enrollment)}</Row>
        <Row label="Groups">{enrollment.groups.map((g) => g.name).join(', ')}</Row>
        <Row label="Status"><Badge tone="emerald" dot>Active</Badge></Row>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" icon={<Repeat className="size-4" />} onClick={() => { setAttemptId(''); setDialog({ kind: 'attempt' }); }} disabled={sameSyllabusAttempts.length === 0}>Change attempt</Button>
        <Button size="sm" icon={<Users className="size-4" />} onClick={() => { setGroupIds(enrollment.groups.map((g) => g.id)); setDialog({ kind: 'groups' }); }}>Change groups</Button>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDialog({ kind: 'another' })} disabled={(options ?? []).length === 0}>Start another course</Button>
        <Button size="sm" variant="danger" icon={<Archive className="size-4" />} onClick={() => setDialog({ kind: 'archive' })}>Archive enrolment</Button>
      </div>
      {sameSyllabusAttempts.length === 0 && options !== null && <p className="mt-2 text-[12px] text-ink-3">No other exam attempt is open for this syllabus right now.</p>}

      {account.archived.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink"><History className="size-4 text-ink-3" aria-hidden />Past enrolments</h3>
          <ul className="space-y-2">
            {account.archived.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 text-ink-2">{a.courseName}, {a.syllabusName}, {a.attemptLabel} ({a.groups.map((g) => g.name).join(', ')})</span>
                <Button size="sm" onClick={() => setDialog({ kind: 'activate', enrollment: a })}>Make active</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- change attempt ---- */}
      <Sheet open={dialog?.kind === 'attempt'} onClose={close} title="Change exam attempt?" description="Same course and syllabus version, a different attempt."
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy || !attemptId} onClick={() => run(() => actions.changeAttempt(enrollment.id, attemptId, true))}>{busy ? 'Changing…' : 'Change attempt'}</Button></>}>
        <div className="space-y-3 text-[13px] text-ink-2">
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-ink-2">Choose the new attempt</legend>
            <div className="space-y-1.5">
              {sameSyllabusAttempts.map((o) => (
                <label key={o.attemptId} className="flex items-start gap-2 text-ink">
                  <input type="radio" name="attempt" className="mt-1 accent-violet-500" checked={attemptId === o.attemptId} onChange={() => setAttemptId(o.attemptId)} />
                  <span>{o.attemptLabel}<span className="block text-[12px] text-ink-3">{describeExamDate(o)}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <p>Your chapter progress, study sessions and history are kept. They are not tied to the attempt.</p>
          <p>{hasOwnDates ? 'The exam date and final revision date you set yourself belong to the old attempt, so they will be cleared. Pending revisions that were scheduled for the old final date stay in your list so you can reschedule them.' : 'You have not set your own exam or final revision date, so no date is cleared.'}</p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>

      {/* ---- change groups ---- */}
      <Sheet open={dialog?.kind === 'groups'} onClose={close} title="Change groups?" description="Choose the groups you are preparing for."
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy || groupIds.length === 0} onClick={() => run(() => actions.setGroups(enrollment.id, groupIds))}>{busy ? 'Saving…' : 'Save groups'}</Button></>}>
        <div className="space-y-3 text-[13px] text-ink-2">
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-ink-2">Groups</legend>
            <div className="flex flex-wrap gap-4">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-ink">
                  <input type="checkbox" className="size-4 accent-violet-500" checked={groupIds.includes(g.id)} onChange={() => setGroupIds((cur) => (cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id]))} /> {g.name}
                </label>
              ))}
            </div>
          </fieldset>
          <p>Nothing is deleted. A group you remove is only hidden from group views, and all its progress returns if you add it back.</p>
          {groupIds.length === 0 && <p role="alert" className="text-[12px] text-red-500">Choose at least one group.</p>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>

      {/* ---- start another course ---- */}
      <Sheet open={dialog?.kind === 'another'} onClose={close} title="Start another course?" description="This archives your current enrolment and starts a new one.">
        <div className="space-y-4 text-[13px] text-ink-2">
          <p>Your current enrolment is archived, not deleted: all its progress is kept and you can make it active again from Past enrolments.</p>
          <p>Progress is <strong className="text-ink">not</strong> carried over to a different course or syllabus version. The new enrolment starts empty.</p>
          {options && (
            <EnrollmentForm options={options} replaceActive submitLabel="Archive current and start" onCancel={close}
              onSubmit={async (input) => { await actions.create(input); setDialog(null); }} onAlreadyActive={() => void account.refresh()} />
          )}
        </div>
      </Sheet>

      {/* ---- archive ---- */}
      <Sheet open={dialog?.kind === 'archive'} onClose={close} title="Archive this enrolment?"
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => run(() => actions.archive(enrollment.id))}>{busy ? 'Archiving…' : 'Archive enrolment'}</Button></>}>
        <div className="space-y-3 text-[13px] text-ink-2">
          <p>The enrolment is archived, not deleted. Its progress is kept and you can make it active again from Past enrolments.</p>
          <p>You will be asked to choose a course again to keep studying in your account. Your local data on this device is not affected.</p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>

      {/* ---- activate a past enrolment ---- */}
      <Sheet open={dialog?.kind === 'activate'} onClose={close} title="Make this enrolment active?"
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => dialog?.kind === 'activate' && run(() => actions.activate(dialog.enrollment.id))}>{busy ? 'Switching…' : 'Make active'}</Button></>}>
        <div className="space-y-3 text-[13px] text-ink-2">
          {dialog?.kind === 'activate' && <p className="text-ink">{dialog.enrollment.courseName}, {dialog.enrollment.syllabusName}, {dialog.enrollment.attemptLabel}</p>}
          <p>Your current enrolment is archived and this one becomes active again, with all of its progress as you left it.</p>
          <p>Progress is not transferred between enrolments.</p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>
    </Card>
  );
}

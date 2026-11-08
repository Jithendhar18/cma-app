import { useStoreMode } from '@/lib/account/storeSwap';
import { useStudyStore } from '@/stores/studyStore';
import { useAccountMode } from './accountContext';

export interface ShellIdentity {
  name: string;
  course: string;
  examDate: string;
  examDateIsSample: boolean;
}

/**
 * What the always-visible shell (sidebar, header, countdown) shows. In local mode it is the local study store, exactly as before. In account
 * mode it is the store ONLY once the stores are bound to this user's enrolment; until then (loading, onboarding, errors) it shows no name
 * and only the account's own enrolment, so the local profile, course and sample exam date are never displayed under an account.
 */
export function useShellIdentity(): ShellIdentity {
  const account = useAccountMode();
  const storeMode = useStoreMode();
  const name = useStudyStore((s) => s.settings.name);
  const course = useStudyStore((s) => s.settings.course);
  const examDate = useStudyStore((s) => s.settings.examDate);
  const examDateIsSample = useStudyStore((s) => s.settings.examDateIsSample);

  if (account.mode !== 'account') return { name, course, examDate, examDateIsSample };
  const bound = storeMode.kind === 'account' && storeMode.userId === account.userId && account.enrollment !== null && storeMode.enrollmentId === account.enrollment.id;
  if (bound) return { name, course, examDate, examDateIsSample };
  return { name: '', course: account.enrollment?.courseName ?? '', examDate: '', examDateIsSample: false };
}

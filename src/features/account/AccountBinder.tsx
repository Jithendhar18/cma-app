import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { buildEntrySnapshot, readScopedMirror, writeScope } from '@/lib/account/mirror';
import { currentStoreMode, enterAccountStores, leaveAccountStores } from '@/lib/account/storeSwap';
import { curriculumIdentity } from '@/lib/curriculum/cache';
import { CurriculumContext } from '@/lib/curriculum/curriculumContext';
import { useContext } from 'react';
import { useStudyStore } from '@/stores/studyStore';
import { useAccountMode } from './accountContext';

/**
 * Connects the existing stores to the account: when a signed-in student's enrolment and curriculum are both ready, the stores are
 * switched to that user's account storage; when that stops being true they are switched back. Renders nothing.
 *
 * It is mounted above the routes so that moving to a sign-in screen and back does not swap the stores each time.
 */
export function AccountBinder() {
  const auth = useAuth();
  const account = useAccountMode();
  const curriculum = useContext(CurriculumContext);

  const ready = auth.state.status === 'signed-in' && auth.state.account.phase === 'ready' && account.mode === 'account' && account.phase === 'ready' && account.enrollment !== null && curriculum?.status === 'ready' && curriculum.identity.csvId === account.enrollment.csvId;
  const key = ready && account.enrollment && curriculum
    ? `${auth.state.status === 'signed-in' ? auth.state.user.id : ''}|${account.enrollment.id}|${curriculum.identity.csvId}|${curriculumIdentity({ groups: curriculum.tree.groups, subjects: curriculum.tree.subjects, sections: curriculum.tree.sections, chapters: curriculum.tree.chapters, weightages: curriculum.tree.weightages })}`
    : null;

  // The effect reads the latest values through a ref so it re-runs only when the KEY (who, which enrolment, which curriculum) changes.
  const latest = useRef({ auth, account, curriculum });
  latest.current = { auth, account, curriculum };

  useLayoutEffect(() => {
    if (key === null) return;
    const { auth: a, account: acc, curriculum: cur } = latest.current;
    if (a.state.status !== 'signed-in' || a.state.account.phase !== 'ready' || !acc.enrollment || !cur) return;
    const userId = a.state.user.id;
    const input = { profile: a.state.account.profile, settings: a.state.account.settings, enrollment: acc.enrollment, curriculum: cur.tree };
    const scope = { enrollmentId: acc.enrollment.id, csvId: acc.enrollment.csvId };
    enterAccountStores({ userId, enrollmentId: scope.enrollmentId, snapshot: buildEntrySnapshot(input, readScopedMirror(userId, scope)) });
    writeScope(userId, scope);
    return () => leaveAccountStores();
  }, [key]);

  // The enrolment can change under a bound session (groups, attempt, dates). Its derived settings follow it, without touching anything the
  // student typed. The groups, the attempt label and the official date are never stored twice: they are always re-derived from the enrolment.
  const enrollment = account.enrollment;
  const derived = key !== null && enrollment ? { examAttempt: enrollment.attemptLabel, course: enrollment.courseName, examGroups: enrollment.groups.map((g) => g.name), official: enrollment.attemptStartDate, override: enrollment.examDateOverride, finalRevisionDate: enrollment.finalRevisionDate ?? '' } : null;
  const derivedKey = derived ? JSON.stringify(derived) : null;
  useEffect(() => {
    // Only ever the ACCOUNT store: never local data.
    if (derived === null || currentStoreMode().kind !== 'account') return;
    const state = useStudyStore.getState();
    const examDate = derived.override ?? derived.official ?? '';
    const s = state.settings;
    if (s.examAttempt === derived.examAttempt && s.course === derived.course && s.examDate === examDate && s.finalRevisionDate === derived.finalRevisionDate && s.examGroups.join('|') === derived.examGroups.join('|')) return;
    useStudyStore.setState({ settings: { ...s, examAttempt: derived.examAttempt, course: derived.course, examDate, finalRevisionDate: derived.finalRevisionDate, examGroups: derived.examGroups } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedKey]);

  return null;
}

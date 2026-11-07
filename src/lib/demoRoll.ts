import { addDaysISO, daysBetween } from '@/lib/dates';
import type { StudyDataSnapshot } from '@/types/study';

const shiftDate = (date: string, days: number) => addDaysISO(date, days);
const shiftOrNull = (date: string | null | undefined, days: number) => (date ? shiftDate(date, days) : (date ?? null));

/**
 * Moves untouched demo records forward so the demo always looks current.
 *
 * Only records still flagged `demo` move. Anything the user created or edited has no flag and is
 * never changed. All demo records shift by the same number of days, so their relative spacing is
 * preserved. Returns the same object when nothing needs to change, so repeated calls are no-ops.
 */
export function rollDemoForward(data: StudyDataSnapshot, today: string): StudyDataSnapshot {
  const anchor = data.meta.seedAnchor;
  if (!anchor) return data;
  const delta = daysBetween(anchor, today);
  if (delta <= 0) return data;

  return {
    ...data,
    meta: { ...data.meta, seedAnchor: today },
    sessions: data.sessions.map((s) => (s.demo ? { ...s, date: shiftDate(s.date, delta) } : s)),
    focusLog: data.focusLog.map((r) => (r.demo ? { ...r, date: shiftDate(r.date, delta) } : r)),
    practiceLog: data.practiceLog.map((r) => (r.demo ? { ...r, date: shiftDate(r.date, delta) } : r)),
    mockExams: data.mockExams.map((m) => (m.demo ? { ...m, date: shiftDate(m.date, delta) } : m)),
    revisions: data.revisions.map((r) =>
      r.demo ? { ...r, dueDate: shiftDate(r.dueDate, delta), completedOn: shiftOrNull(r.completedOn, delta) } : r,
    ),
    chapters: data.chapters.map((c) =>
      c.demo ? { ...c, lastStudied: shiftOrNull(c.lastStudied, delta), completedOn: shiftOrNull(c.completedOn, delta) } : c,
    ),
  };
}

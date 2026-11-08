import type { EnrollmentOption, EnrollmentOptionGroup } from '@/lib/curriculum/types';

/**
 * The four cascading enrolment choices, derived purely from the rows of `enrollment_options`. Nothing about courses, syllabus
 * versions, attempts or groups is hardcoded: whatever the database offers is what appears.
 */
export interface Selection {
  courseId: string | null;
  syllabusVersionId: string | null;
  attemptId: string | null;
  groupIds: string[];
}

export const EMPTY_SELECTION: Selection = { courseId: null, syllabusVersionId: null, attemptId: null, groupIds: [] };

export interface CascadeChoices {
  courses: Array<{ id: string; name: string }>;
  syllabi: Array<{ id: string; name: string }>;
  attempts: EnrollmentOption[];
  groups: EnrollmentOptionGroup[];
}

const distinct = <T,>(items: T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
};

export function choicesFor(options: EnrollmentOption[], sel: Selection): CascadeChoices {
  const courses = distinct([...options].sort((a, b) => a.courseOrder - b.courseOrder || a.courseName.localeCompare(b.courseName)), (o) => o.courseId).map((o) => ({ id: o.courseId, name: o.courseName }));
  const inCourse = options.filter((o) => o.courseId === sel.courseId);
  const syllabi = distinct(inCourse, (o) => o.syllabusVersionId).map((o) => ({ id: o.syllabusVersionId, name: o.syllabusName }));
  const inSyllabus = inCourse.filter((o) => o.syllabusVersionId === sel.syllabusVersionId);
  const attempts = [...inSyllabus].sort((a, b) => a.attemptYear - b.attemptYear || (a.attemptSession === b.attemptSession ? 0 : a.attemptSession === 'june' ? -1 : 1));
  const chosen = inSyllabus.find((o) => o.attemptId === sel.attemptId);
  return { courses, syllabi, attempts, groups: chosen?.groups ?? [] };
}

/**
 * Applies one change and resets everything downstream of it. When a level has exactly one option it is selected automatically (and still
 * shown, so the student can see what they are enrolling in).
 */
export function select(options: EnrollmentOption[], prev: Selection, change: Partial<Selection>): Selection {
  let next: Selection = { ...prev, ...change };
  if ('courseId' in change && change.courseId !== prev.courseId) next = { courseId: change.courseId ?? null, syllabusVersionId: null, attemptId: null, groupIds: [] };
  else if ('syllabusVersionId' in change && change.syllabusVersionId !== prev.syllabusVersionId) next = { ...next, attemptId: null, groupIds: [] };
  else if ('attemptId' in change && change.attemptId !== prev.attemptId) next = { ...next, groupIds: [] };
  return autoSelect(options, next);
}

export function autoSelect(options: EnrollmentOption[], sel: Selection): Selection {
  let next = { ...sel };
  let choices = choicesFor(options, next);
  if (next.courseId === null && choices.courses.length === 1) next = { ...next, courseId: choices.courses[0].id };
  choices = choicesFor(options, next);
  if (next.courseId !== null && next.syllabusVersionId === null && choices.syllabi.length === 1) next = { ...next, syllabusVersionId: choices.syllabi[0].id };
  choices = choicesFor(options, next);
  if (next.syllabusVersionId !== null && next.attemptId === null && choices.attempts.length === 1) next = { ...next, attemptId: choices.attempts[0].attemptId };
  return next;
}

export type SelectionProblem = 'course' | 'syllabus' | 'attempt' | 'groups' | 'unavailable';

/** The one place that decides whether a selection can be submitted. Returns the option it resolves to, or why not. */
export function resolveSelection(options: EnrollmentOption[], sel: Selection): { ok: true; option: EnrollmentOption; groupIds: string[] } | { ok: false; problem: SelectionProblem } {
  if (!sel.courseId) return { ok: false, problem: 'course' };
  if (!sel.syllabusVersionId) return { ok: false, problem: 'syllabus' };
  if (!sel.attemptId) return { ok: false, problem: 'attempt' };
  const option = options.find((o) => o.courseId === sel.courseId && o.syllabusVersionId === sel.syllabusVersionId && o.attemptId === sel.attemptId);
  if (!option) return { ok: false, problem: 'unavailable' };
  const allowed = new Set(option.groups.map((g) => g.id));
  const unique = [...new Set(sel.groupIds)];
  if (unique.length === 0) return { ok: false, problem: 'groups' };
  if (!unique.every((id) => allowed.has(id))) return { ok: false, problem: 'unavailable' };
  return { ok: true, option, groupIds: unique };
}

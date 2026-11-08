import type { AccountSettings, Profile } from '@/features/auth/accountApi';
import type { CurriculumChapter, CurriculumTree } from '@/lib/curriculum/types';
import type { Enrollment } from '@/lib/enrollment/types';
import { parseSnapshot, type SnapshotResult } from '@/lib/snapshot';
import type { Chapter, Settings, StudyDataSnapshot } from '@/types/study';

/**
 * Builds the existing `StudyDataSnapshot` shape for account mode from its three sources: the profile, the user's settings row, and the
 * active enrolment, plus the account curriculum. Every page and selector already speaks this shape, so none of them has to change.
 *
 * What is derived and what is not:
 *   name            profile.display_name
 *   course, attempt the enrolment's course and attempt labels (never stored twice)
 *   exam date       the student's override, else the attempt's official start date, else '' (unknown: never invented)
 *   groups          the enrolment's groups
 *   avatar          local to this device (the browser does not sync the picture in this milestone)
 */

export const hm = (time: string): string => time.slice(0, 5);

export function composeSettings(input: { profile: Profile; settings: AccountSettings; enrollment: Enrollment; avatar?: string | null }): Settings {
  const { profile, settings, enrollment } = input;
  return {
    name: profile.displayName,
    course: enrollment.courseName,
    examAttempt: enrollment.attemptLabel,
    examDate: enrollment.examDateOverride ?? enrollment.attemptStartDate ?? '',
    examDateIsSample: false,
    finalRevisionDate: enrollment.finalRevisionDate ?? '',
    examGroups: enrollment.groups.map((g) => g.name),
    dailyTargetHours: settings.dailyTargetHours,
    weeklyTargetHours: settings.weeklyTargetHours,
    studyStartTime: hm(settings.studyStartTime),
    studyEndTime: hm(settings.studyEndTime),
    pomodoroFocusMinutes: settings.pomodoroFocusMinutes,
    shortBreakMinutes: settings.shortBreakMinutes,
    longBreakMinutes: settings.longBreakMinutes,
    longBreakEvery: settings.longBreakEvery,
    avatar: input.avatar ?? null,
    theme: settings.theme,
  };
}

/** A chapter with no progress yet. Progress fields are the ones personal data (and nothing else) ever changes. */
export function blankChapter(c: CurriculumChapter): Chapter {
  return {
    id: c.id, subjectId: c.subjectId, order: c.order, title: c.title, status: 'not_started', estimatedHours: c.estimatedHours,
    actualHours: 0, confidence: 1, questionsPracticed: 0, correctAnswers: 0, lastStudied: null, completedOn: null, notes: '',
  };
}

const PROGRESS_FIELDS = ['status', 'confidence', 'notes', 'completedOn', 'actualHours', 'questionsPracticed', 'correctAnswers', 'lastStudied'] as const;

/**
 * One entry per curriculum chapter, in official order. A retired chapter is included only when the student has progress on it, so
 * recorded work never dangles. `progress` supplies any chapter state already known (from the mirror or from the server).
 */
export function buildAccountChapters(curriculum: CurriculumTree, progress: ReadonlyMap<string, Partial<Chapter>> = new Map(), keepRetiredIds: ReadonlySet<string> = new Set()): Chapter[] {
  return curriculum.chapters
    .filter((c) => !c.retired || keepRetiredIds.has(c.id) || progress.has(c.id))
    .map((c) => {
      const known = progress.get(c.id);
      const base = blankChapter(c);
      if (!known) return base;
      const merged: Chapter = { ...base };
      for (const field of PROGRESS_FIELDS) if (known[field] !== undefined) (merged as unknown as Record<string, unknown>)[field] = known[field];
      return merged;
    });
}

export interface AccountSnapshotInput {
  profile: Profile;
  settings: AccountSettings;
  enrollment: Enrollment;
  curriculum: CurriculumTree;
  avatar?: string | null;
}

/** The empty account snapshot: the right chapters, settings and groups, and no study history. Never contains demo data. */
export function buildAccountSnapshot(input: AccountSnapshotInput, personal: Partial<Pick<StudyDataSnapshot, 'sessions' | 'revisions' | 'focusLog' | 'mockExams' | 'practiceLog'>> & { progress?: ReadonlyMap<string, Partial<Chapter>> } = {}): StudyDataSnapshot {
  return {
    settings: composeSettings(input),
    chapters: buildAccountChapters(input.curriculum, personal.progress),
    sessions: personal.sessions ?? [],
    revisions: personal.revisions ?? [],
    focusLog: personal.focusLog ?? [],
    mockExams: personal.mockExams ?? [],
    practiceLog: personal.practiceLog ?? [],
    meta: { seedAnchor: null },
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a stored account snapshot with the existing snapshot checks, relaxed in exactly the two places account data legitimately
 * differs: an unknown exam date or final-revision date is '' (not a real date), and group names are whatever the syllabus calls them.
 */
export function parseAccountSnapshot(raw: unknown): SnapshotResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'Not a snapshot.' };
  const record = raw as Record<string, unknown>;
  const settings = record.settings;
  if (typeof settings !== 'object' || settings === null) return { ok: false, error: 'Settings are missing or invalid.' };
  const s = settings as Record<string, unknown>;
  const dateOk = (v: unknown) => v === '' || (typeof v === 'string' && ISO.test(v));
  if (!dateOk(s.examDate) || !dateOk(s.finalRevisionDate)) return { ok: false, error: 'Settings are missing or invalid.' };
  if (!Array.isArray(s.examGroups) || !s.examGroups.every((g) => typeof g === 'string')) return { ok: false, error: 'Settings are missing or invalid.' };
  const stand = { ...record, settings: { ...s, examDate: s.examDate === '' ? '1970-01-01' : s.examDate, finalRevisionDate: s.finalRevisionDate === '' ? '1970-01-01' : s.finalRevisionDate, examGroups: [] } };
  const parsed = parseSnapshot(stand);
  if (!parsed.ok) return parsed;
  return { ok: true, data: { ...parsed.data, settings: { ...parsed.data.settings, examDate: s.examDate as string, finalRevisionDate: s.finalRevisionDate as string, examGroups: s.examGroups as string[] } } };
}

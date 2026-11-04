import type { StudyDataSnapshot } from '@/types/study';

type Rec = Record<string, unknown>;

const CHAPTER_STATUSES = ['not_started', 'learning', 'practising', 'completed', 'revision_due', 'exam_ready'];
const SESSION_STATUSES = ['upcoming', 'in_progress', 'completed', 'missed'];
const PRIORITIES = ['high', 'medium', 'low'];
const THEMES = ['dark', 'light', 'system'];
const FOCUS_MODES = ['pomodoro', 'stopwatch', 'planner'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDate = (v: unknown): v is string => isStr(v) && ISO.test(v);
const isOneOf = (list: string[]) => (v: unknown): boolean => isStr(v) && list.includes(v);

type Check = (v: unknown) => boolean;

function shape(value: unknown, checks: Record<string, Check>): boolean {
  if (!isRec(value)) return false;
  return Object.entries(checks).every(([key, check]) => check(value[key]));
}

const nullable = (check: Check): Check => (v) => v === null || check(v);

function allValid(list: unknown, checks: Record<string, Check>): boolean {
  return Array.isArray(list) && list.every((item) => shape(item, checks));
}

export type SnapshotResult = { ok: true; data: StudyDataSnapshot } | { ok: false; error: string };

/** Validates an unknown value (storage or user import) as a study data snapshot. */
export function parseSnapshot(raw: unknown): SnapshotResult {
  if (!isRec(raw)) return { ok: false, error: 'File does not contain a study data object.' };

  const settingsOk = shape(raw.settings, {
    name: isStr,
    course: isStr,
    examAttempt: isStr,
    examDate: isDate,
    examDateIsSample: (v) => typeof v === 'boolean',
    finalRevisionDate: isDate,
    examGroups: (v) => Array.isArray(v) && v.every((g) => g === 'Group I' || g === 'Group II'),
    dailyTargetHours: isNum,
    weeklyTargetHours: isNum,
    studyStartTime: (v) => isStr(v) && HHMM.test(v),
    studyEndTime: (v) => isStr(v) && HHMM.test(v),
    pomodoroFocusMinutes: isNum,
    shortBreakMinutes: isNum,
    longBreakMinutes: isNum,
    longBreakEvery: isNum,
    avatar: nullable(isStr),
    theme: isOneOf(THEMES),
  });
  if (!settingsOk) return { ok: false, error: 'Settings are missing or invalid.' };

  const chaptersOk = allValid(raw.chapters, {
    id: isStr,
    subjectId: isStr,
    order: isNum,
    title: isStr,
    status: isOneOf(CHAPTER_STATUSES),
    estimatedHours: isNum,
    actualHours: isNum,
    confidence: (v) => isNum(v) && v >= 1 && v <= 5,
    questionsPracticed: isNum,
    correctAnswers: isNum,
    lastStudied: nullable(isDate),
    notes: isStr,
  });
  if (!chaptersOk) return { ok: false, error: 'Chapters are missing or invalid.' };

  const sessionsOk = allValid(raw.sessions, {
    id: isStr,
    date: isDate,
    subjectId: isStr,
    chapterId: isStr,
    startTime: (v) => isStr(v) && HHMM.test(v),
    durationMinutes: isNum,
    status: isOneOf(SESSION_STATUSES),
    priority: isOneOf(PRIORITIES),
    notes: isStr,
  });
  if (!sessionsOk) return { ok: false, error: 'Study sessions are missing or invalid.' };

  const revisionsOk = allValid(raw.revisions, {
    id: isStr,
    chapterId: isStr,
    revisionNumber: (v) => v === 1 || v === 2 || v === 3 || v === 'final',
    dueDate: isDate,
    completedOn: nullable(isDate),
    priority: isOneOf(PRIORITIES),
  });
  if (!revisionsOk) return { ok: false, error: 'Revisions are missing or invalid.' };

  const focusOk = allValid(raw.focusLog, {
    id: isStr,
    date: isDate,
    subjectId: isStr,
    chapterId: isStr,
    minutes: isNum,
    mode: isOneOf(FOCUS_MODES),
    notes: isStr,
    sessionId: nullable(isStr),
  });
  if (!focusOk) return { ok: false, error: 'Focus history is missing or invalid.' };

  const mocksOk = allValid(raw.mockExams, {
    id: isStr,
    date: isDate,
    subjectId: isStr,
    name: isStr,
    score: isNum,
    maxScore: isNum,
  });
  if (!mocksOk) return { ok: false, error: 'Mock exam records are missing or invalid.' };

  // Older exports have no practice history; treat it as optional.
  const practiceRaw = raw.practiceLog ?? [];
  const practiceOk = allValid(practiceRaw, {
    id: isStr,
    date: isDate,
    chapterId: isStr,
    subjectId: isStr,
    questions: isNum,
    correct: isNum,
  });
  if (!practiceOk) return { ok: false, error: 'Practice history is invalid.' };

  const { settings, chapters, sessions, revisions, focusLog, mockExams } = raw as unknown as StudyDataSnapshot;
  return {
    ok: true,
    data: { settings, chapters, sessions, revisions, focusLog, mockExams, practiceLog: practiceRaw as StudyDataSnapshot['practiceLog'] },
  };
}

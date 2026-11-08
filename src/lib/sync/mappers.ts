import type { Chapter, FocusRecord, MockExam, PracticeRecord, RevisionNumber, RevisionTask, Settings, StudyDataSnapshot, StudySession } from '@/types/study';
import { entityId, toMap, type Entity, type EntityMap, type EntityRow, type Table } from './types';

const SELF = 'self';

/**
 * Snapshot <-> entities. Pure and typed: no network, no storage, no clock.
 *
 * EXCLUDED on purpose (never synced):
 *   - `demo` flags and `meta` (demo content does not exist in account mode)
 *   - derived chapter fields (actual hours, questions, correct, last studied): the server derives them from the records, so are the
 *     records, not the totals, that travel. Totals are rebuilt here from the records.
 *   - settings, enrolment and profile (they have their own owners), the avatar (stays on this device), the timer (device-local)
 */

const DEFAULT_PROGRESS = { status: 'not_started', confidence: 1, notes: '', completed_on: null } as const;

const revisionToNumber = (n: RevisionNumber): number => (n === 'final' ? 4 : n);
const numberToRevision = (n: number): RevisionNumber => (n === 4 ? 'final' : (n as 1 | 2 | 3));

export interface EntityContext {
  /** The attempt's official exam start date. Never written: only a date that differs from it is the student's own override. */
  officialExamDate: string | null;
}

export function snapshotToEntities(snapshot: StudyDataSnapshot, ctx: EntityContext = { officialExamDate: null }): EntityMap {
  const out: Entity[] = [];
  const st = snapshot.settings;
  out.push({ table: 'profiles', key: SELF, row: { display_name: st.name } });
  out.push({
    table: 'user_settings', key: SELF,
    row: { daily_target_hours: st.dailyTargetHours, weekly_target_hours: st.weeklyTargetHours, study_start_time: st.studyStartTime, study_end_time: st.studyEndTime, pomodoro_focus_minutes: st.pomodoroFocusMinutes, short_break_minutes: st.shortBreakMinutes, long_break_minutes: st.longBreakMinutes, long_break_every: st.longBreakEvery, theme: st.theme },
  });
  // Only the student's OWN date is an override. An empty date, or the official one, means "no override" (null).
  out.push({ table: 'student_enrollments', key: SELF, row: { exam_date_override: st.examDate === '' || st.examDate === ctx.officialExamDate ? null : st.examDate, final_revision_date: st.finalRevisionDate === '' ? null : st.finalRevisionDate } });
  for (const c of snapshot.chapters) {
    const row = { chapter_id: c.id, status: c.status, confidence: c.confidence, notes: c.notes, completed_on: c.completedOn ?? null };
    const isDefault = row.status === DEFAULT_PROGRESS.status && row.confidence === DEFAULT_PROGRESS.confidence && row.notes === DEFAULT_PROGRESS.notes && row.completed_on === null;
    if (!isDefault) out.push({ table: 'chapter_progress', key: c.id, row });
  }
  for (const s of snapshot.sessions) {
    out.push({
      table: 'planner_sessions', key: s.id,
      // "missed" is derived from an upcoming session whose date has passed, so it is stored as upcoming
      row: { client_id: s.id, chapter_id: s.chapterId, planned_date: s.date, start_time: s.startTime, duration_minutes: s.durationMinutes, status: s.status === 'missed' ? 'upcoming' : s.status, priority: s.priority, notes: s.notes },
    });
  }
  for (const r of snapshot.focusLog) {
    out.push({ table: 'study_sessions', key: r.id, row: { client_id: r.id, chapter_id: r.chapterId, local_date: r.date, minutes: r.minutes, mode: r.mode, notes: r.notes, planner_client_id: r.sessionId } });
  }
  for (const r of snapshot.revisions) {
    out.push({ table: 'revisions', key: r.id, row: { client_id: r.id, chapter_id: r.chapterId, revision_number: revisionToNumber(r.revisionNumber), due_date: r.dueDate, completed_on: r.completedOn, cancelled_on: r.cancelledOn ?? null, priority: r.priority } });
  }
  for (const p of snapshot.practiceLog) {
    out.push({ table: 'practice_records', key: p.id, row: { client_id: p.id, chapter_id: p.chapterId, local_date: p.date, questions: p.questions, correct: p.correct } });
  }
  for (const m of snapshot.mockExams) {
    out.push({ table: 'mock_tests', key: m.id, row: { client_id: m.id, subject_id: m.subjectId, taken_on: m.date, name: m.name, score: m.score, max_score: m.maxScore } });
  }
  return toMap(out);
}

export interface BaseForRows {
  /** Settings as they are now; the synced fields are replaced by the account's values, the rest (avatar, course, groups, attempt) are kept. */
  settings: Settings;
  /** The attempt's official exam date, or null when none is announced. */
  officialExamDate?: string | null;
  /** The curriculum's chapters, blank (see `buildAccountChapters`). Include retired chapters the student has records on. */
  chapters: Chapter[];
}

export interface MapIssue { table: Table; key: string; problem: string }

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nullable = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const hm = (v: unknown): string => str(v).slice(0, 5);

/** Entities -> snapshot. Rows that refer to a chapter or subject the curriculum does not have are skipped and reported, never half-shown. */
export function entitiesToSnapshot(entities: EntityMap, base: BaseForRows): { snapshot: StudyDataSnapshot; issues: MapIssue[] } {
  const issues: MapIssue[] = [];
  const subjectOf = new Map(base.chapters.map((c) => [c.id, c.subjectId]));
  const subjects = new Set(base.chapters.map((c) => c.subjectId));
  const by = (table: Table) => [...entities.values()].filter((e) => e.table === table);
  const skip = (e: Entity, problem: string) => void issues.push({ table: e.table, key: e.key, problem });

  const sessions: StudySession[] = [];
  for (const e of by('planner_sessions')) {
    const r = e.row;
    if (!subjectOf.has(str(r.chapter_id))) { skip(e, 'unknown chapter'); continue; }
    sessions.push({
      id: e.key, date: str(r.planned_date), subjectId: subjectOf.get(str(r.chapter_id)) ?? '', chapterId: str(r.chapter_id), startTime: hm(r.start_time),
      durationMinutes: num(r.duration_minutes), status: str(r.status, 'upcoming') as StudySession['status'], priority: str(r.priority, 'medium') as StudySession['priority'], notes: str(r.notes),
    });
  }
  const plannerIds = new Set(sessions.map((s) => s.id));

  const focusLog: FocusRecord[] = [];
  for (const e of by('study_sessions')) {
    const r = e.row;
    if (!subjectOf.has(str(r.chapter_id))) { skip(e, 'unknown chapter'); continue; }
    const planner = nullable(r.planner_client_id);
    focusLog.push({
      id: e.key, date: str(r.local_date), subjectId: subjectOf.get(str(r.chapter_id)) ?? '', chapterId: str(r.chapter_id), minutes: num(r.minutes),
      mode: str(r.mode, 'stopwatch') as FocusRecord['mode'], notes: str(r.notes), sessionId: planner !== null && plannerIds.has(planner) ? planner : null,
    });
  }

  const revisions: RevisionTask[] = [];
  for (const e of by('revisions')) {
    const r = e.row;
    if (!subjectOf.has(str(r.chapter_id))) { skip(e, 'unknown chapter'); continue; }
    const task: RevisionTask = { id: e.key, chapterId: str(r.chapter_id), revisionNumber: numberToRevision(num(r.revision_number)), dueDate: str(r.due_date), completedOn: nullable(r.completed_on), priority: str(r.priority, 'medium') as RevisionTask['priority'] };
    const cancelled = nullable(r.cancelled_on);
    revisions.push(cancelled === null ? task : { ...task, cancelledOn: cancelled });
  }

  const practiceLog: PracticeRecord[] = [];
  for (const e of by('practice_records')) {
    const r = e.row;
    if (!subjectOf.has(str(r.chapter_id))) { skip(e, 'unknown chapter'); continue; }
    practiceLog.push({ id: e.key, date: str(r.local_date), chapterId: str(r.chapter_id), subjectId: subjectOf.get(str(r.chapter_id)) ?? '', questions: num(r.questions), correct: num(r.correct) });
  }

  const mockExams: MockExam[] = [];
  for (const e of by('mock_tests')) {
    const r = e.row;
    if (!subjects.has(str(r.subject_id))) { skip(e, 'unknown subject'); continue; }
    mockExams.push({ id: e.key, date: str(r.taken_on), subjectId: str(r.subject_id), name: str(r.name), score: num(r.score), maxScore: num(r.max_score) });
  }

  const progress = new Map(by('chapter_progress').map((e) => [e.key, e.row]));
  const chapters = base.chapters.map((c): Chapter => {
    const p = progress.get(c.id);
    const mine = focusLog.filter((f) => f.chapterId === c.id);
    const practised = practiceLog.filter((x) => x.chapterId === c.id);
    const dates = [...mine.map((f) => f.date), ...practised.map((x) => x.date)];
    return {
      ...c,
      status: p ? (str(p.status, 'not_started') as Chapter['status']) : 'not_started',
      confidence: p ? (num(p.confidence, 1) as Chapter['confidence']) : 1,
      notes: p ? str(p.notes) : '',
      completedOn: p ? nullable(p.completed_on) : null,
      actualHours: mine.reduce((a, f) => a + f.minutes, 0) / 60,
      questionsPracticed: practised.reduce((a, x) => a + x.questions, 0),
      correctAnswers: practised.reduce((a, x) => a + x.correct, 0),
      lastStudied: dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b)),
    };
  });

  const settings = mergeSettings(base, by);
  return { snapshot: { settings, chapters, sessions, revisions, focusLog, mockExams, practiceLog, meta: { seedAnchor: null } }, issues };
}

function mergeSettings(base: BaseForRows, by: (t: Table) => Entity[]): Settings {
  const s = { ...base.settings };
  const profile = by('profiles')[0]?.row;
  const prefs = by('user_settings')[0]?.row;
  const dates = by('student_enrollments')[0]?.row;
  if (profile && typeof profile.display_name === 'string') s.name = profile.display_name;
  if (prefs) {
    if (typeof prefs.daily_target_hours === 'number') s.dailyTargetHours = prefs.daily_target_hours;
    if (typeof prefs.weekly_target_hours === 'number') s.weeklyTargetHours = prefs.weekly_target_hours;
    if (typeof prefs.study_start_time === 'string') s.studyStartTime = hm(prefs.study_start_time);
    if (typeof prefs.study_end_time === 'string') s.studyEndTime = hm(prefs.study_end_time);
    if (typeof prefs.pomodoro_focus_minutes === 'number') s.pomodoroFocusMinutes = prefs.pomodoro_focus_minutes;
    if (typeof prefs.short_break_minutes === 'number') s.shortBreakMinutes = prefs.short_break_minutes;
    if (typeof prefs.long_break_minutes === 'number') s.longBreakMinutes = prefs.long_break_minutes;
    if (typeof prefs.long_break_every === 'number') s.longBreakEvery = prefs.long_break_every;
    if (prefs.theme === 'dark' || prefs.theme === 'light' || prefs.theme === 'system') s.theme = prefs.theme;
  }
  if (dates) {
    s.examDate = typeof dates.exam_date_override === 'string' ? dates.exam_date_override : (base.officialExamDate ?? '');
    s.finalRevisionDate = typeof dates.final_revision_date === 'string' ? dates.final_revision_date : '';
  }
  return s;
}

/** Problems that would make the database refuse a row for good. Found before queuing, so a bad row never sits in the outbox retrying. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateEntity(e: Entity): string | null {
  const r = e.row;
  if (e.table === 'profiles') return typeof r.display_name === 'string' && r.display_name.length >= 1 && r.display_name.length <= 80 ? null : 'invalid name';
  if (e.table === 'user_settings') {
    const n = (k: string, min: number, max: number) => typeof r[k] === 'number' && (r[k] as number) >= min && (r[k] as number) <= max;
    const t = (k: string) => typeof r[k] === 'string' && /^\d{2}:\d{2}$/.test(r[k] as string);
    return n('daily_target_hours', 1, 16) && n('weekly_target_hours', 1, 100) && n('pomodoro_focus_minutes', 5, 180) && n('short_break_minutes', 1, 60) && n('long_break_minutes', 1, 90) && n('long_break_every', 2, 10) && t('study_start_time') && t('study_end_time') && (r.study_end_time as string) > (r.study_start_time as string) && ['dark', 'light', 'system'].includes(String(r.theme)) ? null : 'invalid settings';
  }
  if (e.table === 'student_enrollments') {
    // Only the FORMAT is checked here. The database's own bounds (2000-2100) and "final revision on or before the exam" rules decide the rest.
    const d = (k: string) => r[k] === null || (typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[k] as string));
    return d('exam_date_override') && d('final_revision_date') ? null : 'invalid date';
  }
  // Curriculum ids in an account are database uuids. Anything else (the sample curriculum's ids) can never belong to an account.
  const ref = e.table === 'mock_tests' ? r.subject_id : r.chapter_id;
  if (typeof ref !== 'string' || !UUID.test(ref)) return 'not an account curriculum id';
  const text = (k: string, max: number) => typeof r[k] === 'string' && (r[k] as string).length <= max;
  const date = (k: string) => typeof r[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[k] as string);
  const int = (k: string, min: number, max: number) => Number.isInteger(r[k]) && (r[k] as number) >= min && (r[k] as number) <= max;
  switch (e.table) {
    case 'chapter_progress': return int('confidence', 1, 5) && text('notes', 5000) ? null : 'invalid chapter progress';
    case 'planner_sessions': return date('planned_date') && int('duration_minutes', 5, 600) && text('notes', 5000) && /^\d{2}:\d{2}$/.test(String(r.start_time)) ? null : 'invalid planned session';
    case 'study_sessions': return date('local_date') && int('minutes', 1, 1440) && text('notes', 5000) && e.key.length > 0 && e.key.length <= 200 ? null : 'invalid focus record';
    case 'revisions': return date('due_date') && int('revision_number', 1, 4) && !(r.completed_on && r.cancelled_on) ? null : 'invalid revision';
    case 'practice_records': return date('local_date') && int('questions', 1, 32767) && int('correct', 0, 32767) && (r.correct as number) <= (r.questions as number) ? null : 'invalid practice record';
    case 'mock_tests': return date('taken_on') && typeof r.name === 'string' && r.name.length >= 1 && r.name.length <= 100 && typeof r.max_score === 'number' && r.max_score > 0 && typeof r.score === 'number' && r.score >= 0 && r.score <= r.max_score ? null : 'invalid mock test';
  }
}

export { entityId };
export type { EntityRow };

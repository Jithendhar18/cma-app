import { describe, expect, it } from 'vitest';
import { buildAccountSnapshot } from '@/lib/account/accountSnapshot';
import { ENROLLMENT, FIXTURE_TREE, PROFILE, U, USER_SETTINGS } from '@/test/accountFixtures';
import type { StudyDataSnapshot } from '@/types/study';
import { entitiesToSnapshot, snapshotToEntities, validateEntity } from './mappers';

const empty = buildAccountSnapshot({ profile: PROFILE(U(100)), settings: USER_SETTINGS, enrollment: ENROLLMENT, curriculum: FIXTURE_TREE });
const [c1, c2, c3] = empty.chapters;
const base = { settings: empty.settings, chapters: empty.chapters };

/** A snapshot whose derived chapter totals agree with its records (as the store and the server keep them). */
function consistent(): StudyDataSnapshot {
  const s: StudyDataSnapshot = {
    ...empty,
    sessions: [
      { id: 's-1', date: '2026-11-09', subjectId: c1.subjectId, chapterId: c1.id, startTime: '09:30', durationMinutes: 90, status: 'completed', priority: 'high', notes: 'plan' },
      { id: 's-2', date: '2026-11-10', subjectId: c2.subjectId, chapterId: c2.id, startTime: '18:00', durationMinutes: 60, status: 'upcoming', priority: 'low', notes: '' },
    ],
    focusLog: [
      { id: 'plan-s-1', date: '2026-11-09', subjectId: c1.subjectId, chapterId: c1.id, minutes: 90, mode: 'planner', notes: 'plan', sessionId: 's-1' },
      { id: 'focus-abc', date: '2026-11-08', subjectId: c1.subjectId, chapterId: c1.id, minutes: 25, mode: 'pomodoro', notes: '', sessionId: null },
    ],
    practiceLog: [{ id: 'pr-1', date: '2026-11-07', chapterId: c2.id, subjectId: c2.subjectId, questions: 20, correct: 15 }],
    revisions: [
      { id: 'rev-1', chapterId: c1.id, revisionNumber: 1, dueDate: '2026-11-10', completedOn: '2026-11-10', priority: 'medium' },
      { id: 'rev-2', chapterId: c1.id, revisionNumber: 'final', dueDate: '2026-12-01', completedOn: null, priority: 'high' },
      { id: 'rev-3', chapterId: c2.id, revisionNumber: 2, dueDate: '2026-11-20', completedOn: null, cancelledOn: '2026-11-11', priority: 'low' },
    ],
    mockExams: [{ id: 'm-1', date: '2026-11-05', subjectId: c1.subjectId, name: 'FAKE mock', score: 61.5, maxScore: 100 }],
  };
  return {
    ...s,
    chapters: s.chapters.map((c) => {
      if (c.id === c1.id) return { ...c, status: 'completed', confidence: 4, notes: 'good', completedOn: '2026-11-09', actualHours: 115 / 60, lastStudied: '2026-11-09' };
      if (c.id === c2.id) return { ...c, status: 'practising', questionsPracticed: 20, correctAnswers: 15, lastStudied: '2026-11-07' };
      return c;
    }),
  };
}

describe('golden round trip', () => {
  it('rowsToSnapshot(snapshotToRows(x)) equals x', () => {
    const x = consistent();
    const { snapshot, issues } = entitiesToSnapshot(snapshotToEntities(x), base);
    expect(issues).toEqual([]);
    expect(snapshot).toEqual(x);
  });
  it('the empty account snapshot produces only the three always-present account records and comes back unchanged', () => {
    expect([...snapshotToEntities(empty).keys()].sort()).toEqual(['profiles:self', 'student_enrollments:self', 'user_settings:self']);
    expect(entitiesToSnapshot(snapshotToEntities(empty), base).snapshot).toEqual(empty);
  });
  it('is stable: a second round trip changes nothing', () => {
    const once = entitiesToSnapshot(snapshotToEntities(consistent()), base).snapshot;
    expect(entitiesToSnapshot(snapshotToEntities(once), base).snapshot).toEqual(once);
  });
});

describe('what is synced and what is not', () => {
  it('never includes demo flags, meta, settings, or derived chapter totals', () => {
    const x = consistent();
    x.focusLog[0] = { ...x.focusLog[0], demo: true };
    const json = JSON.stringify([...snapshotToEntities(x).values()]);
    expect(json).not.toContain('demo');
    expect(json).not.toContain('seedAnchor');
    expect(json).not.toContain('actualHours');
    expect(json).not.toContain('questionsPracticed');
    expect(json).not.toContain('avatar');
    expect(json).not.toContain('dailyTargetHours');
  });
  it('emits one chapter-progress row only for chapters the student has touched', () => {
    const rows = [...snapshotToEntities(consistent()).values()].filter((e) => e.table === 'chapter_progress');
    expect(rows.map((e) => e.key).sort()).toEqual([c1.id, c2.id].sort());
    expect(rows.map((e) => e.key)).not.toContain(c3.id);
  });
  it('stores a missed planned session as upcoming (missed is derived from the date)', () => {
    const x = consistent();
    x.sessions[1] = { ...x.sessions[1], status: 'missed' };
    expect([...snapshotToEntities(x).values()].find((e) => e.key === 's-2')?.row.status).toBe('upcoming');
  });
  it('maps the final revision to 4 and back', () => {
    const e = snapshotToEntities(consistent()).get('revisions:rev-2');
    expect(e?.row.revision_number).toBe(4);
  });
  it('keeps the planned session link only if that session exists', () => {
    const x = consistent();
    const ents = snapshotToEntities(x);
    ents.delete('planner_sessions:s-1');
    const back = entitiesToSnapshot(ents, base).snapshot;
    expect(back.focusLog.find((f) => f.id === 'plan-s-1')?.sessionId).toBeNull();
  });
  it('rebuilds chapter totals from the records, so a stale local total can never be pushed or pulled', () => {
    const ents = snapshotToEntities(consistent());
    const back = entitiesToSnapshot(ents, base).snapshot;
    expect(back.chapters.find((c) => c.id === c1.id)?.actualHours).toBeCloseTo(115 / 60);
  });
});

describe('rows that do not belong to this curriculum', () => {
  it('skips and reports a record for an unknown chapter instead of showing it', () => {
    const ents = snapshotToEntities(consistent());
    ents.set('practice_records:pr-x', { table: 'practice_records', key: 'pr-x', row: { client_id: 'pr-x', chapter_id: U(99999), local_date: '2026-11-01', questions: 5, correct: 1 } });
    const { snapshot, issues } = entitiesToSnapshot(ents, base);
    expect(snapshot.practiceLog.map((p) => p.id)).toEqual(['pr-1']);
    expect(issues).toEqual([{ table: 'practice_records', key: 'pr-x', problem: 'unknown chapter' }]);
  });
});

describe('validateEntity', () => {
  const ok = (table: string, key: string) => snapshotToEntities(consistent()).get(`${table}:${key}`)!;
  it('accepts everything the app itself produces', () => {
    for (const e of snapshotToEntities(consistent()).values()) expect(validateEntity(e), `${e.table}:${e.key}`).toBeNull();
  });
  it('rejects rows the database would refuse for good', () => {
    expect(validateEntity({ ...ok('study_sessions', 'focus-abc'), row: { ...ok('study_sessions', 'focus-abc').row, minutes: 0 } })).not.toBeNull();
    expect(validateEntity({ ...ok('study_sessions', 'focus-abc'), row: { ...ok('study_sessions', 'focus-abc').row, minutes: 1441 } })).not.toBeNull();
    expect(validateEntity({ ...ok('practice_records', 'pr-1'), row: { ...ok('practice_records', 'pr-1').row, correct: 21 } })).not.toBeNull();
    expect(validateEntity({ ...ok('mock_tests', 'm-1'), row: { ...ok('mock_tests', 'm-1').row, score: 101 } })).not.toBeNull();
    expect(validateEntity({ ...ok('mock_tests', 'm-1'), row: { ...ok('mock_tests', 'm-1').row, name: '' } })).not.toBeNull();
    expect(validateEntity({ ...ok('planner_sessions', 's-1'), row: { ...ok('planner_sessions', 's-1').row, duration_minutes: 4 } })).not.toBeNull();
    expect(validateEntity({ ...ok('revisions', 'rev-1'), row: { ...ok('revisions', 'rev-1').row, cancelled_on: '2026-11-11' } })).not.toBeNull();
    expect(validateEntity({ ...ok('chapter_progress', c1.id), row: { ...ok('chapter_progress', c1.id).row, confidence: 6 } })).not.toBeNull();
  });
});

describe('account settings, profile and the student\'s own dates', () => {
  const withSettings = (over: Partial<StudyDataSnapshot['settings']>): StudyDataSnapshot => ({ ...empty, settings: { ...empty.settings, ...over } });
  const OFFICIAL = '2027-06-01';

  it('carries the display name and every setting, and nothing else from settings (no avatar, course, attempt or groups)', () => {
    const e = snapshotToEntities(withSettings({ name: 'Priya', dailyTargetHours: 6, weeklyTargetHours: 40, studyStartTime: '07:30', studyEndTime: '22:00', pomodoroFocusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 3, theme: 'light', avatar: 'data:image/png;base64,AAAA', course: 'X', examAttempt: 'Y' }));
    expect(e.get('profiles:self')?.row).toEqual({ display_name: 'Priya' });
    expect(e.get('user_settings:self')?.row).toEqual({ daily_target_hours: 6, weekly_target_hours: 40, study_start_time: '07:30', study_end_time: '22:00', pomodoro_focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, long_break_every: 3, theme: 'light' });
    const json = JSON.stringify([...e.values()]);
    expect(json).not.toContain('AAAA');
    expect(json).not.toMatch(/csv_id|exam_attempt_id|status|user_id|enrollment_id/);
  });

  it('treats only a date that differs from the official one as an override', () => {
    const ctx = { officialExamDate: OFFICIAL };
    expect(snapshotToEntities(withSettings({ examDate: OFFICIAL }), ctx).get('student_enrollments:self')?.row.exam_date_override).toBeNull();
    expect(snapshotToEntities(withSettings({ examDate: '' }), ctx).get('student_enrollments:self')?.row.exam_date_override).toBeNull();
    expect(snapshotToEntities(withSettings({ examDate: '2027-06-10' }), ctx).get('student_enrollments:self')?.row.exam_date_override).toBe('2027-06-10');
    expect(snapshotToEntities(withSettings({ finalRevisionDate: '2027-05-20' }), ctx).get('student_enrollments:self')?.row.final_revision_date).toBe('2027-05-20');
    expect(snapshotToEntities(withSettings({ finalRevisionDate: '' }), ctx).get('student_enrollments:self')?.row.final_revision_date).toBeNull();
  });

  it('round-trips settings and dates, and shows the official date when there is no override', () => {
    const x = withSettings({ name: 'Priya', theme: 'system', studyStartTime: '05:45', examDate: '2027-06-10', finalRevisionDate: '2027-05-20' });
    const back = entitiesToSnapshot(snapshotToEntities(x, { officialExamDate: OFFICIAL }), { ...base, settings: x.settings, officialExamDate: OFFICIAL }).snapshot;
    expect(back).toEqual(x);
    const official = withSettings({ examDate: OFFICIAL });
    expect(entitiesToSnapshot(snapshotToEntities(official, { officialExamDate: OFFICIAL }), { ...base, settings: official.settings, officialExamDate: OFFICIAL }).snapshot.settings.examDate).toBe(OFFICIAL);
  });

  it('keeps the device-only fields (avatar, course, attempt, groups) from the base when applying account values', () => {
    const ents = snapshotToEntities(withSettings({ name: 'Server Name' }));
    const out = entitiesToSnapshot(ents, { ...base, settings: { ...empty.settings, avatar: 'data:image/png;base64,KEEP', name: 'stale' } }).snapshot.settings;
    expect(out.name).toBe('Server Name');
    expect(out.avatar).toBe('data:image/png;base64,KEEP');
    expect(out.examGroups).toEqual(empty.settings.examGroups);
  });

  it('refuses values the database would refuse for good', () => {
    const bad = (s: Partial<StudyDataSnapshot['settings']>, table: string) => validateEntity(snapshotToEntities(withSettings(s)).get(`${table}:self`)!);
    expect(bad({ name: '' }, 'profiles')).not.toBeNull();
    expect(bad({ name: 'x'.repeat(81) }, 'profiles')).not.toBeNull();
    expect(bad({ dailyTargetHours: 17 }, 'user_settings')).not.toBeNull();
    expect(bad({ longBreakEvery: 1 }, 'user_settings')).not.toBeNull();
    expect(bad({ studyStartTime: '23:00', studyEndTime: '06:00' }, 'user_settings')).not.toBeNull();
    expect(bad({ examDate: '27/06/2027' }, 'student_enrollments')).not.toBeNull();
    expect(bad({ name: 'Ok' }, 'profiles')).toBeNull();
    expect(bad({}, 'user_settings')).toBeNull();
  });
});

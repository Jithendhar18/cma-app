import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedData } from '@/data/seed';
import { validateConsistency } from '@/lib/seedValidation';
import { useStudyStore } from '@/stores/studyStore';
import { at, chapter, freezeClock, resetStores, revisionsOf, snapshotOf, TODAY } from '@/test/helpers';

const store = () => useStudyStore.getState();
const pending = (id: string) => revisionsOf(id).filter((r) => !r.completedOn && !r.cancelledOn);

beforeEach(() => {
  freezeClock();
  resetStores();
});

describe('settings', () => {
  it('merges partial updates', () => {
    store().updateSettings({ dailyTargetHours: 6, theme: 'light' });
    expect(store().settings).toMatchObject({ dailyTargetHours: 6, theme: 'light', name: 'Jithendhar' });
  });
});

describe('chapter completion and revisions', () => {
  it('schedules revision 1 for tomorrow when a chapter is first completed', () => {
    expect(revisionsOf('p5-5')).toHaveLength(0);
    store().updateChapter('p5-5', { status: 'completed' });
    const [rev] = revisionsOf('p5-5');
    expect(rev).toMatchObject({ revisionNumber: 1, dueDate: '2026-11-11', completedOn: null });
    expect(chapter('p5-5').completedOn).toBe(TODAY);
  });

  it('does not schedule a second revision when moving between completed states', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    store().updateChapter('p5-5', { status: 'exam_ready' });
    store().updateChapter('p5-5', { status: 'revision_due' });
    expect(revisionsOf('p5-5')).toHaveLength(1);
  });

  it('does not create revisions when a chapter that already has a pending one is re-marked complete', () => {
    store().updateChapter('p5-3', { status: 'completed' });
    expect(pending('p5-3')).toHaveLength(1);
  });

  it('cancels pending revisions when a chapter is marked incomplete, keeping them as history', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    store().updateChapter('p5-5', { status: 'practising' });
    const [rev] = revisionsOf('p5-5');
    expect(rev.cancelledOn).toBe(TODAY);
    expect(pending('p5-5')).toHaveLength(0);
    expect(chapter('p5-5').completedOn).toBeNull();
    expect(validateConsistency(snapshotOf(store()))).toEqual([]);
  });

  it('keeps completed revision history when the chapter is marked incomplete', () => {
    // p6-2 has completed revisions 1 and 2 in the demo data.
    const before = revisionsOf('p6-2').filter((r) => r.completedOn);
    expect(before.length).toBe(2);
    store().updateChapter('p6-2', { status: 'learning' });
    const after = revisionsOf('p6-2');
    expect(after.filter((r) => r.completedOn)).toHaveLength(2);
    expect(after.every((r) => r.completedOn || r.cancelledOn)).toBe(true);
  });

  it('continues after the last completed revision when the chapter is completed again', () => {
    store().updateChapter('p6-2', { status: 'learning' });
    store().updateChapter('p6-2', { status: 'completed' });
    const next = pending('p6-2');
    expect(next).toHaveLength(1);
    expect(next[0].revisionNumber).toBe(3);
    expect(next[0].dueDate).toBe('2026-12-01');
    expect(validateConsistency(snapshotOf(store()))).toEqual([]);
  });

  it('restarts at revision 1 if nothing was ever completed', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    store().updateChapter('p5-5', { status: 'learning' });
    store().updateChapter('p5-5', { status: 'completed' });
    expect(pending('p5-5').map((r) => r.revisionNumber)).toEqual([1]);
    expect(revisionsOf('p5-5')).toHaveLength(2);
  });

  it('never leaves orphaned active revisions on an incomplete chapter, across any status change', () => {
    const statuses = ['completed', 'learning', 'exam_ready', 'not_started', 'revision_due', 'practising'] as const;
    statuses.forEach((status) => {
      store().updateChapter('p5-5', { status });
      expect(validateConsistency(snapshotOf(store())).filter((p) => p.includes('p5-5'))).toEqual([]);
    });
  });

  it('ignores unknown chapters', () => {
    const before = store().chapters;
    store().updateChapter('nope', { status: 'completed' });
    expect(store().chapters).toBe(before);
  });
});

describe('revision actions', () => {
  it('completing revision 1 schedules revision 2 seven days later', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    const rev1 = revisionsOf('p5-5')[0];
    store().completeRevision(rev1.id);
    expect(revisionsOf('p5-5').find((r) => r.id === rev1.id)?.completedOn).toBe(TODAY);
    const next = pending('p5-5')[0];
    expect(next).toMatchObject({ revisionNumber: 2, dueDate: '2026-11-17' });
  });

  it('follows the 1 → 7 → 21 day chain and ends with the configured final date', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    store().completeRevision(pending('p5-5')[0].id);
    store().completeRevision(pending('p5-5')[0].id);
    expect(pending('p5-5')[0]).toMatchObject({ revisionNumber: 3, dueDate: '2026-12-01' });
    store().completeRevision(pending('p5-5')[0].id);
    expect(pending('p5-5')[0]).toMatchObject({ revisionNumber: 'final', dueDate: store().settings.finalRevisionDate });
    store().completeRevision(pending('p5-5')[0].id);
    expect(pending('p5-5')).toHaveLength(0);
  });

  it('completing twice does nothing the second time and does not duplicate the next revision', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    const id = revisionsOf('p5-5')[0].id;
    store().completeRevision(id);
    const count = store().revisions.length;
    store().completeRevision(id);
    expect(store().revisions).toHaveLength(count);
  });

  it('cannot complete or reschedule a cancelled revision', () => {
    store().updateChapter('p5-5', { status: 'completed' });
    const id = revisionsOf('p5-5')[0].id;
    store().updateChapter('p5-5', { status: 'learning' });
    store().completeRevision(id);
    store().rescheduleRevision(id, '2027-01-01');
    const rev = revisionsOf('p5-5').find((r) => r.id === id)!;
    expect(rev.completedOn).toBeNull();
    expect(rev.dueDate).toBe('2026-11-11');
  });

  it('reschedules a pending revision', () => {
    const id = pending('p5-3')[0].id;
    store().rescheduleRevision(id, '2026-11-20');
    expect(store().revisions.find((r) => r.id === id)?.dueDate).toBe('2026-11-20');
  });

  it('marks a revision_due chapter completed once its revision is done', () => {
    expect(chapter('p5-3').status).toBe('revision_due');
    store().completeRevision(pending('p5-3')[0].id);
    expect(chapter('p5-3').status).toBe('completed');
  });
});

describe('focus records', () => {
  const record = (id: string, minutes = 30, date = TODAY) => ({ id, date, subjectId: 'p8', chapterId: 'p8-3', minutes, mode: 'pomodoro' as const, notes: '', sessionId: null });

  it('adds minutes to the chapter and the daily total exactly once per id', () => {
    const before = chapter('p8-3').actualHours;
    store().addFocusRecord(record('r1'));
    store().addFocusRecord(record('r1'));
    expect(chapter('p8-3').actualHours).toBeCloseTo(before + 0.5, 6);
    expect(store().focusLog.filter((r) => r.id === 'r1')).toHaveLength(1);
  });

  it('ignores zero or negative minutes', () => {
    const count = store().focusLog.length;
    store().addFocusRecord(record('zero', 0));
    store().addFocusRecord(record('neg', -5));
    expect(store().focusLog).toHaveLength(count);
  });

  it('removing a record reverses the chapter hours', () => {
    const before = chapter('p8-3').actualHours;
    store().addFocusRecord(record('r2', 60));
    store().removeFocusRecord('r2');
    expect(chapter('p8-3').actualHours).toBeCloseTo(before, 6);
  });

  it('starts an unstarted chapter when time is logged against it', () => {
    expect(chapter('p5-5').status).toBe('not_started');
    store().addFocusRecord({ ...record('r3'), subjectId: 'p5', chapterId: 'p5-5' });
    expect(chapter('p5-5').status).toBe('learning');
  });

  it('completes a linked planned session', () => {
    store().addFocusRecord({ ...record('r4'), sessionId: 's-3' });
    expect(store().sessions.find((s) => s.id === 's-3')?.status).toBe('completed');
  });

  it('keeps chapter hours consistent with the focus history after many operations', () => {
    store().addFocusRecord(record('c1', 25));
    store().addFocusRecord(record('c2', 40));
    store().removeFocusRecord('c1');
    expect(validateConsistency(snapshotOf(store()))).toEqual([]);
  });
});

describe('practice', () => {
  it('records dated practice and updates chapter totals together', () => {
    const before = chapter('p5-4');
    store().logPractice('p5-4', 20, 15);
    expect(chapter('p5-4').questionsPracticed).toBe(before.questionsPracticed + 20);
    expect(chapter('p5-4').correctAnswers).toBe(before.correctAnswers + 15);
    expect(store().practiceLog[store().practiceLog.length - 1]).toMatchObject({ chapterId: 'p5-4', questions: 20, correct: 15, date: TODAY });
    expect(validateConsistency(snapshotOf(store()))).toEqual([]);
  });

  it('never records more correct answers than questions', () => {
    store().logPractice('p5-4', 10, 99);
    expect(store().practiceLog[store().practiceLog.length - 1].correct).toBe(10);
  });
});

describe('planner sessions', () => {
  const draft = { date: TODAY, subjectId: 'p5', chapterId: 'p5-1', startTime: '09:00', durationMinutes: 60, status: 'upcoming' as const, priority: 'medium' as const, notes: '' };

  it('creates, edits and deletes a session', () => {
    const id = store().addSession(draft);
    expect(store().sessions.some((s) => s.id === id)).toBe(true);
    store().updateSession(id, { durationMinutes: 45 });
    expect(store().sessions.find((s) => s.id === id)?.durationMinutes).toBe(45);
    store().deleteSession(id);
    expect(store().sessions.some((s) => s.id === id)).toBe(false);
  });

  it('completing credits the planned minutes once; un-completing removes only what it added', () => {
    const id = store().addSession(draft);
    const hours = chapter('p5-1').actualHours;
    store().setSessionStatus(id, 'completed');
    store().setSessionStatus(id, 'completed');
    expect(store().focusLog.filter((r) => r.sessionId === id)).toHaveLength(1);
    expect(chapter('p5-1').actualHours).toBeCloseTo(hours + 1, 6);
    store().setSessionStatus(id, 'upcoming');
    expect(store().focusLog.some((r) => r.sessionId === id)).toBe(false);
    expect(chapter('p5-1').actualHours).toBeCloseTo(hours, 6);
  });

  it('splits a session that runs past midnight across both calendar days', () => {
    const id = store().addSession({ ...draft, startTime: '23:30', durationMinutes: 90 });
    const hours = chapter('p5-1').actualHours;
    store().setSessionStatus(id, 'completed');
    const records = store().focusLog.filter((r) => r.sessionId === id).sort((a, b) => a.date.localeCompare(b.date));
    expect(records.map((r) => [r.date, r.minutes])).toEqual([['2026-11-10', 30], ['2026-11-11', 60]]);
    expect(chapter('p5-1').actualHours).toBeCloseTo(hours + 1.5, 6);
    store().setSessionStatus(id, 'upcoming');
    expect(store().focusLog.some((r) => r.sessionId === id)).toBe(false);
    expect(chapter('p5-1').actualHours).toBeCloseTo(hours, 6);
  });

  it('does not confuse similarly named session ids when un-completing', () => {
    const a = store().addSession(draft);
    store().setSessionStatus(a, 'completed');
    store().setSessionStatus('s-3', 'completed');
    store().setSessionStatus(a, 'upcoming');
    expect(store().focusLog.some((r) => r.sessionId === 's-3')).toBe(true);
  });

  it('deleting a session keeps its logged time but detaches it', () => {
    const id = store().addSession(draft);
    store().setSessionStatus(id, 'completed');
    store().deleteSession(id);
    expect(store().focusLog.find((r) => r.id === `plan-${id}`)?.sessionId).toBeNull();
  });
});

describe('demo flags protect user edits', () => {
  it('editing a demo session clears its flag and that of its linked time', () => {
    store().updateSession('s-1', { notes: 'edited' });
    expect(store().sessions.find((s) => s.id === 's-1')?.demo).toBe(false);
    expect(store().focusLog.find((r) => r.sessionId === 's-1')?.demo).toBe(false);
    expect(store().sessions.find((s) => s.id === 's-4')?.demo).toBe(true);
  });

  it('touching a chapter clears its demo flag', () => {
    store().updateChapter('p5-1', { notes: 'mine' });
    expect(chapter('p5-1').demo).toBe(false);
  });

  it('refreshDemoDates moves only untouched demo records', () => {
    store().updateSession('s-3', { notes: 'edited' });
    freezeClock(at(15, 9));
    store().refreshDemoDates();
    const sessions = store().sessions;
    expect(sessions.find((s) => s.id === 's-4')?.date).toBe('2026-11-15');
    expect(sessions.find((s) => s.id === 's-3')?.date).toBe(TODAY);
    expect(store().meta.seedAnchor).toBe('2026-11-15');
    const again = store().sessions;
    store().refreshDemoDates();
    expect(store().sessions).toBe(again);
  });
});

describe('import and reset', () => {
  it('importData replaces study data wholesale', () => {
    const other = createSeedData('2026-10-01');
    store().importData(other);
    expect(store().sessions[0].date).toBe('2026-10-01');
  });

  it('resetDemoData restores a fresh, consistent seed anchored to today', () => {
    store().updateChapter('p5-1', { notes: 'x' });
    store().resetDemoData();
    expect(chapter('p5-1').notes).toBe('');
    expect(store().meta.seedAnchor).toBe(TODAY);
    expect(validateConsistency(snapshotOf(store()))).toEqual([]);
  });

  it('repeated reset never accumulates duplicate records', () => {
    store().resetDemoData();
    const count = store().focusLog.length;
    store().resetDemoData();
    store().resetDemoData();
    expect(store().focusLog).toHaveLength(count);
    expect(new Set(store().focusLog.map((r) => r.id)).size).toBe(count);
  });
});

describe('mock exams', () => {
  it('adds and deletes mock exams', () => {
    store().addMockExam({ date: TODAY, subjectId: 'p5', name: 'Mock 9', score: 60, maxScore: 100 });
    const added = store().mockExams[store().mockExams.length - 1];
    expect(added.name).toBe('Mock 9');
    store().deleteMockExam(added.id);
    expect(store().mockExams.some((m) => m.id === added.id)).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAccountSnapshot } from '@/lib/account/accountSnapshot';
import { accountKeys } from '@/lib/account/keys';
import { CSV, ENROLLMENT, seedBackend, FIXTURE_TREE, PROFILE, U, USER_SETTINGS } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import type { FocusRecord, StudyDataSnapshot } from '@/types/study';
import { SyncEngine, type EngineDeps } from './engine';
import { createExclusive } from './lock';
import { SupabasePersonal } from './supabasePersonal';
import type { Scope } from './types';

const USER = U(100);
const SCOPE: Scope = { userId: USER, enrollmentId: ENROLLMENT.id, csvId: CSV };
const empty = buildAccountSnapshot({ profile: PROFILE(USER), settings: USER_SETTINGS, enrollment: ENROLLMENT, curriculum: FIXTURE_TREE });
const CH = empty.chapters[0];
let b: FakeBackend;
let t = Date.parse('2026-11-08T10:00:00.000Z');
const clock = () => new Date(t).toISOString();

const focus = (id: string, minutes = 25, over: Partial<FocusRecord> = {}): FocusRecord => ({ id, date: '2026-11-08', subjectId: CH.subjectId, chapterId: CH.id, minutes, mode: 'pomodoro', notes: '', sessionId: null, ...over });

function harness(over: Partial<EngineDeps> = {}, initial: StudyDataSnapshot = empty, userId = USER) {
  let snap = initial;
  const applied: StudyDataSnapshot[] = [];
  const engine = new SyncEngine({
    scope: { ...SCOPE, userId }, repo: new SupabasePersonal(b.client), read: () => snap, base: () => ({ settings: empty.settings, chapters: empty.chapters }),
    apply: (s) => { snap = s; applied.push(s); }, now: clock, random: () => 0.5, setTimer: () => 0, clearTimer: () => undefined, ...over,
  });
  return { engine, applied, get snap() { return snap; }, edit: (fn: (s: StudyDataSnapshot) => StudyDataSnapshot) => { snap = fn(snap); }, addFocus: (r: FocusRecord) => { snap = { ...snap, focusLog: [...snap.focusLog, r] }; } };
}

const serverRow = (i: number, over: Record<string, unknown> = {}) => ({ id: U(20000 + i), user_id: USER, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: `f${i}`, chapter_id: CH.id, local_date: '2026-11-08', minutes: 30, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: `2026-11-08T0${i}:00:00.000000Z`, ...over });

beforeEach(() => {
  localStorage.clear();
  b = createFakeBackend();
  b.signInAs(USER, 'a@example.test');
  t = Date.parse('2026-11-08T10:00:00.000Z');
});

describe('hydration', () => {
  it('replaces the mirror with the server data and derives chapter totals from the records', async () => {
    b.tables.study_sessions = [serverRow(1), serverRow(2, { minutes: 90 })];
    const h = harness();
    expect(await h.engine.hydrate()).toBe(true);
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(h.snap.chapters[0].actualHours).toBe(2);
    expect(h.engine.getStatus().phase).toBe('idle');
    expect(h.engine.getStatus().pending).toBe(0);
  });
  it('is not itself a change: hydrating queues nothing and sends nothing', async () => {
    b.tables.study_sessions = [serverRow(1)];
    const h = harness();
    await h.engine.hydrate();
    await h.engine.flush();
    expect(h.engine.outbox.size).toBe(0);
    expect(b.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
  it('keeps every pending change on top of the server data', async () => {
    b.tables.study_sessions = [serverRow(1)];
    const first = harness();
    await first.engine.hydrate();
    first.addFocus(focus('mine-1'));
    first.engine.capture();
    expect(first.engine.outbox.size).toBe(1);
    // a fresh start (new page load) with the pending change still on disk
    const second = harness();
    await second.engine.hydrate();
    expect(second.snap.focusLog.map((f) => f.id).sort()).toEqual(['f1', 'mine-1']);
    expect(second.engine.outbox.size).toBe(1);
  });
  it('captures an edit made while the load was still in flight', async () => {
    const h = harness();
    const pending = h.engine.hydrate();
    h.addFocus(focus('during-load'));
    await pending;
    expect(h.engine.outbox.all().map((o) => o.key)).toEqual(['during-load']);
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['during-load']);
  });
  it('leaves the mirror exactly as it is when the server cannot be reached, and does not treat it as changed', async () => {
    const mirror: StudyDataSnapshot = { ...empty, focusLog: [focus('mirror-1')] };
    b.offline = true;
    const h = harness({ online: () => false }, mirror);
    expect(await h.engine.hydrate()).toBe(false);
    expect(h.snap).toBe(mirror);
    expect(h.applied).toEqual([]);
    expect(h.engine.getStatus().phase).toBe('offline');
    expect(h.engine.outbox.size).toBe(0);
  });
  it('reports a server failure as "needs attention" while online, still showing the mirror', async () => {
    b.failNext('planner_sessions', { code: '500', status: 500, message: 'oops' });
    const h = harness({}, { ...empty, focusLog: [focus('mirror-1')] });
    expect(await h.engine.hydrate()).toBe(false);
    expect(h.engine.getStatus().phase).toBe('attention');
    expect(h.snap.focusLog).toHaveLength(1);
  });
  it('reports rows it had to skip', async () => {
    b.tables.study_sessions = [serverRow(1), serverRow(2, { minutes: 'bad' })];
    const h = harness();
    await h.engine.hydrate();
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['f1']);
    expect(h.engine.getStatus().message).toMatch(/skipped/);
  });
});

describe('capturing and sending', () => {
  it('sends a new record once and clears the queue', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('focus-1'));
    h.engine.capture();
    expect(h.engine.getStatus().pending).toBe(1);
    expect(await h.engine.flush()).toBe(true);
    expect(b.rows('study_sessions')).toHaveLength(1);
    expect(h.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    await h.engine.flush();
    expect(b.calls.filter((c) => c.table === 'study_sessions' && c.op === 'insert')).toHaveLength(1);
  });
  it('writes nothing for a change that was reverted before sending (create then delete)', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('focus-1'));
    h.engine.capture();
    h.edit((s) => ({ ...s, focusLog: [] }));
    h.engine.capture();
    expect(h.engine.outbox.size).toBe(0);
    await h.engine.flush();
    expect(b.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
  it('sends parents before children in one flush (planned session, then its focus record)', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, sessions: [{ id: 's-1', date: '2026-11-09', subjectId: CH.subjectId, chapterId: CH.id, startTime: '09:30', durationMinutes: 60, status: 'completed', priority: 'medium', notes: '' }], focusLog: [focus('plan-s-1', 60, { mode: 'planner', sessionId: 's-1' })] }));
    await h.engine.flush();
    expect(b.rows('study_sessions')[0].planner_session_id).toBe(b.rows('planner_sessions')[0].id);
    expect(h.engine.getStatus().pending).toBe(0);
  });
  it('sends a midnight-split block as two separate records, and a duplicate of the same block once', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: [focus('plan-s-1', 30, { date: '2026-11-08', mode: 'planner' }), focus('plan-s-1@2026-11-09', 30, { date: '2026-11-09', mode: 'planner' })] }));
    await h.engine.flush();
    expect(b.rows('study_sessions').map((r) => r.local_date).sort()).toEqual(['2026-11-08', '2026-11-09']);
    // the same block arriving again (a retry, or a second tab) creates nothing new
    const again = harness();
    again.edit((s) => ({ ...s, focusLog: [focus('plan-s-1', 30, { date: '2026-11-08', mode: 'planner' })] }));
    again.engine.outbox.clear();
    await again.engine.hydrate();
    expect(b.rows('study_sessions')).toHaveLength(2);
  });
  it('syncs an edit of an existing record as an update on its version', async () => {
    b.tables.study_sessions = [serverRow(1)];
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => ({ ...f, notes: 'edited' })) }));
    await h.engine.flush();
    expect(b.rows('study_sessions')[0].notes).toBe('edited');
    expect(b.calls.filter((c) => c.table === 'study_sessions' && c.op === 'update')).toHaveLength(1);
  });
  it('never sends the demo flag or any local-only field', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus({ ...focus('focus-1'), demo: true });
    await h.engine.flush();
    expect(JSON.stringify(b.rows('study_sessions'))).not.toContain('demo');
  });
});

describe('offline and restart', () => {
  it('keeps changes made offline, survives a reload, and sends them when back online with no duplicates', async () => {
    const h = harness();
    await h.engine.hydrate();
    b.offline = true;
    h.addFocus(focus('off-1'));
    h.addFocus(focus('off-2'));
    await h.engine.flush();
    expect(h.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 2 });
    expect(b.rows('study_sessions')).toEqual([]);

    b.offline = false; // new page load
    const reload = harness({}, h.snap);
    await reload.engine.hydrate();
    expect(reload.engine.getStatus().pending).toBe(2);
    await reload.engine.flush();
    expect(b.rows('study_sessions').map((r) => r.client_id).sort()).toEqual(['off-1', 'off-2']);
    expect(reload.engine.getStatus().pending).toBe(0);
  });
  it('does not count being offline as an attempt (no dead-letter however long it lasts)', async () => {
    const h = harness();
    await h.engine.hydrate();
    b.offline = true;
    h.addFocus(focus('off-1'));
    for (let i = 0; i < 30; i++) await h.engine.flush();
    expect(h.engine.outbox.all()[0].attempts).toBe(0);
    expect(h.engine.getStatus().deadLettered).toBe(0);
  });
  it('flushAll reports what could not be sent', async () => {
    const h = harness();
    await h.engine.hydrate();
    b.offline = true;
    h.addFocus(focus('off-1'));
    expect(await h.engine.flushAll()).toEqual({ ok: false, pending: 1 });
    b.offline = false;
    expect(await h.engine.flushAll()).toEqual({ ok: true, pending: 0 });
  });
});

describe('conflicts (the server wins, visibly)', () => {
  it('keeps the server copy, restores it on screen, and logs what was lost', async () => {
    b.tables.study_sessions = [serverRow(1, { notes: 'original' })];
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => ({ ...f, notes: 'mine' })) }));
    h.engine.capture();
    b.rows('study_sessions')[0].notes = 'theirs';
    b.rows('study_sessions')[0].updated_at = b.tick();
    await h.engine.flush();
    expect(b.rows('study_sessions')[0].notes).toBe('theirs');
    expect(h.snap.focusLog[0].notes).toBe('theirs');
    const [c] = h.engine.getConflicts();
    expect(c).toMatchObject({ kind: 'changed-elsewhere', table: 'study_sessions', key: 'f1' });
    expect(c.mine?.notes).toBe('mine');
    expect(c.theirs?.notes).toBe('theirs');
    expect(h.engine.getStatus().conflicts).toBe(1);
    expect(h.engine.getStatus().pending).toBe(0);
  });
  it('persists the conflict log for the next session, per user', async () => {
    b.tables.study_sessions = [serverRow(1, { notes: 'original' })];
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => ({ ...f, notes: 'mine' })) }));
    h.engine.capture();
    b.rows('study_sessions')[0].updated_at = b.tick();
    await h.engine.flush();
    expect(harness().engine.getConflicts()).toHaveLength(1);
    expect(localStorage.getItem(accountKeys(USER).conflicts)).toContain('mine');
    expect(new SyncEngine({ ...({} as EngineDeps), scope: { ...SCOPE, userId: U(101) }, repo: new SupabasePersonal(b.client), read: () => empty, base: () => ({ settings: empty.settings, chapters: empty.chapters }), apply: () => undefined }).getConflicts()).toEqual([]);
  });
  it('a row deleted elsewhere is removed here and logged, not resurrected', async () => {
    b.tables.study_sessions = [serverRow(1)];
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => ({ ...f, notes: 'mine' })) }));
    h.engine.capture();
    b.tables.study_sessions = [];
    await h.engine.flush();
    expect(h.snap.focusLog).toEqual([]);
    expect(h.engine.getConflicts()[0]).toMatchObject({ kind: 'deleted-elsewhere' });
    expect(b.rows('study_sessions')).toEqual([]);
  });
  it('a stale delete does not remove a row that changed elsewhere', async () => {
    b.tables.study_sessions = [serverRow(1)];
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: [] }));
    h.engine.capture();
    b.rows('study_sessions')[0].minutes = 77;
    b.rows('study_sessions')[0].updated_at = b.tick();
    await h.engine.flush();
    expect(b.rows('study_sessions')).toHaveLength(1);
    expect(h.snap.focusLog[0].minutes).toBe(77);
    expect(h.engine.getConflicts()[0].kind).toBe('changed-elsewhere');
  });
  it('can export the conflict log and the set-aside changes', async () => {
    b.tables.study_sessions = [serverRow(1)];
    const h = harness();
    await h.engine.hydrate();
    const dump = h.engine.exportDiagnostics();
    expect(Object.keys(dump).sort()).toEqual(['conflicts', 'exportedAt', 'pending', 'setAside']);
  });
});

describe('failures', () => {
  it('sets a refused change aside (it can never succeed), tells the student, and keeps sending the rest', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('bad'));
    h.addFocus(focus('good'));
    b.failNext('study_sessions', { code: '23514', message: 'check violated' }, 1, 'insert');
    await h.engine.flush();
    expect(b.rows('study_sessions').map((r) => r.client_id)).toEqual(['good']);
    expect(h.engine.getStatus()).toMatchObject({ phase: 'attention', pending: 0, deadLettered: 1 });
    expect(h.engine.getDeadLetters()[0].op.key).toBe('bad');
  });
  it('sets aside a row the database would refuse before it ever enters the queue', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('zero', 0));
    h.engine.capture();
    expect(h.engine.outbox.size).toBe(0);
    expect(h.engine.getStatus().deadLettered).toBe(1);
  });
  it('backs off a transient failure with a growing delay and succeeds later', async () => {
    const timers: number[] = [];
    const h = harness({ setTimer: (_f, ms) => timers.push(ms) });
    await h.engine.hydrate();
    h.addFocus(focus('f'));
    b.failNext('study_sessions', { code: '503', status: 503, message: 'busy' }, 2, 'insert');
    await h.engine.flush();
    const first = h.engine.outbox.all()[0];
    expect(first.attempts).toBe(1);
    expect(first.notBefore).not.toBeNull();
    expect(timers.length).toBe(1);
    await h.engine.flush(); // not due yet: nothing is sent
    expect(h.engine.outbox.all()[0].attempts).toBe(1);
    t += 60_000;
    await h.engine.flush();
    expect(h.engine.outbox.all()[0].attempts).toBe(2);
    expect(Date.parse(h.engine.outbox.all()[0].notBefore!) - t).toBeGreaterThan(Date.parse(first.notBefore!) - (t - 60_000));
    t += 600_000;
    await h.engine.flush();
    expect(b.rows('study_sessions')).toHaveLength(1);
    expect(h.engine.getStatus().pending).toBe(0);
  });
  it('gives up on a change that keeps failing, setting it aside rather than retrying for ever', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('f'));
    b.failNext('study_sessions', { code: '503', status: 503, message: 'busy' }, 100, 'insert');
    for (let i = 0; i < 15; i++) { t += 10 * 60_000; await h.engine.flush(); }
    expect(h.engine.getStatus()).toMatchObject({ pending: 0, deadLettered: 1 });
  });
  it('refreshes an expired session once and carries on', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const h = harness({ refreshSession: refresh });
    await h.engine.hydrate();
    h.addFocus(focus('f'));
    b.failNext('study_sessions', { status: 401, message: 'JWT expired' }, 1, 'insert');
    await h.engine.flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(b.rows('study_sessions')).toHaveLength(1);
    expect(h.engine.getStatus().phase).toBe('idle');
  });
  it('pauses (instead of hammering the server) if the session cannot be renewed, keeping the change', async () => {
    const h = harness({ refreshSession: async () => false });
    await h.engine.hydrate();
    h.addFocus(focus('f'));
    b.failNext('study_sessions', { status: 401, message: 'JWT expired' }, 5, 'insert');
    await h.engine.flush();
    await h.engine.flush();
    expect(h.engine.getStatus()).toMatchObject({ phase: 'paused', pending: 1 });
    expect(b.calls.filter((c) => c.table === 'study_sessions' && c.op === 'insert').length).toBeLessThanOrEqual(2);
    h.engine.unpause();
    expect(h.engine.getStatus().phase).toBe('idle');
  });
  it('can put a set-aside change back in the queue', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('bad'));
    b.failNext('study_sessions', { code: '23514', message: 'x' }, 1, 'insert');
    await h.engine.flush();
    h.engine.retryDeadLetter(h.engine.getDeadLetters()[0].id);
    expect(h.engine.getStatus()).toMatchObject({ pending: 1, deadLettered: 0 });
    await h.engine.flush();
    expect(b.rows('study_sessions')).toHaveLength(1);
  });
});

describe('staying in step', () => {
  it('incremental pull brings in rows other devices wrote', async () => {
    const h = harness();
    await h.engine.hydrate();
    b.tables.study_sessions = [serverRow(1, { updated_at: '2026-11-09T00:00:00.000000Z' })];
    await h.engine.pullChanges();
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['f1']);
  });
  it('incremental pull never overwrites a row that has a pending local change', async () => {
    b.tables.study_sessions = [serverRow(1, { notes: 'orig' })];
    const h = harness();
    await h.engine.hydrate();
    h.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => ({ ...f, notes: 'mine' })) }));
    b.rows('study_sessions')[0].notes = 'theirs';
    b.rows('study_sessions')[0].updated_at = '2026-11-09T00:00:00.000000Z';
    await h.engine.pullChanges();
    expect(h.snap.focusLog[0].notes).toBe('mine');
    expect(h.engine.outbox.size).toBe(1);
  });
  it('ID reconciliation removes rows deleted elsewhere', async () => {
    b.tables.study_sessions = [serverRow(1), serverRow(2)];
    const h = harness();
    await h.engine.hydrate();
    b.tables.study_sessions = [b.tables.study_sessions[0]];
    await h.engine.reconcileIds();
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['f1']);
  });
  it('ID reconciliation keeps a row that is only missing because its creation is still pending', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('pending'));
    h.engine.capture();
    await h.engine.reconcileIds();
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['pending']);
  });
  it('ID reconciliation re-reads when the server has rows this device never heard of', async () => {
    const h = harness();
    await h.engine.hydrate();
    b.tables.study_sessions = [serverRow(1, { updated_at: '2020-01-01T00:00:00.000000Z' })]; // older than the cursor: an incremental pull would miss it
    await h.engine.reconcileIds();
    expect(h.snap.focusLog.map((f) => f.id)).toEqual(['f1']);
  });
});

describe('several tabs', () => {
  it('only one tab sends at a time, and nothing is written twice', async () => {
    const a = harness({ exclusive: createExclusive(localStorage, Date.now, 'tab-a') });
    const c = harness({ exclusive: createExclusive(localStorage, Date.now, 'tab-b') });
    await a.engine.hydrate();
    a.addFocus(focus('shared'));
    a.engine.capture();
    await c.engine.hydrate();
    await Promise.all([a.engine.flush(), c.engine.flush()]);
    await Promise.all([a.engine.flush(), c.engine.flush()]);
    expect(b.rows('study_sessions')).toHaveLength(1);
    expect(b.calls.filter((x) => x.table === 'study_sessions' && x.op === 'insert')).toHaveLength(1);
  });
  it('a tab that finds another one sending leaves its queue alone and picks up the result', async () => {
    const lease = createExclusive(localStorage, Date.now, 'tab-a');
    const h = harness({ exclusive: createExclusive(localStorage, Date.now, 'tab-b') });
    await h.engine.hydrate();
    h.addFocus(focus('x'));
    h.engine.capture();
    await lease.run('cma-sync:' + USER, async () => {
      await h.engine.flush();
      expect(b.rows('study_sessions')).toEqual([]);
      expect(h.engine.getStatus().pending).toBe(1);
    });
    await h.engine.flush();
    expect(b.rows('study_sessions')).toHaveLength(1);
  });
});

describe('only ever acts on the account that is on screen', () => {
  it('does nothing while the stores are not bound to this account: no capture, no push, no hydrate', async () => {
    let bound = true;
    const h = harness({ isBound: () => bound });
    await h.engine.hydrate();
    bound = false;
    h.addFocus(focus('local-data'));
    h.engine.capture();
    expect(h.engine.outbox.size).toBe(0);
    expect(await h.engine.hydrate()).toBe(false);
    await h.engine.flush();
    await h.engine.pullChanges();
    expect(b.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
  it('never applies server data to the store once unbound', async () => {
    b.tables.study_sessions = [serverRow(1)];
    let bound = true;
    const h = harness({ isBound: () => bound });
    bound = false;
    await h.engine.hydrate();
    expect(h.applied).toEqual([]);
  });
  it('refuses to queue the sample curriculum\'s ids even if everything else failed (defence in depth)', async () => {
    const demo: StudyDataSnapshot = { ...empty, chapters: empty.chapters.map((c, i) => ({ ...c, id: `p5-${i + 1}`, status: 'completed' as const })) };
    const h = harness({}, empty);
    await h.engine.hydrate();
    h.edit(() => demo);
    h.engine.capture();
    expect(h.engine.outbox.size).toBe(0);
  });
});

describe('isolation', () => {
  it('keeps each user\'s queue, log and known rows under their own keys', async () => {
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('mine'));
    h.engine.capture();
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('cma-sync'));
    expect(keys.every((k) => k.endsWith(`:${USER}`))).toBe(true);
    const other = harness({}, empty, U(101));
    expect(other.engine.outbox.size).toBe(0);
  });
  it('ignores sync metadata recorded for another enrolment', async () => {
    localStorage.setItem(accountKeys(USER).meta, JSON.stringify({ scope: { enrollmentId: U(999), csvId: CSV }, sync: { cursor: 'x', known: [['study_sessions:f1', 'v', 's']] } }));
    const h = harness();
    await h.engine.hydrate();
    h.addFocus(focus('f1'));
    h.engine.capture();
    expect(h.engine.outbox.all()[0].isNew).toBe(true);
  });
});

describe('profile, settings and the student\'s own dates', () => {
  const OFFICIAL = null;
  const seed = () => {
    seedBackend(b, { userId: USER });
    b.rows('student_enrollments').push({ id: ENROLLMENT.id, user_id: USER, csv_id: CSV, exam_attempt_id: U(901), status: 'active', exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: null, created_at: 'x', updated_at: 'x' });
  };
  const settingsOf = (h: ReturnType<typeof harness>) => h.snap.settings;
  const set = (h: ReturnType<typeof harness>, patch: Partial<StudyDataSnapshot['settings']>) => h.edit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const dev = (over: Partial<EngineDeps> = {}) => harness({ officialExamDate: () => OFFICIAL, ...over });
  const profileRow = () => b.rows('profiles')[0];
  const prefRow = () => b.rows('user_settings')[0];
  const enrolRow = () => b.rows('student_enrollments')[0];

  it('hydrating them is not a change: nothing is queued or sent', async () => {
    seed();
    const h = dev();
    await h.engine.hydrate();
    await h.engine.flush();
    expect(h.engine.outbox.size).toBe(0);
    expect(b.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('saves name, settings and both dates, and they persist to another device', async () => {
    seed();
    const one = dev();
    await one.engine.hydrate();
    set(one, { name: 'Priya Rao', dailyTargetHours: 6, weeklyTargetHours: 40, studyStartTime: '07:30', studyEndTime: '22:00', pomodoroFocusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 3, theme: 'light', examDate: '2027-06-10', finalRevisionDate: '2027-05-20' });
    await one.engine.flush();
    expect(profileRow().display_name).toBe('Priya Rao');
    expect(prefRow()).toMatchObject({ daily_target_hours: 6, weekly_target_hours: 40, study_start_time: '07:30:00', study_end_time: '22:00:00', pomodoro_focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, long_break_every: 3, theme: 'light' });
    expect(enrolRow()).toMatchObject({ exam_date_override: '2027-06-10', final_revision_date: '2027-05-20' });
    expect(one.engine.getStatus()).toMatchObject({ pending: 0, phase: 'idle' });

    const two = dev();
    await two.engine.hydrate();
    expect(settingsOf(two)).toMatchObject({ name: 'Priya Rao', dailyTargetHours: 6, studyStartTime: '07:30', theme: 'light', examDate: '2027-06-10', finalRevisionDate: '2027-05-20' });
  });

  it('only ever updates the columns the browser is allowed to change, and never the official date, status or identity', async () => {
    seed();
    const h = dev();
    await h.engine.hydrate();
    set(h, { name: 'Changed', theme: 'light', examDate: '2027-06-10' });
    await h.engine.flush();
    const writes = b.calls.filter((c) => c.op === 'update');
    expect(writes.map((c) => c.table).sort()).toEqual(['profiles', 'student_enrollments', 'user_settings']);
    expect(b.calls.filter((c) => c.op === 'insert' || c.op === 'delete' || c.op === 'upsert')).toEqual([]);
    expect(enrolRow()).toMatchObject({ status: 'active', csv_id: CSV, exam_attempt_id: U(901), user_id: USER });
    expect(b.rows('exam_attempts')[0].exam_start_date).toBeNull();
  });

  it('an unchanged official date is never written as an override', async () => {
    seed();
    b.rows('exam_attempts')[0].exam_start_date = '2027-06-01';
    const h = dev({ officialExamDate: () => '2027-06-01' });
    await h.engine.hydrate();
    set(h, { examDate: '2027-06-01', name: 'Only the name' });
    await h.engine.flush();
    expect(enrolRow().exam_date_override).toBeNull();
    expect(b.rows('exam_attempts')[0].exam_start_date).toBe('2027-06-01');
  });

  const conflictCase = (label: string, mine: Partial<StudyDataSnapshot['settings']>, theirs: () => void, table: string, check: (h: ReturnType<typeof harness>) => void) => {
    it(`${label}: the server wins, the losing change is logged, and the screen shows the server value`, async () => {
      seed();
      const h = dev();
      await h.engine.hydrate();
      set(h, mine);
      h.engine.capture();
      theirs();
      await h.engine.flush();
      check(h);
      const [c] = h.engine.getConflicts();
      expect(c).toMatchObject({ table, kind: 'changed-elsewhere' });
      expect(c.mine).not.toBeNull();
      expect(h.engine.getStatus()).toMatchObject({ pending: 0, conflicts: 1 });
      expect(h.engine.getDeadLetters()).toEqual([]);
      // and it is still there next session
      expect(dev().engine.getConflicts()).toHaveLength(1);
    });
  };
  conflictCase('a profile conflict', { name: 'Mine' }, () => { profileRow().display_name = 'Theirs'; profileRow().updated_at = b.tick(); }, 'profiles', (h) => { expect(profileRow().display_name).toBe('Theirs'); expect(settingsOf(h).name).toBe('Theirs'); });
  conflictCase('a user-settings conflict', { dailyTargetHours: 5, theme: 'light' }, () => { prefRow().daily_target_hours = 9; prefRow().updated_at = b.tick(); }, 'user_settings', (h) => { expect(prefRow().daily_target_hours).toBe(9); expect(settingsOf(h).dailyTargetHours).toBe(9); expect(prefRow().theme).toBe('dark'); });
  conflictCase('an exam-date override conflict', { examDate: '2027-06-10' }, () => { enrolRow().exam_date_override = '2027-07-01'; enrolRow().updated_at = b.tick(); }, 'student_enrollments', (h) => { expect(enrolRow().exam_date_override).toBe('2027-07-01'); expect(settingsOf(h).examDate).toBe('2027-07-01'); });
  conflictCase('a final-revision-date conflict', { finalRevisionDate: '2027-05-20' }, () => { enrolRow().final_revision_date = '2027-05-25'; enrolRow().updated_at = b.tick(); }, 'student_enrollments', (h) => { expect(enrolRow().final_revision_date).toBe('2027-05-25'); expect(settingsOf(h).finalRevisionDate).toBe('2027-05-25'); });

  it('a date the database refuses is set aside (recoverable), not retried, and other changes still go', async () => {
    seed();
    const h = dev();
    await h.engine.hydrate();
    set(h, { name: 'Still saved', examDate: '1999-01-01' });
    b.failNext('student_enrollments', { code: '23514', message: 'violates check constraint "student_enrollments_exam_date_override_bounds"' }, 1, 'update');
    await h.engine.flush();
    expect(profileRow().display_name).toBe('Still saved');
    expect(h.engine.getStatus()).toMatchObject({ pending: 0, deadLettered: 1, phase: 'attention' });
    const letter = h.engine.getDeadLetters()[0];
    expect(letter.op.table).toBe('student_enrollments');
    expect(letter.op.row?.exam_date_override).toBe('1999-01-01'); // kept, so the student can fix or retry it
    expect(h.engine.exportDiagnostics().setAside[0]).toMatchObject({ table: 'student_enrollments' });
  });

  it('a malformed date never reaches the queue', async () => {
    seed();
    const h = dev();
    await h.engine.hydrate();
    set(h, { examDate: '10/06/2027' });
    h.engine.capture();
    expect(h.engine.outbox.size).toBe(0);
    expect(h.engine.getStatus().deadLettered).toBe(1);
  });

  it('settings changed offline wait on disk and go when the connection returns', async () => {
    seed();
    const h = dev();
    await h.engine.hydrate();
    b.offline = true;
    set(h, { name: 'Offline edit' });
    await h.engine.flush();
    expect(h.engine.getStatus()).toMatchObject({ phase: 'offline', pending: 1 });
    b.offline = false;
    const reload = dev();
    await reload.engine.hydrate();
    expect(reload.snap.settings.name).toBe('Offline edit'); // pending change still shown on top of the server
    await reload.engine.flush();
    expect(profileRow().display_name).toBe('Offline edit');
  });

  it('switching users cannot expose another user\'s settings, name or dates', async () => {
    seed();
    const a = dev();
    await a.engine.hydrate();
    set(a, { name: 'Alice Private', dailyTargetHours: 3, examDate: '2027-06-10' });
    await a.engine.flush();
    const B = U(101);
    b.rows('profiles').push({ id: B, display_name: 'Bob', avatar_data_url: null, time_zone: 'Asia/Kolkata', onboarding_completed_at: null, created_at: 'x', updated_at: 'x' });
    b.rows('user_settings').push({ user_id: B, daily_target_hours: 8, weekly_target_hours: 50, study_start_time: '06:00:00', study_end_time: '23:00:00', pomodoro_focus_minutes: 50, short_break_minutes: 10, long_break_minutes: 20, long_break_every: 4, theme: 'dark', created_at: 'x', updated_at: 'x' });
    b.rows('student_enrollments').push({ id: U(850), user_id: B, csv_id: CSV, exam_attempt_id: U(901), status: 'active', exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: null, created_at: 'x', updated_at: 'x' });
    b.signInAs(B, 'bob@example.test');
    const bobSnap = buildAccountSnapshot({ profile: PROFILE(B, 'Bob'), settings: USER_SETTINGS, enrollment: { ...ENROLLMENT, id: U(850) }, curriculum: FIXTURE_TREE });
    const bob = harness({ scope: { userId: B, enrollmentId: U(850), csvId: CSV }, officialExamDate: () => null }, bobSnap, B);
    await bob.engine.hydrate();
    expect(bob.snap.settings).toMatchObject({ name: 'Bob', dailyTargetHours: 8, examDate: '' });
    expect(JSON.stringify(bob.snap)).not.toContain('Alice');
    set(bob, { name: 'Bob Two' });
    await bob.engine.flush();
    expect(b.rows('profiles').find((r) => r.id === USER)?.display_name).toBe('Alice Private');
    const keys = Object.keys(localStorage).filter((k) => k.endsWith(`:${B}`));
    expect(keys.every((k) => !(localStorage.getItem(k) ?? '').includes('Alice'))).toBe(true);
  });
});

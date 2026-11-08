/**
 * M7 + M8 against the LOCAL Supabase stack: real GoTrue, PostgREST and row level security, driven by the application's own repositories
 * and sync engine (SupabaseCurriculum, SupabaseEnrollments, SupabasePersonal, SyncEngine).
 *
 *     bash scripts/db/test-sync-integration.sh
 *
 * Opt-in. It refuses any non-local API or database host. It needs a published curriculum to enrol in, and the real one is (and must stay)
 * a draft, so it installs the clearly-FAKE test fixture, uses it, and removes it. It will not start unless every shared curriculum table is
 * empty (so it can never touch real data), and it checks they are empty again at the end. Throwaway users are @example.test.
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAccountSnapshot } from '@/lib/account/accountSnapshot';
import type { AccountSettings, Profile } from '@/features/auth/accountApi';
import { SupabaseCurriculum } from '@/lib/curriculum/supabaseCurriculum';
import type { CurriculumTree } from '@/lib/curriculum/types';
import { SupabaseEnrollments } from '@/lib/enrollment/supabaseEnrollments';
import type { Enrollment } from '@/lib/enrollment/types';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { SyncEngine } from '@/lib/sync/engine';
import { SupabasePersonal } from '@/lib/sync/supabasePersonal';
import type { FocusRecord, StudyDataSnapshot } from '@/types/study';
import { exportAccountData, serializeExport } from '@/lib/portability/accountExport';
import { deleteAccount, DELETE_PHRASE } from '@/lib/portability/deleteAccount';
import { buildImportPlan, fingerprint, NO_EXCLUSIONS } from '@/lib/portability/importPlan';
import { makeRepo, readRecordedRuns, recordRun, runImport } from '@/lib/portability/importRun';
import { localIds, localWithOwnData } from '@/test/localFixtures';

const URL = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
const ENABLED = process.env.SUPABASE_INTEGRATION === '1';
const RUN = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct horse battery';
const SHARED = ['courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts', 'course_attempt_availability', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources', 'source_references', 'curriculum_import_batches'];

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: process.env.PGPORT ?? '54322', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: 'postgres' },
    encoding: 'utf8',
  }).trim();
}
/** Runs SQL with triggers off (the local superuser only), for test setup and teardown that the app itself is forbidden to do. */
const psqlAdmin = (sql: string) => psql(`set session_replication_role = replica; ${sql}`);
function psqlFile(file: string) {
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: process.env.PGPORT ?? '54322', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: 'postgres' }, stdio: 'ignore' });
}
const sharedRowCount = () => Number(psql(`select ${SHARED.map((t) => `(select count(*) from public.${t})`).join(' + ')}`));
const storage = (): Storage => {
  const items = new Map<string, string>();
  return { get length() { return items.size; }, key: (i) => [...items.keys()][i] ?? null, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, String(v)), removeItem: (k) => void items.delete(k), clear: () => items.clear() };
};
const row = (sql: string) => psql(sql);
const timings: Record<string, number> = {};
const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try { return await work(); } finally { timings[label] = Math.round(performance.now() - t0); }
};

interface User { id: string; client: AppSupabaseClient; email: string }
async function newUser(who: string): Promise<User> {
  const client = createClient<Database>(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `m8-int-${RUN}-${who}@example.test`;
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { display_name: `M8 ${who}` } } });
  if (error || !data.user) throw new Error(`could not create the test user: ${error?.message}`);
  if (!data.session) {
    // the local stack requires a confirmed address; there is no mail server, so the throwaway address is confirmed directly
    psql(`update auth.users set email_confirmed_at = now() where id = '${data.user.id}'`);
    const r = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (r.error) throw new Error(`could not sign in the test user: ${r.error.message}`);
  }
  return { id: data.user.id, client: client as AppSupabaseClient, email };
}

/** One "device": its own storage and its own copy of the study data, driven by the real engine. */
function device(user: User, enrollment: Enrollment, loaded: Omit<CurriculumTree, 'identity'>) {
  const tree: CurriculumTree = { ...loaded, identity: { source: 'account', csvId: enrollment.csvId, courseName: enrollment.courseName, syllabusName: enrollment.syllabusName } };
  const profile: Profile = { id: user.id, displayName: 'M8', timeZone: 'Asia/Kolkata', onboardingCompletedAt: null };
  const settings: AccountSettings = { dailyTargetHours: 8, weeklyTargetHours: 50, studyStartTime: '06:00:00', studyEndTime: '23:00:00', pomodoroFocusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 4, theme: 'dark' };
  const empty = buildAccountSnapshot({ profile, settings, enrollment, curriculum: tree });
  let snap: StudyDataSnapshot = empty;
  const store = storage();
  let now = Date.now();
  const engine = new SyncEngine({
    officialExamDate: () => enrollment.attemptStartDate, scope: { userId: user.id, enrollmentId: enrollment.id, csvId: enrollment.csvId }, repo: new SupabasePersonal(user.client), storage: store,
    read: () => snap, base: () => ({ settings: empty.settings, chapters: empty.chapters }), apply: (s) => { snap = s; },
    now: () => new Date(now).toISOString(), setTimer: () => 0, clearTimer: () => undefined,
  });
  return {
    engine, store, get snap() { return snap; }, chapter: empty.chapters[0], advance: (ms: number) => { now += ms; },
    edit: (fn: (s: StudyDataSnapshot) => StudyDataSnapshot) => { snap = fn(snap); engine.capture(); },
  };
}
const focusRec = (id: string, chapter: { id: string; subjectId: string }, minutes = 30, date = '2026-11-08', over: Partial<FocusRecord> = {}): FocusRecord => ({ id, date, subjectId: chapter.subjectId, chapterId: chapter.id, minutes, mode: 'pomodoro', notes: '', sessionId: null, ...over });

describe.skipIf(!ENABLED)('M7 enrolment and M8 sync against the real local stack', () => {
  let a: User; let b: User;
  let csvId = ''; let attemptId = ''; let attempt2Id = ''; let g1 = ''; let g2 = '';
  let tree: Omit<CurriculumTree, 'identity'>; let enr: Enrollment;
  const curriculum = () => new SupabaseCurriculum(a.client);

  beforeAll(async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) throw new Error(`REFUSED: this test only runs against a local stack (SUPABASE_URL=${URL})`);
    if (sharedRowCount() !== 0) throw new Error('REFUSED: the shared curriculum tables are not empty, so this is not a clean local database. Nothing was changed.');
    psqlFile('supabase/tests/database/000_helpers.test.sql');
    psql('select tests.build_fake_fixture()');
    // a second published attempt for the same syllabus, so changing the attempt can be tested
    csvId = psql(`select id from public.course_syllabus_versions where stable_key = 'fake-csv-1'`);
    attemptId = psql(`select id from public.exam_attempts where stable_key = 'fake-attempt-a'`);
    attempt2Id = psql(`select id from public.exam_attempts where stable_key = 'fake-attempt-b'`);
    g1 = psql(`select id from public.subject_groups where stable_key = 'fake-group-1'`);
    g2 = psql(`select id from public.subject_groups where stable_key = 'fake-group-2'`);
    a = await newUser('a');
    b = await newUser('b');
  }, 60_000);

  afterAll(() => {
    // users first (their enrolments and every personal row go with them), then the fake curriculum
    try { psql(`delete from auth.users where email like 'm8-int-${RUN}-%@example.test'`); } catch { /* reported below */ }
    psqlAdmin(`delete from public.course_attempt_availability; delete from public.exam_attempts; delete from public.official_weightages; delete from public.chapters; delete from public.syllabus_sections; delete from public.subjects; delete from public.subject_groups; delete from public.course_syllabus_versions; delete from public.syllabus_versions; delete from public.courses; delete from public.study_resources; delete from public.source_references; delete from public.curriculum_import_batches;`);
    expect(sharedRowCount()).toBe(0);
    expect(psql(`select count(*) from auth.users where email like 'm8-int-${RUN}-%'`)).toBe('0');
    process.stdout.write(`\nM8 TIMINGS (ms): ${JSON.stringify(timings)}\n`);
  });

  // ---- M7 -----------------------------------------------------------------------------------------------------------------------
  describe('curriculum and enrolment (M7)', () => {
    it('1. offers the published combination from the view, with both groups', async () => {
      const { options } = await curriculum().listEnrollmentOptions();
      const o = options.find((x) => x.csvId === csvId && x.attemptId === attemptId);
      expect(o?.groups.map((g) => g.name)).toEqual(['FAKE Group 1', 'FAKE Group 2']);
      expect(o?.dateStatus).toBe('unannounced');
      expect(o?.examStartDate).toBeNull();
    });

    it('2. offers only Group 1 when Group 2 is not published, and Group 2 later without changing any id', async () => {
      const before = (await curriculum().loadCurriculum(csvId)).tree;
      psqlAdmin(`update public.subject_groups set status = 'draft' where id = '${g2}'; update public.subjects set status = 'draft' where subject_group_id = '${g2}'; update public.chapters set status = 'draft' where subject_id in (select id from public.subjects where subject_group_id = '${g2}');`);
      const only1 = (await curriculum().loadCurriculum(csvId)).tree;
      expect(only1.groups.map((g) => g.name)).toEqual(['FAKE Group 1']);
      expect(only1.chapters.length).toBeLessThan(before.chapters.length);
      expect((await curriculum().listEnrollmentOptions()).options[0]?.groups.map((g) => g.name)).toEqual(['FAKE Group 1']);
      psqlAdmin(`update public.subject_groups set status = 'published' where id = '${g2}'; update public.subjects set status = 'published' where subject_group_id = '${g2}'; update public.chapters set status = 'published' where subject_id in (select id from public.subjects where subject_group_id = '${g2}');`);
      const after = (await curriculum().loadCurriculum(csvId)).tree;
      for (const c of only1.chapters) expect(after.chapters.find((x) => x.id === c.id)).toEqual(c);
      expect(after.chapters.map((c) => c.id).sort()).toEqual(before.chapters.map((c) => c.id).sort());
    });

    it('3. never returns a draft chapter, even one that exists in the table', async () => {
      psqlAdmin(`insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no, status) select csv_id, id, 'fake-draft-ch', 'FAKE draft chapter must not appear', 99, 'draft' from public.subjects where stable_key = 'fake-subject-1';`);
      const { tree: t } = await curriculum().loadCurriculum(csvId);
      expect(JSON.stringify(t)).not.toContain('must not appear');
      psqlAdmin(`delete from public.chapters where stable_key = 'fake-draft-ch'`);
    });

    it('4. enrols through the database function; the database refuses an unavailable group, a second active enrolment, and a direct insert', async () => {
      const repo = new SupabaseEnrollments(a.client);
      await expect(repo.create({ csvId, attemptId, groupIds: [] })).rejects.toMatchObject({ kind: 'invalid' });
      await expect(repo.create({ csvId, attemptId, groupIds: ['00000000-0000-4000-8000-0000000000ff'] })).rejects.toMatchObject({ kind: 'not-available' });
      enr = await repo.create({ csvId, attemptId, groupIds: [g1] });
      expect(enr).toMatchObject({ status: 'active', courseName: 'FAKE Course A', attemptLabel: 'FAKE attempt A' });
      expect(enr.groups.map((g) => g.name)).toEqual(['FAKE Group 1']);
      await expect(repo.create({ csvId, attemptId: attempt2Id, groupIds: [g1] })).rejects.toMatchObject({ kind: 'already-active' });
      const direct = await a.client.from('student_enrollments' as never).insert({ user_id: a.id, csv_id: csvId, exam_attempt_id: attemptId } as never);
      expect(direct.error).toBeTruthy();
      tree = (await curriculum().loadCurriculum(csvId)).tree;
    });

    it('5. changes attempt and groups, archives and re-activates, keeping one active enrolment', async () => {
      const repo = new SupabaseEnrollments(a.client);
      expect((await repo.changeAttempt(enr.id, attempt2Id)).attemptLabel).toBe('FAKE attempt B');
      expect((await repo.setGroups(enr.id, [g1, g2])).groups).toHaveLength(2);
      expect((await repo.archive(enr.id)).status).toBe('archived');
      expect(await repo.getActive()).toBeNull();
      expect((await repo.activate(enr.id)).status).toBe('active');
      enr = (await repo.getActive())!;
      expect(psql(`select count(*) from public.student_enrollments where user_id = '${a.id}' and status = 'active'`)).toBe('1');
    });
  });

  // ---- M8 -----------------------------------------------------------------------------------------------------------------------
  describe('personal data and sync (M8)', () => {
    it('6. a new device hydrates empty, sends a focus record once, and the database derives the same totals', async () => {
      const d = device(a, enr, tree);
      expect(await d.engine.hydrate()).toBe(true);
      d.edit((s) => ({ ...s, focusLog: [focusRec('focus-int-1', d.chapter, 30)] }));
      expect(await d.engine.flush()).toBe(true);
      expect(psql(`select count(*), sum(minutes) from public.study_sessions where user_id = '${a.id}' and client_id = 'focus-int-1'`)).toBe('1|30');
      expect(psql(`select actual_minutes from public.chapter_stats where enrollment_id = '${enr.id}' and chapter_id = '${d.chapter.id}'`)).toBe('30');
      expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    });

    it('7. a retry that repeats a write creates no duplicate (idempotent client ids)', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      const op = { id: 'study_sessions:focus-int-1', kind: 'upsert' as const, table: 'study_sessions' as const, key: 'focus-int-1', row: { client_id: 'focus-int-1', chapter_id: d.chapter.id, local_date: '2026-11-08', minutes: 30, mode: 'pomodoro', notes: '', planner_client_id: null }, isNew: true, baseVersion: null, serverId: null, queuedAt: '', attempts: 0, notBefore: null, lastError: null };
      const repo = new SupabasePersonal(a.client);
      const scope = { userId: a.id, enrollmentId: enr.id, csvId };
      expect((await repo.push(scope, [op, op]))[1].status).toBe('applied');
      expect(psql(`select count(*) from public.study_sessions where user_id = '${a.id}' and client_id = 'focus-int-1'`)).toBe('1');
    });

    it('8. a planned session and the focus record that credits it are linked on the server', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      d.edit((s) => ({ ...s, sessions: [{ id: 's-int-1', date: '2026-11-09', subjectId: d.chapter.subjectId, chapterId: d.chapter.id, startTime: '09:30', durationMinutes: 60, status: 'completed', priority: 'high', notes: 'plan' }], focusLog: [...s.focusLog, focusRec('plan-s-int-1', d.chapter, 60, '2026-11-09', { mode: 'planner', sessionId: 's-int-1' })] }));
      await d.engine.flush();
      expect(psql(`select count(*) from public.study_sessions ss join public.planner_sessions ps on ps.id = ss.planner_session_id where ss.client_id = 'plan-s-int-1' and ps.client_id = 's-int-1' and ps.user_id = '${a.id}'`)).toBe('1');
      // and a brand-new device sees both, relinked
      const fresh = device(a, enr, tree);
      await fresh.engine.hydrate();
      expect(fresh.snap.focusLog.find((f) => f.id === 'plan-s-int-1')?.sessionId).toBe('s-int-1');
    });

    it('9. a midnight-split block is two records on two days, summed per day by the database', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      d.edit((s) => ({ ...s, focusLog: [...s.focusLog, focusRec('plan-s-mid', d.chapter, 20, '2026-11-10', { mode: 'planner' }), focusRec('plan-s-mid@2026-11-11', d.chapter, 40, '2026-11-11', { mode: 'planner' })] }));
      await d.engine.flush();
      expect(psql(`select minutes from public.daily_study_minutes where enrollment_id = '${enr.id}' and local_date = '2026-11-10'`)).toBe('20');
      expect(psql(`select minutes from public.daily_study_minutes where enrollment_id = '${enr.id}' and local_date = '2026-11-11'`)).toBe('40');
    });

    it('10. two devices editing the same record: the server wins, nothing is silently lost, the loser sees a log entry', async () => {
      const one = device(a, enr, tree);
      const two = device(a, enr, tree);
      await one.engine.hydrate();
      await two.engine.hydrate();
      one.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => (f.id === 'focus-int-1' ? { ...f, notes: 'from device one' } : f)) }));
      two.edit((s) => ({ ...s, focusLog: s.focusLog.map((f) => (f.id === 'focus-int-1' ? { ...f, notes: 'from device two' } : f)) }));
      await one.engine.flush();
      await two.engine.flush();
      expect(psql(`select notes from public.study_sessions where user_id = '${a.id}' and client_id = 'focus-int-1'`)).toBe('from device one');
      expect(two.snap.focusLog.find((f) => f.id === 'focus-int-1')?.notes).toBe('from device one');
      expect(two.engine.getConflicts()).toHaveLength(1);
      expect(two.engine.getConflicts()[0].mine?.notes).toBe('from device two');
      expect(two.engine.getStatus().pending).toBe(0);
    });

    it('11. an incremental pull brings in another device\'s record; reconciliation notices another device\'s deletion', async () => {
      const one = device(a, enr, tree);
      const two = device(a, enr, tree);
      await one.engine.hydrate();
      await two.engine.hydrate();
      one.edit((s) => ({ ...s, focusLog: [...s.focusLog, focusRec('focus-int-share', one.chapter, 15, '2026-11-12')] }));
      await one.engine.flush();
      await two.engine.pullChanges();
      expect(two.snap.focusLog.map((f) => f.id)).toContain('focus-int-share');
      one.edit((s) => ({ ...s, focusLog: s.focusLog.filter((f) => f.id !== 'focus-int-share') }));
      await one.engine.flush();
      await two.engine.reconcileIds();
      expect(two.snap.focusLog.map((f) => f.id)).not.toContain('focus-int-share');
    });

    it('12. the database refuses rows that break its rules; they are set aside, the rest still go', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      const scope = { userId: a.id, enrollmentId: enr.id, csvId };
      const repo = new SupabasePersonal(a.client);
      const bad = { id: 'practice_records:bad', kind: 'upsert' as const, table: 'practice_records' as const, key: 'bad', row: { client_id: 'bad', chapter_id: d.chapter.id, local_date: '2026-11-08', questions: 5, correct: 9 }, isNew: true, baseVersion: null, serverId: null, queuedAt: '', attempts: 0, notBefore: null, lastError: null };
      expect((await repo.push(scope, [bad]))[0]).toMatchObject({ status: 'rejected' });
      d.edit((s) => ({ ...s, practiceLog: [{ id: 'pr-int-1', date: '2026-11-08', chapterId: d.chapter.id, subjectId: d.chapter.subjectId, questions: 10, correct: 7 }] }));
      await d.engine.flush();
      expect(psql(`select questions, correct from public.practice_records where user_id = '${a.id}' and client_id = 'pr-int-1'`)).toBe('10|7');
    });

    it('13. a revision can be completed and cancelled but never deleted', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      d.edit((s) => ({ ...s, revisions: [{ id: 'rev-int-1', chapterId: d.chapter.id, revisionNumber: 1, dueDate: '2026-11-20', completedOn: null, priority: 'medium' }] }));
      await d.engine.flush();
      d.edit((s) => ({ ...s, revisions: s.revisions.map((r) => ({ ...r, completedOn: '2026-11-20' })) }));
      await d.engine.flush();
      expect(psql(`select completed_on from public.revisions where user_id = '${a.id}' and client_id = 'rev-int-1'`)).toBe('2026-11-20');
      d.edit((s) => ({ ...s, revisions: [] }));
      await d.engine.flush();
      expect(psql(`select count(*) from public.revisions where user_id = '${a.id}' and client_id = 'rev-int-1'`)).toBe('1');
      expect(d.engine.getStatus().deadLettered).toBe(1);
    });

    it('14. another user can neither read nor write this user\'s rows (row level security)', async () => {
      const repoB = new SupabasePersonal(b.client);
      const scopeA = { userId: a.id, enrollmentId: enr.id, csvId };
      expect((await repoB.pullAll(scopeA)).rows).toEqual([]);
      const foreign = { id: 'study_sessions:evil', kind: 'upsert' as const, table: 'study_sessions' as const, key: 'evil', row: { client_id: 'evil', chapter_id: tree.chapters[0].id, local_date: '2026-11-08', minutes: 10, mode: 'pomodoro', notes: '', planner_client_id: null }, isNew: true, baseVersion: null, serverId: null, queuedAt: '', attempts: 0, notBefore: null, lastError: null };
      expect((await repoB.push({ userId: b.id, enrollmentId: enr.id, csvId }, [foreign]))[0].status).toBe('rejected');
      expect(psql(`select count(*) from public.study_sessions where client_id = 'evil'`)).toBe('0');
    });

    it('15. a different enrolment sees none of another enrolment\'s records', async () => {
      const repo = new SupabaseEnrollments(a.client);
      await repo.archive(enr.id);
      const second = await repo.create({ csvId, attemptId: attempt2Id, groupIds: [g1] });
      const d = device(a, second, tree);
      await d.engine.hydrate();
      expect(d.snap.focusLog).toEqual([]);
      expect(d.snap.chapters.every((c) => c.actualHours === 0)).toBe(true);
      await repo.archive(second.id);
      await repo.activate(enr.id); // the first enrolment's records are still there
      const back = device(a, enr, tree);
      await back.engine.hydrate();
      expect(back.snap.focusLog.length).toBeGreaterThan(0);
    });

    it('16. reads past the API row cap by explicit paging, and measures it', async () => {
      psql(`insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
            select 'bulk-' || g, '${a.id}', '${enr.id}', '${csvId}', '${tree.chapters[0].id}', date '2026-01-01' + (g % 200), 5, 'stopwatch' from generate_series(1, 2500) g`);
      const d = device(a, enr, tree);
      await timed('hydrate_2500_rows', () => d.engine.hydrate());
      expect(d.snap.focusLog.filter((f) => f.id.startsWith('bulk-'))).toHaveLength(2500);
      await timed('incremental_pull_no_change', () => d.engine.pullChanges());
      await timed('id_reconciliation_2500', () => d.engine.reconcileIds());
    }, 60_000);

    it('17. sends a large backlog in batches of at most 200 and measures it', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      d.edit((s) => ({ ...s, focusLog: [...s.focusLog, ...Array.from({ length: 450 }, (_, i) => focusRec(`backlog-${i}`, d.chapter, 5, '2026-02-01'))] }));
      expect(d.engine.getStatus().pending).toBe(450);
      await timed('push_450_ops', () => d.engine.flush());
      expect(psql(`select count(*) from public.study_sessions where user_id = '${a.id}' and client_id like 'backlog-%'`)).toBe('450');
      expect(d.engine.getStatus()).toMatchObject({ pending: 0, phase: 'idle' });
    }, 60_000);

    it('18. the account\'s quota is enforced by the database and reported as a plain refusal', async () => {
      psqlAdmin(`update public.quota_limits set max_rows = coalesce((select used from public.user_quota_usage where user_id = '${a.id}' and resource = 'mock_tests'), 0) + 1 where resource = 'mock_tests'`);
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      const mock = (id: string) => ({ id, date: '2026-11-05', subjectId: d.chapter.subjectId, name: `FAKE ${id}`, score: 50, maxScore: 100 });
      d.edit((s) => ({ ...s, mockExams: [mock('m-int-1'), mock('m-int-2')] }));
      await d.engine.flush();
      expect(Number(psql(`select count(*) from public.mock_tests where user_id = '${a.id}'`))).toBe(1);
      expect(d.engine.getDeadLetters()[0].reason).toMatch(/limit/);
      psqlAdmin(`update public.quota_limits set max_rows = 1000 where resource = 'mock_tests'`);
    });
  });

  // ---- M8: name, settings and the student's own dates --------------------------------------------------------------------------
  describe('name, settings and the student\'s own dates (M8)', () => {
    type Settings = StudyDataSnapshot['settings'];
    const setS = (d: ReturnType<typeof device>, patch: Partial<Settings>) => d.edit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

    it('19. saves name, every setting and both dates, and another device sees them', async () => {
      const one = device(a, enr, tree);
      await one.engine.hydrate();
      setS(one, { name: 'Priya Rao', dailyTargetHours: 6, weeklyTargetHours: 40, studyStartTime: '07:30', studyEndTime: '22:00', pomodoroFocusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 3, theme: 'light', examDate: '2027-06-10', finalRevisionDate: '2027-05-20' });
      await one.engine.flush();
      expect(row(`select display_name from public.profiles where id = '${a.id}'`)).toBe('Priya Rao');
      expect(row(`select daily_target_hours, weekly_target_hours, study_start_time, study_end_time, pomodoro_focus_minutes, short_break_minutes, long_break_minutes, long_break_every, theme from public.user_settings where user_id = '${a.id}'`)).toBe('6.0|40.0|07:30:00|22:00:00|25|5|15|3|light');
      expect(row(`select exam_date_override, final_revision_date from public.student_enrollments where id = '${enr.id}'`)).toBe('2027-06-10|2027-05-20');
      const two = device(a, enr, tree);
      await two.engine.hydrate();
      expect(two.snap.settings).toMatchObject({ name: 'Priya Rao', dailyTargetHours: 6, studyStartTime: '07:30', theme: 'light', examDate: '2027-06-10', finalRevisionDate: '2027-05-20' });
      expect(one.engine.getStatus()).toMatchObject({ pending: 0, phase: 'idle' });
    });

    it('20. editing nothing sends nothing, and the official date and identity columns are never touched', async () => {
      const before = row(`select status, csv_id, exam_attempt_id, user_id, started_at from public.student_enrollments where id = '${enr.id}'`);
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      await d.engine.flush();
      expect(d.engine.outbox.size).toBe(0);
      setS(d, { theme: 'system' });
      await d.engine.flush();
      expect(row(`select status, csv_id, exam_attempt_id, user_id, started_at from public.student_enrollments where id = '${enr.id}'`)).toBe(before);
      expect(row(`select count(*) from public.exam_attempts where exam_start_date is not null`)).toBe('0');
    });

    const clash = async (label: string, mine: Partial<Settings>, theirsSql: string, table: string, check: (d: ReturnType<typeof device>) => void) => {
      const one = device(a, enr, tree);
      const two = device(a, enr, tree);
      await one.engine.hydrate();
      await two.engine.hydrate();
      setS(one, mine);
      row(theirsSql); // another device got there first
      await one.engine.flush();
      check(one);
      const c = one.engine.getConflicts().find((x) => x.table === table);
      expect(c, label).toMatchObject({ kind: 'changed-elsewhere' });
      expect(c?.mine).not.toBeNull();
      expect(one.engine.getStatus().pending).toBe(0);
    };

    it('21. profile, settings, exam-date and final-revision conflicts: the server wins and each loss is logged', async () => {
      await clash('profile', { name: 'Mine' }, `update public.profiles set display_name = 'Theirs' where id = '${a.id}'`, 'profiles', (d) => expect(d.snap.settings.name).toBe('Theirs'));
      await clash('settings', { dailyTargetHours: 3 }, `update public.user_settings set daily_target_hours = 11 where user_id = '${a.id}'`, 'user_settings', (d) => expect(d.snap.settings.dailyTargetHours).toBe(11));
      await clash('exam date', { examDate: '2027-08-01' }, `update public.student_enrollments set exam_date_override = '2027-09-09' where id = '${enr.id}'`, 'student_enrollments', (d) => expect(d.snap.settings.examDate).toBe('2027-09-09'));
      expect(row(`select exam_date_override from public.student_enrollments where id = '${enr.id}'`)).toBe('2027-09-09');
      await clash('final revision', { finalRevisionDate: '2027-08-15' }, `update public.student_enrollments set final_revision_date = '2027-08-20' where id = '${enr.id}'`, 'student_enrollments', (d) => expect(d.snap.settings.finalRevisionDate).toBe('2027-08-20'));
    });

    it('22. the existing database constraints reject bad dates; the change is set aside, recoverable, and the rest still goes', async () => {
      const d = device(a, enr, tree);
      await d.engine.hydrate();
      setS(d, { name: 'Saved Anyway', examDate: '1999-01-01' });
      await d.engine.flush();
      expect(row(`select display_name from public.profiles where id = '${a.id}'`)).toBe('Saved Anyway');
      expect(row(`select exam_date_override from public.student_enrollments where id = '${enr.id}'`)).not.toBe('1999-01-01');
      expect(d.engine.getDeadLetters()).toHaveLength(1);
      expect(d.engine.getDeadLetters()[0].op.row?.exam_date_override).toBe('1999-01-01');
      expect(d.engine.getStatus().phase).toBe('attention');

      const e = device(a, enr, tree);
      await e.engine.hydrate();
      setS(e, { examDate: '2101-01-01' });
      await e.engine.flush();
      expect(e.engine.getDeadLetters()).toHaveLength(1);

      const f = device(a, enr, tree);
      await f.engine.hydrate();
      setS(f, { examDate: '2027-06-10', finalRevisionDate: '2027-06-20' }); // final revision after the exam
      await f.engine.flush();
      expect(f.engine.getDeadLetters()).toHaveLength(1);
      expect(row(`select final_revision_date from public.student_enrollments where id = '${enr.id}'`)).not.toBe('2027-06-20');
    });

    it('23. another user cannot read or change this user\'s name, settings or dates, or any identity column of an enrolment', async () => {
      const mine = row(`select display_name from public.profiles where id = '${a.id}'`);
      const p = await b.client.from('profiles').update({ display_name: 'Hijacked' }).eq('id', a.id).select();
      expect(p.data ?? []).toEqual([]);
      const u = await b.client.from('user_settings').update({ theme: 'light' }).eq('user_id', a.id).select();
      expect(u.data ?? []).toEqual([]);
      const en = await b.client.from('student_enrollments').update({ exam_date_override: '2027-01-01' }).eq('id', enr.id).select();
      expect(en.data ?? []).toEqual([]);
      const status = await a.client.from('student_enrollments').update({ status: 'archived' } as never).eq('id', enr.id).select();
      expect(status.error).toBeTruthy(); // not a column the browser may change
      const owner = await a.client.from('student_enrollments').update({ user_id: b.id } as never).eq('id', enr.id).select();
      expect(owner.error).toBeTruthy();
      expect(row(`select display_name from public.profiles where id = '${a.id}'`)).toBe(mine);
      expect(row(`select status from public.student_enrollments where id = '${enr.id}'`)).toBe('active');
      // and B's own engine never sees A's values
      const bEnr = await new SupabaseEnrollments(b.client).create({ csvId, attemptId, groupIds: [g1] });
      const bd = device(b, bEnr, tree);
      await bd.engine.hydrate();
      expect(bd.snap.settings.name).not.toBe(mine);
      expect(JSON.stringify(bd.snap.settings)).not.toContain('Theirs');
    });
  });

  // ---- M9: import, export and deletion --------------------------------------------------------------------------------------------
  describe('data portability and account management (M9)', () => {
    const local = localWithOwnData();
    const ids = localIds(local);
    const scopeOf = (u: User, e: Enrollment) => ({ userId: u.id, enrollmentId: e.id, csvId: e.csvId });
    const mappingFor = () => ({ chapters: { [ids.c1]: tree.chapters[2].id, [ids.c2]: tree.chapters[3].id }, subjects: { [ids.subjectId]: tree.subjects[0].id } });
    const planFor = async (u: User, e: Enrollment) => buildImportPlan({ local, destination: { subjects: tree.subjects, chapters: tree.chapters }, mapping: mappingFor(), excluded: NO_EXCLUSIONS, existing: (await makeRepo(u.client).pullAll(scopeOf(u, e))).rows });
    const own = (u: User, t: string) => Number(psql(`select count(*) from public.${t} where user_id = '${u.id}' and client_id like '%own-%'`));

    it('24. imports the student\'s own records once, idempotently, and records the import', async () => {
      const plan = await planFor(a, enr);
      expect(plan.canImport).toBe(true);
      const first = await runImport({ plan, scope: scopeOf(a, enr), repo: makeRepo(a.client) });
      expect(first.state).toBe('complete');
      expect(own(a, 'study_sessions')).toBe(3);
      expect(own(a, 'practice_records')).toBe(1);
      expect(own(a, 'revisions')).toBe(1);
      expect(own(a, 'mock_tests')).toBe(1);
      expect(own(a, 'planner_sessions')).toBe(1);
      expect(psql(`select count(*) from public.study_sessions ss join public.planner_sessions ps on ps.id = ss.planner_session_id where ss.client_id = 'plan-s-own-1' and ps.client_id = 's-own-1'`)).toBe('1');
      expect(psql(`select count(*) from public.chapter_progress where user_id = '${a.id}' and chapter_id in ('${tree.chapters[2].id}', '${tree.chapters[3].id}') and notes in ('my notes', '')`)).toBe('2');
      // running the very same writes again (a retry whose answers were lost) adds nothing
      const again = await runImport({ plan: buildImportPlan({ local, destination: { subjects: tree.subjects, chapters: tree.chapters }, mapping: mappingFor(), excluded: NO_EXCLUSIONS, existing: [] }), scope: scopeOf(a, enr), repo: makeRepo(a.client) });
      expect(again.state).toBe('complete');
      expect(own(a, 'study_sessions')).toBe(3);
      expect(own(a, 'mock_tests')).toBe(1);
      // the next plan sees everything as already there
      expect((await planFor(a, enr)).ready).toEqual([]);
      // the record of the import is unique per approved selection, enforced by the database
      const print = await fingerprint(plan.payload);
      expect(await recordRun(a.client, scopeOf(a, enr), print, { study_sessions: 3 })).toBe('recorded');
      expect(await recordRun(a.client, scopeOf(a, enr), print, { study_sessions: 3 })).toBe('already-recorded');
      expect((await readRecordedRuns(a.client, a.id)).map((r) => r.sha256)).toEqual([print]);
      expect(row(`select count(*) from public.local_import_runs where user_id = '${a.id}'`)).toBe('1');
    });

    it('25. never overwrites an account record that differs, and one refused record does not stop the others', async () => {
      row(`update public.study_sessions set minutes = 77 where user_id = '${a.id}' and client_id = 'focus-own-1'`);
      const forced = buildImportPlan({ local, destination: { subjects: tree.subjects, chapters: tree.chapters }, mapping: mappingFor(), excluded: NO_EXCLUSIONS, existing: [] });
      forced.ready.push({ table: 'practice_records', key: 'bad-own-1', row: { client_id: 'bad-own-1', chapter_id: tree.chapters[0].id, local_date: '2026-11-08', questions: 5, correct: 9 } });
      forced.ready.push({ table: 'study_sessions', key: 'extra-own-1', row: { client_id: 'extra-own-1', chapter_id: tree.chapters[0].id, local_date: '2026-11-08', minutes: 11, mode: 'pomodoro', notes: '', planner_client_id: null } });
      const result = await runImport({ plan: forced, scope: scopeOf(a, enr), repo: makeRepo(a.client) });
      expect(result.state).toBe('partial');
      expect(result.outcomes.study_sessions.keptAccountVersion).toBe(1);
      expect(result.failures.map((f) => f.key)).toEqual(['bad-own-1']);
      expect(row(`select minutes from public.study_sessions where user_id = '${a.id}' and client_id = 'focus-own-1'`)).toBe('77');
      expect(row(`select count(*) from public.study_sessions where user_id = '${a.id}' and client_id = 'extra-own-1'`)).toBe('1');
    });

    it('25b. a record that clashes with a different existing record (same revision number for the chapter) is refused, never reported as kept', async () => {
      const clash = buildImportPlan({ local, destination: { subjects: tree.subjects, chapters: tree.chapters }, mapping: mappingFor(), excluded: NO_EXCLUSIONS, existing: [] });
      clash.ready = [{ table: 'revisions', key: 'rev-clash-own-1', row: { client_id: 'rev-clash-own-1', chapter_id: tree.chapters[0].id, revision_number: 1, due_date: '2026-11-21', completed_on: null, cancelled_on: null, priority: 'low' } }];
      const result = await runImport({ plan: clash, scope: scopeOf(a, enr), repo: makeRepo(a.client) });
      expect(result.state).toBe('partial');
      expect(result.outcomes.revisions).toMatchObject({ imported: 0, keptAccountVersion: 0, failed: 1 });
      expect(result.failures[0].detail).toMatch(/clashes/);
      expect(row(`select count(*) from public.revisions where user_id = '${a.id}' and client_id = 'rev-clash-own-1'`)).toBe('0');
    });

    it('26. another user cannot import into this user\'s enrolment (row level security)', async () => {
      const plan = await planFor(a, enr);
      const forced = buildImportPlan({ local, destination: { subjects: tree.subjects, chapters: tree.chapters }, mapping: mappingFor(), excluded: NO_EXCLUSIONS, existing: [] });
      void plan;
      const before = Number(psql(`select count(*) from public.study_sessions`));
      const result = await runImport({ plan: forced, scope: { userId: b.id, enrollmentId: enr.id, csvId: enr.csvId }, repo: makeRepo(b.client) });
      expect(result.state).not.toBe('complete');
      expect(result.outcomes.study_sessions.imported).toBe(0);
      expect(Number(psql(`select count(*) from public.study_sessions`))).toBe(before);
      expect(row(`select count(*) from public.study_sessions where user_id = '${b.id}' and client_id like '%own-%'`)).toBe('0');
    });

    it('27. exports exactly this user\'s data, completely (past the API row cap), without anyone else\'s or any credential', async () => {
      const doc = await exportAccountData(a.client, a.id);
      const n = (t: string) => Number(psql(`select count(*) from public.${t} where user_id = '${a.id}'`));
      expect(doc.counts.study_sessions).toBe(n('study_sessions'));
      expect(doc.counts.study_sessions).toBeGreaterThan(2500); // scenario 16's bulk rows: more than one API page
      for (const t of ['chapter_progress', 'planner_sessions', 'revisions', 'practice_records', 'mock_tests'] as const) expect(doc.counts[t]).toBe(n(t));
      expect(doc.enrollments.length).toBe(n('student_enrollments'));
      expect(doc.enrollments.map((e) => e.status).sort()).toContain('active');
      expect(doc.profile?.display_name).toBe(row(`select display_name from public.profiles where id = '${a.id}'`));
      expect(doc.import_history).toHaveLength(1);
      const text = serializeExport(doc);
      expect(text).not.toContain(b.id);
      expect(text).not.toMatch(new RegExp(['access_token', 'refresh_token', ['service', 'role'].join('_'), 'password'].join('|'), 'i'));
      expect(new Set(doc.data.study_sessions.map((r) => r.id)).size).toBe(doc.data.study_sessions.length);
      expect(doc.references.chapters.length).toBeGreaterThan(0);
      // the other user's export is theirs alone
      const theirs = await exportAccountData(b.client, b.id);
      expect(JSON.stringify(theirs)).not.toContain(a.id);
    }, 60_000);

    it('28. deletes an account only with the right password and a fresh sign-in; the curriculum stays; failed attempts delete nothing', async () => {
      const c = await newUser('c');
      const cEnr = await new SupabaseEnrollments(c.client).create({ csvId, attemptId, groupIds: [g1] });
      const d = device(c, cEnr, tree);
      await d.engine.hydrate();
      d.edit((s) => ({ ...s, focusLog: [focusRec('focus-c-1', d.chapter, 30)], settings: { ...s.settings, name: 'To Be Deleted' } }));
      await d.engine.flush();
      const mine = () => psql(`select (select count(*) from public.study_sessions where user_id = '${c.id}') || '|' || (select count(*) from public.student_enrollments where user_id = '${c.id}') || '|' || (select count(*) from public.profiles where id = '${c.id}') || '|' || (select count(*) from auth.users where id = '${c.id}')`);
      expect(mine()).toBe('1|1|1|1');
      const chaptersBefore = row('select count(*) from public.chapters');

      expect(await deleteAccount(c.client, { email: c.email, password: PASSWORD, phrase: 'nope' })).toMatchObject({ kind: 'failed' });
      expect(await deleteAccount(c.client, { email: c.email, password: 'definitely the wrong one', phrase: DELETE_PHRASE })).toMatchObject({ kind: 'failed', reason: 'wrong-password' });
      expect(mine()).toBe('1|1|1|1');

      expect(await deleteAccount(c.client, { email: c.email, password: PASSWORD, phrase: DELETE_PHRASE })).toEqual({ kind: 'deleted' });
      expect(mine()).toBe('0|0|0|0');
      expect(row('select count(*) from public.chapters')).toBe(chaptersBefore);
      // the other accounts are untouched
      expect(row(`select count(*) from public.profiles where id in ('${a.id}', '${b.id}')`)).toBe('2');
    }, 60_000);
  });
});

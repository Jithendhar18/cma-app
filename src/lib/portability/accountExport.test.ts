import { beforeEach, describe, expect, it } from 'vitest';
import { CSV, ENROLLMENT, FIXTURE_TREE, G1, G2, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { exportAccountData, ExportError, EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, exportFileName, serializeExport } from './accountExport';

const A = U(100);
const B = U(101);
const CH = FIXTURE_TREE.chapters[0];
const SUBJECT = FIXTURE_TREE.subjects[0];
let b: FakeBackend;

const enrolment = (id: string, user: string, status: 'active' | 'archived', over: Record<string, unknown> = {}) => ({ id, user_id: user, csv_id: CSV, exam_attempt_id: U(901), status, exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: status === 'archived' ? 'y' : null, created_at: 'x', updated_at: 'x', ...over });
const sess = (i: number, user = A, enrollment = ENROLLMENT.id) => ({ id: U(40000 + i), user_id: user, enrollment_id: enrollment, csv_id: CSV, client_id: `f-${user.slice(-3)}-${i}`, chapter_id: CH.id, local_date: '2026-11-08', minutes: 5, mode: 'stopwatch', notes: '', planner_session_id: null, started_at: null, created_at: 'c', updated_at: `2026-11-08T00:00:00.${String(i).padStart(6, '0')}Z` });

beforeEach(() => {
  b = createFakeBackend();
  seedBackend(b, { userId: A, displayName: 'Asha' });
  b.signInAs(A, 'a@example.test');
  b.rows('student_enrollments').push(enrolment(ENROLLMENT.id, A, 'active', { exam_date_override: '2027-06-10' }));
  b.rows('enrollment_groups').push({ enrollment_id: ENROLLMENT.id, subject_group_id: G1, user_id: A, csv_id: CSV }, { enrollment_id: ENROLLMENT.id, subject_group_id: G2, user_id: A, csv_id: CSV });
});

describe('what is in the export', () => {
  it('is versioned and timestamped, with the documented structure', async () => {
    const doc = await exportAccountData(b.client, A, () => '2026-11-08T10:00:00.000Z');
    expect(doc).toMatchObject({ format: EXPORT_FORMAT, schema_version: EXPORT_SCHEMA_VERSION, exported_at: '2026-11-08T10:00:00.000Z', account: { user_id: A } });
    expect(Object.keys(doc).sort()).toEqual(['account', 'counts', 'data', 'enrollments', 'exported_at', 'format', 'import_history', 'profile', 'references', 'schema_version', 'settings']);
    expect(Object.keys(doc.data).sort()).toEqual(['chapter_progress', 'mock_tests', 'planner_sessions', 'practice_records', 'revisions', 'study_sessions']);
    expect(exportFileName(doc)).toBe('cma-study-os-account-2026-11-08.json');
  });
  it('includes the profile name, the settings, the enrolment with its groups and the student\'s own date', async () => {
    const doc = await exportAccountData(b.client, A);
    expect(doc.profile).toMatchObject({ display_name: 'Asha', time_zone: 'Asia/Kolkata' });
    expect(doc.settings).toMatchObject({ daily_target_hours: 8, theme: 'dark' });
    expect(doc.enrollments).toHaveLength(1);
    expect(doc.enrollments[0]).toMatchObject({ id: ENROLLMENT.id, status: 'active', exam_date_override: '2027-06-10', group_ids: [G1, G2].sort() });
  });
  it('exports every kind of study record with its stable ids', async () => {
    b.rows('chapter_progress').push({ id: U(1), user_id: A, enrollment_id: ENROLLMENT.id, csv_id: CSV, chapter_id: CH.id, status: 'completed', confidence: 4, notes: 'n', completed_on: '2026-11-01', created_at: 'c', updated_at: 'u' });
    b.rows('planner_sessions').push({ id: U(2), user_id: A, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 's-1', chapter_id: CH.id, planned_date: '2026-11-09', start_time: '09:30:00', duration_minutes: 60, status: 'upcoming', priority: 'high', notes: '', created_at: 'c', updated_at: 'u' });
    b.rows('study_sessions').push(sess(1));
    b.rows('revisions').push({ id: U(3), user_id: A, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'r-1', chapter_id: CH.id, revision_number: 1, due_date: '2026-11-10', completed_on: null, cancelled_on: null, priority: 'medium', created_at: 'c', updated_at: 'u' });
    b.rows('practice_records').push({ id: U(4), user_id: A, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'p-1', chapter_id: CH.id, local_date: '2026-11-07', questions: 10, correct: 7, created_at: 'c', updated_at: 'u' });
    b.rows('mock_tests').push({ id: U(5), user_id: A, enrollment_id: ENROLLMENT.id, csv_id: CSV, client_id: 'm-1', subject_id: SUBJECT.id, taken_on: '2026-11-05', name: 'Mock', score: 50, max_score: 100, created_at: 'c', updated_at: 'u' });
    const doc = await exportAccountData(b.client, A);
    expect(doc.counts).toMatchObject({ chapter_progress: 1, planner_sessions: 1, study_sessions: 1, revisions: 1, practice_records: 1, mock_tests: 1, enrollments: 1 });
    expect(doc.data.study_sessions[0]).toMatchObject({ client_id: expect.stringMatching(/^f-/), chapter_id: CH.id, enrollment_id: ENROLLMENT.id, minutes: 5 });
    expect(doc.references.chapters.map((c) => c.id)).toEqual([CH.id]);
    expect(doc.references.subjects.map((s) => s.id)).toContain(SUBJECT.id);
    expect(doc.references.chapters[0]).toMatchObject({ title: CH.title });
  });
  it('is complete past the API row cap: 2,300 rows come back as 2,300', async () => {
    b.tables.study_sessions = Array.from({ length: 2300 }, (_, i) => sess(i));
    const doc = await exportAccountData(b.client, A);
    expect(doc.data.study_sessions).toHaveLength(2300);
    expect(new Set(doc.data.study_sessions.map((r) => r.id)).size).toBe(2300);
    expect(b.calls.filter((c) => c.table === 'study_sessions' && c.op === 'select')).toHaveLength(3);
  });
  it('is well-formed with no data at all', async () => {
    const empty = createFakeBackend();
    seedBackend(empty, { userId: A });
    empty.signInAs(A, 'a@example.test');
    const doc = await exportAccountData(empty.client, A);
    expect(doc.enrollments).toEqual([]);
    expect(Object.values(doc.data).every((rows) => rows.length === 0)).toBe(true);
    expect(doc.references.chapters).toEqual([]);
    expect(JSON.parse(serializeExport(doc)).counts.study_sessions).toBe(0);
  });
  it('includes every enrolment, active and archived, with each one\'s records', async () => {
    b.rows('student_enrollments').push(enrolment(U(801), A, 'archived'));
    b.rows('study_sessions').push(sess(1, A, ENROLLMENT.id), sess(2, A, U(801)));
    const doc = await exportAccountData(b.client, A);
    expect(doc.enrollments.map((e) => e.status).sort()).toEqual(['active', 'archived']);
    expect(doc.data.study_sessions.map((r) => r.enrollment_id).sort()).toEqual([ENROLLMENT.id, U(801)].sort());
  });
});

describe('who and what it never includes', () => {
  it('contains only this user\'s data even when other users\' rows exist', async () => {
    b.rows('student_enrollments').push(enrolment(U(850), B, 'active'));
    b.rows('study_sessions').push(sess(1, A), sess(2, B, U(850)));
    b.rows('profiles').push({ id: B, display_name: 'Bob Secret', avatar_data_url: null, time_zone: 'Asia/Kolkata', onboarding_completed_at: null, created_at: 'x', updated_at: 'x' });
    b.rows('user_settings').push({ user_id: B, daily_target_hours: 3, weekly_target_hours: 50, study_start_time: '06:00:00', study_end_time: '23:00:00', pomodoro_focus_minutes: 50, short_break_minutes: 10, long_break_minutes: 20, long_break_every: 4, theme: 'light', created_at: 'x', updated_at: 'x' });
    const text = serializeExport(await exportAccountData(b.client, A));
    expect(text).not.toContain('Bob Secret');
    expect(text).not.toContain(B);
    expect(JSON.parse(text).data.study_sessions).toHaveLength(1);
    // and asked as the other user, only theirs
    b.signInAs(B, 'b@example.test');
    const theirs = await exportAccountData(b.client, B);
    expect(theirs.profile?.display_name).toBe('Bob Secret');
    expect(JSON.stringify(theirs)).not.toContain(A);
  });
  it('has no avatar, no credentials and no tokens', async () => {
    b.rows('profiles')[0].avatar_data_url = 'data:image/png;base64,SECRETPICTURE';
    const text = serializeExport(await exportAccountData(b.client, A));
    expect(text).not.toContain('SECRETPICTURE');
    expect(text).not.toMatch(new RegExp(['password', 'access_token', 'refresh_token', ['service', 'role'].join('_'), 'secret', 'jwt', 'apikey'].join('|'), 'i'));
  });
  it('only reads: no insert, update, delete, upsert or function call', async () => {
    b.rows('study_sessions').push(sess(1));
    await exportAccountData(b.client, A);
    expect(b.calls.filter((c) => c.op !== 'select')).toEqual([]);
    expect(b.rpcCalls).toEqual([]);
    expect(b.tables.study_sessions).toHaveLength(1);
  });
  it('every query names the user explicitly, on top of row level security', async () => {
    await exportAccountData(b.client, A);
    const owned = b.calls.filter((c) => ['student_enrollments', 'enrollment_groups', 'study_sessions', 'revisions', 'mock_tests', 'user_settings'].includes(c.table));
    expect(owned.length).toBeGreaterThan(0);
    for (const c of owned) expect(c.filters.some(([col, , v]) => (col === 'user_id' || col === 'id') && v === A), c.table).toBe(true);
  });
});

describe('failures', () => {
  it('a network failure is reported as such, and nothing partial is returned', async () => {
    b.offline = true;
    await expect(exportAccountData(b.client, A)).rejects.toMatchObject({ kind: 'network' });
  });
  it('an expired session is reported as such', async () => {
    b.failNext('study_sessions', { status: 401, message: 'JWT expired' });
    await expect(exportAccountData(b.client, A)).rejects.toMatchObject({ kind: 'signed-out', section: 'study_sessions' });
  });
  it('a failure on a later page fails the whole export (never a silently short file)', async () => {
    b.tables.study_sessions = Array.from({ length: 2300 }, (_, i) => sess(i));
    let n = 0;
    const real = b.client.from.bind(b.client);
    (b.client as unknown as { from: unknown }).from = (t: string) => { if (t === 'study_sessions' && ++n === 2) b.failNext('study_sessions', { code: '08006', message: 'down' }); return real(t as never); };
    await expect(exportAccountData(b.client, A)).rejects.toBeInstanceOf(ExportError);
  });
});

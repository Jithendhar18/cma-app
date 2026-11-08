import { beforeEach, describe, expect, it } from 'vitest';
import { ATTEMPT, ATTEMPT2, CSV, G1, G2, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { classifyEnrollmentError, EnrollmentError } from './types';
import { SupabaseEnrollments } from './supabaseEnrollments';

const USER = U(100);
let b: FakeBackend;
let repo: SupabaseEnrollments;
beforeEach(() => {
  b = createFakeBackend();
  seedBackend(b, { userId: USER, secondAttempt: true });
  b.signInAs(USER, 'a@example.test');
  repo = new SupabaseEnrollments(b.client);
});

describe('create', () => {
  it('calls create_enrollment with exactly the documented arguments and never inserts directly', async () => {
    const e = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    expect(b.rpcCalls).toEqual([{ name: 'create_enrollment', args: { p_csv_id: CSV, p_attempt_id: ATTEMPT, p_group_ids: [G1], p_replace_active: false } }]);
    expect(b.calls.filter((c) => ['insert', 'upsert', 'update', 'delete'].includes(c.op) && ['student_enrollments', 'enrollment_groups'].includes(c.table))).toEqual([]);
    expect(e).toMatchObject({ status: 'active', csvId: CSV, courseName: 'FAKE Course', syllabusName: 'FAKE Syllabus', attemptLabel: 'FAKE attempt', dateStatus: 'unannounced', attemptStartDate: null });
    expect(e.groups).toEqual([{ id: G1, name: 'Group I' }]);
  });
  it('resolves both groups in official order', async () => {
    const e = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G2, G1] });
    expect(e.groups.map((g) => g.name)).toEqual(['Group I', 'Group II']);
  });
  it('refuses an empty group set before calling the server', async () => {
    await expect(repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [] })).rejects.toMatchObject({ kind: 'invalid' });
    expect(b.rpcCalls).toEqual([]);
  });
  it('reports "already active" when the database refuses a second active enrolment, and creates nothing', async () => {
    await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    await expect(repo.create({ csvId: CSV, attemptId: ATTEMPT2, groupIds: [G1] })).rejects.toMatchObject({ kind: 'already-active' });
    expect(b.rows('student_enrollments')).toHaveLength(1);
  });
  it('replaces the active enrolment only when told to, archiving (not deleting) the old one', async () => {
    const first = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    const second = await repo.create({ csvId: CSV, attemptId: ATTEMPT2, groupIds: [G2], replaceActive: true });
    expect(b.rpcCalls.at(-1)?.args.p_replace_active).toBe(true);
    expect((await repo.getActive())?.id).toBe(second.id);
    expect((await repo.listArchived()).map((e) => e.id)).toEqual([first.id]);
  });
  it('maps a network failure to a retryable "network" error', async () => {
    b.offline = true;
    await expect(repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('manage', () => {
  it('changes the attempt through change_enrollment_attempt', async () => {
    const e = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    const changed = await repo.changeAttempt(e.id, ATTEMPT2);
    expect(b.rpcCalls.at(-1)).toEqual({ name: 'change_enrollment_attempt', args: { p_enrollment_id: e.id, p_attempt_id: ATTEMPT2, p_clear_dates: true } });
    expect(changed.attemptLabel).toBe('FAKE attempt 2');
    expect(changed.dateStatus).toBe('official');
  });
  it('sets groups through set_enrollment_groups and refuses an empty set', async () => {
    const e = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    expect((await repo.setGroups(e.id, [G1, G2])).groups).toHaveLength(2);
    expect(b.rpcCalls.at(-1)?.name).toBe('set_enrollment_groups');
    await expect(repo.setGroups(e.id, [])).rejects.toMatchObject({ kind: 'invalid' });
  });
  it('archives and re-activates through their functions, keeping the one-active rule', async () => {
    const e = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    expect((await repo.archive(e.id)).status).toBe('archived');
    expect(await repo.getActive()).toBeNull();
    expect((await repo.activate(e.id)).status).toBe('active');
    expect(b.rpcCalls.map((c) => c.name)).toEqual(['create_enrollment', 'archive_enrollment', 'activate_enrollment']);
  });
  it('reports not-found for an enrolment that does not exist', async () => {
    await expect(repo.archive(U(12345))).rejects.toBeInstanceOf(EnrollmentError);
  });
  it('uses only the five documented functions across every operation', async () => {
    const e = await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    await repo.changeAttempt(e.id, ATTEMPT2);
    await repo.setGroups(e.id, [G2]);
    await repo.archive(e.id);
    await repo.activate(e.id);
    expect(new Set(b.rpcCalls.map((c) => c.name))).toEqual(new Set(['create_enrollment', 'change_enrollment_attempt', 'set_enrollment_groups', 'archive_enrollment', 'activate_enrollment']));
  });
});

describe('reads', () => {
  it('returns null when there is no active enrolment', async () => {
    expect(await repo.getActive()).toBeNull();
    expect(await repo.listArchived()).toEqual([]);
  });
  it('fails (does not show a half-resolved row) when the shared curriculum behind an enrolment cannot be read', async () => {
    await repo.create({ csvId: CSV, attemptId: ATTEMPT, groupIds: [G1] });
    b.tables.exam_attempts = [];
    await expect(repo.getActive()).rejects.toMatchObject({ kind: 'unknown' });
  });
});

describe('classifyEnrollmentError', () => {
  const kind = (e: unknown) => classifyEnrollmentError(e).kind;
  it('classifies the database and network failures it must tell apart', () => {
    expect(kind(new TypeError('Failed to fetch'))).toBe('network');
    expect(kind({ code: '28000', message: 'x' })).toBe('signed-out');
    expect(kind({ status: 401, message: 'x' })).toBe('signed-out');
    expect(kind({ code: '23505', message: 'x' })).toBe('already-active');
    expect(kind({ code: '23514', message: 'group is not published' })).toBe('not-available');
    expect(kind({ code: '23514', message: 'x' })).toBe('invalid');
    expect(kind({ code: '22023', message: 'x' })).toBe('invalid');
    expect(kind({ code: 'P0002', message: 'x' })).toBe('not-found');
    expect(kind({ message: 'boom' })).toBe('unknown');
    expect(kind(null)).toBe('unknown');
  });
  it('keeps an existing EnrollmentError as-is', () => {
    const e = new EnrollmentError('invalid', 'm');
    expect(classifyEnrollmentError(e)).toBe(e);
  });
  it('never puts server text in the user-facing message', () => {
    expect(classifyEnrollmentError({ code: '23505', message: 'duplicate key value violates constraint secret_name' }).message).not.toContain('secret_name');
  });
});

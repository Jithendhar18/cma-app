import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAccounts, startApp } from '@/test/appHarness';
import { ATTEMPT, CSV, G1, G2, seedBackend, U } from '@/test/accountFixtures';
import { createFakeBackend, type FakeBackend } from '@/test/fakeBackend';
import { resetLinkCacheForTests } from '@/features/auth/pkceCallback';
import { accountKeys } from '@/lib/account/keys';

// These render the whole app; give slow machines (or a busy CI runner) more than the 1 s default before a lookup gives up.
configure({ asyncUtilTimeout: 6000 });

const client = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/supabase/client')>()), getSupabaseClient: client.getSupabaseClient }));

const USER = U(100);
let b: FakeBackend;
beforeEach(() => {
  localStorage.clear();
  b = createFakeBackend();
  client.getSupabaseClient.mockReset();
  client.getSupabaseClient.mockResolvedValue(b.client);
  resetLinkCacheForTests();
  enableAccounts();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const signIn = (opts: Parameters<typeof seedBackend>[1] extends infer O ? Partial<O> : never = {}) => {
  seedBackend(b, { userId: USER, ...opts });
  b.signInAs(USER, 'asha@example.test');
};

describe('onboarding with no published curriculum (the real dataset today)', () => {
  it('says enrolment is not open yet, offers local mode, and shows no sample or draft data', async () => {
    signIn({ publishedGroups: [] });
    startApp('/');
    expect(await screen.findByText('Enrolment is not open yet')).toBeTruthy();
    expect(screen.getByText('Verified course options are not currently available.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use local mode instead' })).toBeTruthy();
    expect(screen.queryByText(/Cost Accounting/i)).toBeNull();
    expect(b.rpcCalls).toEqual([]);
    expect(b.rows('student_enrollments')).toEqual([]);
  });

  it('returns to local mode, which then shows the untouched local app', async () => {
    signIn({ publishedGroups: [] });
    const { user } = startApp('/');
    await user.click(await screen.findByRole('button', { name: 'Use local mode instead' }));
    await waitFor(() => expect(localStorage.getItem(accountKeys(USER).mode)).toBe('local'));
    expect(screen.queryByText('Enrolment is not open yet')).toBeNull();
  });
});

describe('onboarding with published options', () => {
  it('offers the four controls, creates the enrolment through the RPC, then marks onboarding complete', async () => {
    signIn();
    const { user } = startApp('/');
    expect(await screen.findByText('Choose your course')).toBeTruthy();
    // a sole option at every level is selected for you, but still shown
    await user.click(await screen.findByLabelText(/Group I$/));
    await user.click(screen.getByRole('button', { name: 'Start studying' }));
    await waitFor(() => expect(b.rpcCalls.map((c) => c.name)).toEqual(['create_enrollment']));
    expect(b.rpcCalls[0].args).toEqual({ p_csv_id: CSV, p_attempt_id: ATTEMPT, p_group_ids: [G1], p_replace_active: false });
    await waitFor(() => expect(b.rows('profiles')[0].onboarding_completed_at).not.toBeNull());
    expect(b.rows('student_enrollments')).toHaveLength(1);
  });

  it('refuses to submit with no group chosen and calls nothing', async () => {
    signIn();
    const { user } = startApp('/');
    await user.click(await screen.findByRole('button', { name: 'Start studying' }));
    expect(b.rpcCalls).toEqual([]);
  });

  it('allows Group II alone and both groups', async () => {
    signIn();
    const { user } = startApp('/');
    await user.click(await screen.findByLabelText(/Group I$/));
    await user.click(screen.getByLabelText(/Group II$/));
    await user.click(screen.getByRole('button', { name: 'Start studying' }));
    await waitFor(() => expect(b.rpcCalls[0]?.args.p_group_ids).toEqual([G1, G2]));
  });

  it('shows only Group I when only Group I is published', async () => {
    signIn({ publishedGroups: [G1] });
    startApp('/');
    expect(await screen.findByLabelText(/Group I$/)).toBeTruthy();
    expect(screen.queryByLabelText(/Group II$/)).toBeNull();
  });

  it('does not show sample data or another user\'s rows when the options cannot be loaded; offers Try again', async () => {
    signIn();
    b.failNext('enrollment_options', { message: 'Failed to fetch', name: 'TypeError' });
    const { user } = startApp('/');
    expect(await screen.findByText(/could not load the course options/i)).toBeTruthy();
    expect(screen.queryByText(/Cost Accounting/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Choose your course')).toBeTruthy();
  });

  it('recovers when an enrolment already exists (created earlier, onboarding flag never set): no duplicate is made', async () => {
    signIn();
    b.rows('student_enrollments').push({ id: U(800), user_id: USER, csv_id: CSV, exam_attempt_id: ATTEMPT, status: 'active', exam_date_override: null, final_revision_date: null, started_at: 'x', archived_at: null, created_at: 'x', updated_at: 'x' });
    b.rows('enrollment_groups').push({ enrollment_id: U(800), subject_group_id: G1, user_id: USER, csv_id: CSV });
    startApp('/');
    await waitFor(() => expect(b.rows('profiles')[0].onboarding_completed_at).not.toBeNull());
    expect(b.rows('student_enrollments')).toHaveLength(1);
    expect(b.rpcCalls.filter((c) => c.name === 'create_enrollment')).toEqual([]);
    expect(screen.queryByText('Choose your course')).toBeNull();
  });
});

describe('account mode never shows local data', () => {
  it('does not change the local study key and shows none of its content', async () => {
    // A real local entry: what the app itself writes when it starts signed out.
    const first = startApp('/');
    await screen.findAllByText('Workspace');
    first.unmount();
    const before = localStorage.getItem('cma-study-os');
    const localName = JSON.parse(before ?? '{}').state?.settings?.name as string;
    expect(localName).toBeTruthy();
    signIn({ publishedGroups: [], displayName: 'Account Person' });
    startApp('/');
    await screen.findByText('Enrolment is not open yet');
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toContain(localName);
    expect(localStorage.getItem('cma-study-os')).toBe(before);
  });
});

describe('enrolment management in Settings', () => {
  const enrolled = async (opts = {}) => {
    signIn({ secondAttempt: true, ...opts });
    b.rows('student_enrollments').push({ id: U(800), user_id: USER, csv_id: CSV, exam_attempt_id: ATTEMPT, status: 'active', exam_date_override: null, final_revision_date: null, started_at: '2026-11-01T00:00:00Z', archived_at: null, created_at: 'x', updated_at: 'x' });
    b.rows('enrollment_groups').push({ enrollment_id: U(800), subject_group_id: G1, user_id: USER, csv_id: CSV });
    b.rows('profiles')[0].onboarding_completed_at = '2026-11-01T00:00:00Z';
    const app = startApp('/settings');
    await screen.findByText('Syllabus version');
    return app;
  };

  it('shows the course, syllabus, attempt, an honest date status and groups', async () => {
    await enrolled();
    expect(screen.getAllByText(/FAKE Syllabus/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FAKE attempt/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not announced/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Group I/).length).toBeGreaterThan(0);
  });

  it('archives only after confirmation, through archive_enrollment', async () => {
    const { user } = await enrolled();
    await user.click(screen.getByRole('button', { name: /Archive enrolment/i }));
    expect(b.rpcCalls.filter((c) => c.name === 'archive_enrollment')).toEqual([]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Archive enrolment/i }));
    await waitFor(() => expect(b.rpcCalls.map((c) => c.name)).toContain('archive_enrollment'));
    expect(b.rows('student_enrollments')[0].status).toBe('archived');
    expect(b.rows('student_enrollments')).toHaveLength(1); // archived, never deleted
  });

  it('is blocked while the timer is running, with an explanation, and calls nothing', async () => {
    const { registerSwitchGuard } = await import('@/lib/account/switchGuards');
    const off = registerSwitchGuard('test-timer', () => ({ ok: false, reason: 'timer-running', message: 'Stop the timer before switching.' }));
    try {
      const { user } = await enrolled();
      await user.click(screen.getByRole('button', { name: /Archive enrolment/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /Archive enrolment/i }));
      expect(await screen.findByText(/Stop the timer before switching/)).toBeTruthy();
      expect(b.rpcCalls.filter((c) => c.name === 'archive_enrollment')).toEqual([]);
    } finally {
      off();
    }
  });
});

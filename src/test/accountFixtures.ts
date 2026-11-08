import type { Profile, AccountSettings } from '@/features/auth/accountApi';
import type { CurriculumTree } from '@/lib/curriculum/types';
import type { Enrollment } from '@/lib/enrollment/types';

/**
 * A small, obviously fake published curriculum for tests: two groups, three papers, five chapters, UUID ids. It is NOT the CMA syllabus
 * and shares nothing with the real draft bundle.
 */
export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const CSV = U(900);
export const ATTEMPT = U(901);
export const G1 = U(1);
export const G2 = U(2);

export const FIXTURE_TREE: CurriculumTree = {
  identity: { source: 'account', csvId: CSV, courseName: 'FAKE Course', syllabusName: 'FAKE Syllabus' },
  groups: [{ id: G1, name: 'Group I', sortOrder: 1 }, { id: G2, name: 'Group II', sortOrder: 2 }],
  subjects: [
    { id: U(11), slug: 'fake-one', paperNumber: 1, name: 'FAKE Subject One', shortName: 'Fake 1', group: 'Group I', groupId: G1 },
    { id: U(12), slug: 'fake-two', paperNumber: 2, name: 'FAKE Subject Two', shortName: 'Fake 2', group: 'Group I', groupId: G1 },
    { id: U(13), slug: 'fake-three', paperNumber: 3, name: 'FAKE Subject Three', shortName: 'Fake 3', group: 'Group II', groupId: G2 },
  ],
  sections: [],
  chapters: [
    { id: U(21), subjectId: U(11), sectionId: null, officialLabel: '1', title: 'FAKE Chapter 1', order: 1, estimatedHours: 0, retired: false },
    { id: U(22), subjectId: U(11), sectionId: null, officialLabel: '2', title: 'FAKE Chapter 2', order: 2, estimatedHours: 6, retired: false },
    { id: U(23), subjectId: U(12), sectionId: null, officialLabel: '1', title: 'FAKE Chapter 3', order: 1, estimatedHours: 0, retired: false },
    { id: U(24), subjectId: U(13), sectionId: null, officialLabel: '1', title: 'FAKE Chapter 4', order: 1, estimatedHours: 0, retired: false },
    { id: U(25), subjectId: U(13), sectionId: null, officialLabel: '2', title: 'FAKE Chapter 5 (retired)', order: 2, estimatedHours: 0, retired: true },
  ],
  weightages: [],
};

export const ENROLLMENT: Enrollment = {
  id: U(800), csvId: CSV, examAttemptId: ATTEMPT, status: 'active', examDateOverride: null, finalRevisionDate: null,
  startedAt: '2026-11-01T00:00:00Z', archivedAt: null, updatedAt: '2026-11-01T00:00:00Z',
  groups: [{ id: G1, name: 'Group I' }], courseName: 'FAKE Course', syllabusName: 'FAKE Syllabus', attemptLabel: 'FAKE attempt', attemptStartDate: null, dateStatus: 'unannounced',
};

export const PROFILE = (id: string, displayName = 'Asha'): Profile => ({ id, displayName, timeZone: 'Asia/Kolkata', onboardingCompletedAt: null });
export const USER_SETTINGS: AccountSettings = {
  dailyTargetHours: 8, weeklyTargetHours: 50, studyStartTime: '06:00:00', studyEndTime: '23:00:00', pomodoroFocusMinutes: 50,
  shortBreakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 4, theme: 'dark',
};

// ---- a fake backend's rows -------------------------------------------------------------------------------------------------------
import type { FakeBackend, Row } from './fakeBackend';

export const ATTEMPT2 = U(902);
export const COURSE = U(950);
export const SYLLABUS = U(951);

export interface SeedOptions {
  userId: string;
  /** Group ids that are published (the rest are drafts, present in the tables but never visible). Default: both. */
  publishedGroups?: string[];
  /** Also offer a second attempt (with an official date) for the same syllabus. */
  secondAttempt?: boolean;
  displayName?: string;
}

/** Fills a fake backend with a fake curriculum (the same one as FIXTURE_TREE) and one signed-in user's profile and settings. */
export function seedBackend(b: FakeBackend, o: SeedOptions): void {
  const published = new Set(o.publishedGroups ?? [G1, G2]);
  const groupStatus = new Map(FIXTURE_TREE.groups.map((g) => [g.id, published.has(g.id) ? 'published' : 'draft']));
  const T = b.tables;
  T.courses = [{ id: COURSE, name: 'FAKE Course', status: 'published' }];
  T.syllabus_versions = [{ id: SYLLABUS, name: 'FAKE Syllabus', status: 'published' }];
  T.course_syllabus_versions = [{ id: CSV, course_id: COURSE, syllabus_version_id: SYLLABUS, status: 'published' }];
  T.exam_attempts = [
    { id: ATTEMPT, year: 2026, session: 'december', label: 'FAKE attempt', exam_start_date: null, exam_end_date: null, date_status: 'unannounced', status: 'published' },
    ...(o.secondAttempt ? [{ id: ATTEMPT2, year: 2027, session: 'june', label: 'FAKE attempt 2', exam_start_date: '2027-06-01', exam_end_date: '2027-06-08', date_status: 'official', status: 'published' }] : []),
  ];
  const openGroups = FIXTURE_TREE.groups.filter((g) => published.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
  const optionBase = { course_id: COURSE, course_name: 'FAKE Course', course_order: 1, csv_id: CSV, syllabus_version_id: SYLLABUS, syllabus_name: 'FAKE Syllabus', effective_from: null };
  T.enrollment_options = openGroups.length === 0 ? [] : [
    { ...optionBase, exam_attempt_id: ATTEMPT, attempt_label: 'FAKE attempt', attempt_year: 2026, attempt_session: 'december', exam_start_date: null, exam_end_date: null, date_status: 'unannounced', groups: openGroups },
    ...(o.secondAttempt ? [{ ...optionBase, exam_attempt_id: ATTEMPT2, attempt_label: 'FAKE attempt 2', attempt_year: 2027, attempt_session: 'june', exam_start_date: '2027-06-01', exam_end_date: '2027-06-08', date_status: 'official', groups: openGroups }] : []),
  ];
  T.subject_groups = FIXTURE_TREE.groups.map((g) => ({ id: g.id, csv_id: CSV, stable_key: `g-${g.sortOrder}`, name: g.name, sort_order: g.sortOrder, status: groupStatus.get(g.id), updated_at: '2026-11-01T00:00:00Z' }));
  T.subjects = FIXTURE_TREE.subjects.map((s, i) => ({ id: s.id, csv_id: CSV, subject_group_id: s.groupId, stable_key: s.slug, slug: s.slug, paper_number: s.paperNumber, name: s.name, short_name: s.shortName, sort_order: i + 1, status: groupStatus.get(s.groupId ?? ''), updated_at: '2026-11-01T00:00:00Z' }));
  T.syllabus_sections = [];
  T.chapters = FIXTURE_TREE.chapters.map((c) => {
    const subject = FIXTURE_TREE.subjects.find((s) => s.id === c.subjectId);
    const status = c.retired ? 'retired' : groupStatus.get(subject?.groupId ?? '');
    return { id: c.id, csv_id: CSV, subject_id: c.subjectId, section_id: null, stable_key: `c-${c.id.slice(-3)}`, official_label: c.officialLabel, title: c.title, sequence_no: c.order, suggested_study_hours: c.estimatedHours > 0 ? c.estimatedHours : null, status, updated_at: '2026-11-01T00:00:00Z' };
  });
  T.official_weightages = [];
  T.study_resources = [
    { id: U(960), resource_type: 'mcq_bank', title: 'FAKE published MCQ bank', url: 'https://example.invalid/mcq', publisher: 'FAKE', is_official: true, csv_id: CSV, subject_id: U(11), chapter_id: null, exam_attempt_id: null, year: null, session: null, link_status: 'active', status: 'published', updated_at: 'x' },
    { id: U(961), resource_type: 'notice', title: 'FAKE DRAFT notice (must never appear)', url: 'https://example.invalid/draft', publisher: 'FAKE', is_official: true, csv_id: CSV, subject_id: null, chapter_id: null, exam_attempt_id: null, year: 2026, session: 'december', link_status: 'active', status: 'draft', updated_at: 'x' },
    { id: U(962), resource_type: 'study_material', title: 'FAKE broken link (must never appear)', url: 'https://example.invalid/broken', publisher: 'FAKE', is_official: true, csv_id: CSV, subject_id: null, chapter_id: null, exam_attempt_id: null, year: null, session: null, link_status: 'broken', status: 'published', updated_at: 'x' },
  ];
  T.profiles = [{ id: o.userId, display_name: o.displayName ?? 'Asha', avatar_data_url: null, time_zone: 'Asia/Kolkata', onboarding_completed_at: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' } as Row];
  T.user_settings = [{ user_id: o.userId, daily_target_hours: 8, weekly_target_hours: 50, study_start_time: '06:00:00', study_end_time: '23:00:00', pomodoro_focus_minutes: 50, short_break_minutes: 10, long_break_minutes: 20, long_break_every: 4, theme: 'dark', created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' } as Row];
  T.student_enrollments = T.student_enrollments ?? [];
  T.enrollment_groups = T.enrollment_groups ?? [];
}

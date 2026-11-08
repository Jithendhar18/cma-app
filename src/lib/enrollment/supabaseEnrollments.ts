import type { AppSupabaseClient } from '@/lib/supabase/client';
import { fetchAllPages } from '@/lib/curriculum/paging';
import { classifyEnrollmentError, EnrollmentError, type Enrollment, type EnrollmentRepository, type NewEnrollment } from './types';

type Row = Record<string, unknown>;
const isString = (v: unknown): v is string => typeof v === 'string';
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Enrolments through the database's own functions. There is no direct insert into `student_enrollments` or `enrollment_groups`: the
 * database decides ownership, which combinations exist, which groups belong, and that only one enrolment is active. This class only
 * calls those functions and reads the result back.
 */
export class SupabaseEnrollments implements EnrollmentRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getActive(): Promise<Enrollment | null> {
    return this.guard(async () => {
      const { data, error } = await this.client.from('student_enrollments').select('*').eq('status', 'active').limit(2);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return null;
      if (rows.length > 1) throw new EnrollmentError('unknown', 'More than one active enrolment was returned.');
      return (await this.resolve(rows))[0] ?? null;
    });
  }

  async listArchived(): Promise<Enrollment[]> {
    return this.guard(async () => {
      const rows = await fetchAllPages((from, to) => this.client.from('student_enrollments').select('*').eq('status', 'archived').order('archived_at', { ascending: false }).order('id').range(from, to));
      return this.resolve(rows);
    });
  }

  async create(input: NewEnrollment): Promise<Enrollment> {
    return this.guard(async () => {
      if (input.groupIds.length === 0) throw new EnrollmentError('invalid', 'Choose at least one group.');
      const { data, error } = await this.client.rpc('create_enrollment', {
        p_csv_id: input.csvId, p_attempt_id: input.attemptId, p_group_ids: input.groupIds, p_replace_active: input.replaceActive ?? false,
      });
      if (error) throw error;
      if (!isString(data)) throw new EnrollmentError('unknown', 'The server did not return the new enrolment.');
      return this.byId(data);
    });
  }

  async changeAttempt(id: string, attemptId: string, clearDates = true): Promise<Enrollment> {
    return this.guard(async () => {
      const { error } = await this.client.rpc('change_enrollment_attempt', { p_enrollment_id: id, p_attempt_id: attemptId, p_clear_dates: clearDates });
      if (error) throw error;
      return this.byId(id);
    });
  }

  async setGroups(id: string, groupIds: string[]): Promise<Enrollment> {
    return this.guard(async () => {
      if (groupIds.length === 0) throw new EnrollmentError('invalid', 'Choose at least one group.');
      const { error } = await this.client.rpc('set_enrollment_groups', { p_enrollment_id: id, p_group_ids: groupIds });
      if (error) throw error;
      return this.byId(id);
    });
  }

  async activate(id: string): Promise<Enrollment> {
    return this.guard(async () => {
      const { error } = await this.client.rpc('activate_enrollment', { p_enrollment_id: id });
      if (error) throw error;
      return this.byId(id);
    });
  }

  async archive(id: string): Promise<Enrollment> {
    return this.guard(async () => {
      const { error } = await this.client.rpc('archive_enrollment', { p_enrollment_id: id });
      if (error) throw error;
      return this.byId(id);
    });
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------------------
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw classifyEnrollmentError(error instanceof Error && error.name === 'PagingError' ? (error as { cause?: unknown }).cause ?? error : error);
    }
  }

  private async byId(id: string): Promise<Enrollment> {
    const { data, error } = await this.client.from('student_enrollments').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new EnrollmentError('not-found', 'That enrolment could not be found.');
    const [found] = await this.resolve([data]);
    if (!found) throw new EnrollmentError('unknown', 'The enrolment could not be read.');
    return found;
  }

  /** Adds the course, syllabus, attempt and group labels. A row whose shared records cannot be read is reported, not half-shown. */
  private async resolve(rows: Row[]): Promise<Enrollment[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.id));
    const csvIds = [...new Set(rows.map((r) => String(r.csv_id)))];
    const attemptIds = [...new Set(rows.map((r) => String(r.exam_attempt_id)))];

    const [links, attempts, memberships] = await Promise.all([
      this.client.from('course_syllabus_versions').select('id, course_id, syllabus_version_id').in('id', csvIds),
      this.client.from('exam_attempts').select('id, label, exam_start_date, date_status').in('id', attemptIds),
      this.client.from('enrollment_groups').select('enrollment_id, subject_group_id').in('enrollment_id', ids),
    ]);
    for (const r of [links, attempts, memberships]) if (r.error) throw r.error;
    const courseIds = [...new Set((links.data ?? []).map((l) => l.course_id))];
    const syllabusIds = [...new Set((links.data ?? []).map((l) => l.syllabus_version_id))];
    const groupIds = [...new Set((memberships.data ?? []).map((m) => m.subject_group_id))];
    const [courses, syllabi, groups] = await Promise.all([
      this.client.from('courses').select('id, name').in('id', courseIds),
      this.client.from('syllabus_versions').select('id, name').in('id', syllabusIds),
      groupIds.length > 0 ? this.client.from('subject_groups').select('id, name, sort_order').in('id', groupIds) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [courses, syllabi, groups]) if (r.error) throw r.error;

    const link = new Map((links.data ?? []).map((l) => [l.id, l]));
    const course = new Map((courses.data ?? []).map((c) => [c.id, c.name]));
    const syllabus = new Map((syllabi.data ?? []).map((s) => [s.id, s.name]));
    const attempt = new Map((attempts.data ?? []).map((a) => [a.id, a]));
    const group = new Map((groups.data ?? []).map((g) => [g.id, g]));

    const result: Enrollment[] = [];
    for (const r of rows) {
      const csvLink = link.get(String(r.csv_id));
      const att = attempt.get(String(r.exam_attempt_id));
      const courseName = csvLink ? course.get(csvLink.course_id) : undefined;
      const syllabusName = csvLink ? syllabus.get(csvLink.syllabus_version_id) : undefined;
      const status = r.status;
      if (!csvLink || !att || !courseName || !syllabusName || (status !== 'active' && status !== 'archived')) {
        throw new EnrollmentError('unknown', 'An enrolment refers to curriculum that could not be read.');
      }
      const memberGroups = (memberships.data ?? [])
        .filter((m) => m.enrollment_id === r.id)
        .map((m) => group.get(m.subject_group_id))
        .filter((g): g is { id: string; name: string; sort_order: number } => g !== undefined)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => ({ id: g.id, name: g.name }));
      result.push({
        id: String(r.id), csvId: String(r.csv_id), examAttemptId: String(r.exam_attempt_id), status,
        examDateOverride: dateOrNull(r.exam_date_override), finalRevisionDate: dateOrNull(r.final_revision_date),
        startedAt: String(r.started_at), archivedAt: dateOrNull(r.archived_at), updatedAt: String(r.updated_at),
        groups: memberGroups, courseName, syllabusName, attemptLabel: att.label, attemptStartDate: att.exam_start_date, dateStatus: att.date_status,
      });
    }
    return result;
  }
}

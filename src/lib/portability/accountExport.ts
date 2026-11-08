import { fetchAllPages, PagingError } from '@/lib/curriculum/paging';
import type { AppSupabaseClient } from '@/lib/supabase/client';

/**
 * Export of everything the signed-in account owns, as one JSON document.
 *
 * Format `cma-study-os-account-export`, schema version 1. Row fields keep the database's own column names, so the document is
 * self-describing and documented by the schema (docs/architecture/database-schema.md):
 *
 *   profile            the display name and time zone (no avatar: that is a device-only picture; no credentials of any kind)
 *   settings           the account's settings row
 *   enrollments        every enrolment, active and archived, each with its `group_ids`
 *   data               chapter_progress, planner_sessions, study_sessions, revisions, practice_records, mock_tests (all enrolments)
 *   import_history     which local backups were imported (fingerprints and counts only)
 *   references         labels for the shared curriculum records the data points at, so ids are understandable. NOT user-owned data.
 *   counts             rows per section, so a reader can check nothing is missing
 *
 * Read-only: it issues SELECTs through the signed-in user's own access, which row level security limits to that user. Every query also
 * names the user explicitly, and every list is read page by page so no row is lost to the API's response cap.
 */
export const EXPORT_FORMAT = 'cma-study-os-account-export';
export const EXPORT_SCHEMA_VERSION = 1;

type Row = Record<string, unknown>;
const PERSONAL = ['chapter_progress', 'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests'] as const;
export type ExportDataKey = (typeof PERSONAL)[number];

export interface AccountExport {
  format: typeof EXPORT_FORMAT;
  schema_version: number;
  exported_at: string;
  account: { user_id: string };
  profile: Row | null;
  settings: Row | null;
  enrollments: Row[];
  data: Record<ExportDataKey, Row[]>;
  import_history: Row[];
  references: { note: string; courses: Row[]; syllabus_versions: Row[]; exam_attempts: Row[]; subject_groups: Row[]; subjects: Row[]; chapters: Row[] };
  counts: Record<string, number>;
}

export class ExportError extends Error {
  readonly detail: unknown;
  constructor(public readonly kind: 'signed-out' | 'network' | 'failed', public readonly section: string, detail?: unknown) {
    super(`Could not read ${section}.`);
    this.name = 'ExportError';
    this.detail = detail;
  }
}

function classify(error: unknown, section: string): ExportError {
  const inner = error instanceof PagingError ? error.cause : error;
  const e = (typeof inner === 'object' && inner !== null ? inner : {}) as { code?: unknown; status?: unknown; message?: unknown };
  const text = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (inner instanceof TypeError || /failed to fetch|network|load failed/.test(text)) return new ExportError('network', section, inner);
  if (e.status === 401 || e.code === '28000' || e.code === 'PGRST301' || /jwt/.test(text)) return new ExportError('signed-out', section, inner);
  return new ExportError('failed', section, inner);
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const ids = (rows: Row[], col: string) => unique(rows.map((r) => r[col]).filter((v): v is string => typeof v === 'string'));

export async function exportAccountData(client: AppSupabaseClient, userId: string, now: () => string = () => new Date().toISOString()): Promise<AccountExport> {
  // The generated types cannot follow a table name chosen at run time; this is the one place that needs the looser view of the client.
  interface Q extends PromiseLike<{ data: unknown; error: unknown }> {
    select(c?: string): Q; eq(c: string, v: unknown): Q; in(c: string, v: unknown[]): Q; order(c: string, o?: { ascending?: boolean }): Q; range(a: number, b: number): Q; maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
  }
  const db = client as unknown as { from(t: string): Q };

  const paged = async (table: string, owner: string, columns = '*', order = 'id'): Promise<Row[]> => {
    try {
      return await fetchAllPages<Row>((from, to) => db.from(table).select(columns).eq(owner, userId).order(order, { ascending: true }).order(owner, { ascending: true }).range(from, to) as PromiseLike<{ data: Row[] | null; error: unknown }>);
    } catch (e) {
      throw classify(e, table);
    }
  };
  const single = async (table: string, owner: string, columns: string): Promise<Row | null> => {
    const { data, error } = await db.from(table).select(columns).eq(owner, userId).maybeSingle();
    if (error) throw classify(error, table);
    return (data as Row | null) ?? null;
  };
  const lookup = async (table: string, idList: string[], columns: string): Promise<Row[]> => {
    const out: Row[] = [];
    for (const part of chunks(idList, 100)) {
      const { data, error } = await db.from(table).select(columns).in('id', part);
      if (error) throw classify(error, `${table} (reference)`);
      out.push(...((data ?? []) as Row[]));
    }
    return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  const profile = await single('profiles', 'id', 'id, display_name, time_zone, onboarding_completed_at, created_at, updated_at');
  const settings = await single('user_settings', 'user_id', '*');
  const enrollmentRows = await paged('student_enrollments', 'user_id');
  const groupRows = await paged('enrollment_groups', 'user_id', '*', 'enrollment_id');
  const data = {} as Record<ExportDataKey, Row[]>;
  for (const t of PERSONAL) data[t] = await paged(t, 'user_id');
  const history = await paged('local_import_runs', 'user_id');

  const enrollments = enrollmentRows.map((e) => ({ ...e, group_ids: groupRows.filter((g) => g.enrollment_id === e.id).map((g) => g.subject_group_id).sort() }));

  // Reference labels only for what this account's data points at, never the whole curriculum.
  const chapterIds = unique([...PERSONAL.flatMap((t) => ids(data[t], 'chapter_id'))]);
  const chapters = await lookup('chapters', chapterIds, 'id, stable_key, official_label, title, subject_id, status');
  const subjectIds = unique([...ids(chapters, 'subject_id'), ...ids(data.mock_tests, 'subject_id')]);
  const subjects = await lookup('subjects', subjectIds, 'id, stable_key, slug, paper_number, name, short_name, subject_group_id');
  const groupIds = unique([...ids(groupRows, 'subject_group_id'), ...ids(subjects, 'subject_group_id')]);
  const subjectGroups = await lookup('subject_groups', groupIds, 'id, stable_key, name');
  const csvIds = ids(enrollmentRows, 'csv_id');
  const csvs = await lookup('course_syllabus_versions', csvIds, 'id, course_id, syllabus_version_id');
  const courses = await lookup('courses', ids(csvs, 'course_id'), 'id, stable_key, name');
  const syllabi = await lookup('syllabus_versions', ids(csvs, 'syllabus_version_id'), 'id, stable_key, name');
  const attempts = await lookup('exam_attempts', ids(enrollmentRows, 'exam_attempt_id'), 'id, stable_key, label, year, session, exam_start_date, exam_end_date, date_status');

  const doc: AccountExport = {
    format: EXPORT_FORMAT, schema_version: EXPORT_SCHEMA_VERSION, exported_at: now(), account: { user_id: userId },
    profile, settings, enrollments, data, import_history: history,
    references: {
      note: 'Labels for shared curriculum records that your data refers to, so the ids are readable. This is not your data and is not needed to restore it.',
      courses, syllabus_versions: syllabi, exam_attempts: attempts, subject_groups: subjectGroups, subjects, chapters,
    },
    counts: {},
  };
  doc.counts = { enrollments: enrollments.length, ...Object.fromEntries(PERSONAL.map((t) => [t, data[t].length])), import_history: history.length, chapters_referenced: chapters.length };
  return doc;
}

export const exportFileName = (doc: AccountExport) => `cma-study-os-account-${doc.exported_at.slice(0, 10)}.json`;
export const serializeExport = (doc: AccountExport) => JSON.stringify(doc, null, 2);

export function downloadJson(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

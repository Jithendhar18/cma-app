import type {
  CurriculumChapter, CurriculumGroup, CurriculumSection, CurriculumSubject, CurriculumTree, CurriculumWeightage, DataIssue, EnrollmentOption,
} from './types';

/**
 * Turns raw server rows into the curriculum view-model. Nothing from the network is trusted: every row is checked, and a row that does
 * not pass is skipped and reported in `issues`, never applied. Draft rows are refused even if the server were ever to send one, and
 * references are resolved so a chapter can never point at a subject (or a subject at a group) that is not in the same payload.
 */

type Raw = Record<string, unknown>;
const isRec = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullableStr = (v: unknown): v is string | null => v === null || typeof v === 'string';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VISIBLE = new Set(['published', 'retired']);

export const hasVisibleStatus = (row: Raw) => typeof row.status === 'string' && VISIBLE.has(row.status);

function reject(issues: DataIssue[], table: string, row: unknown, problem: string): null {
  issues.push({ table, id: isRec(row) && typeof row.id === 'string' ? row.id : null, problem });
  return null;
}

export function parseGroup(row: unknown, issues: DataIssue[]): CurriculumGroup | null {
  if (!isRec(row)) return reject(issues, 'subject_groups', row, 'not an object');
  if (!hasVisibleStatus(row)) return reject(issues, 'subject_groups', row, 'status is not published or retired');
  if (!uuid(row.id) || !str(row.name) || !int(row.sort_order)) return reject(issues, 'subject_groups', row, 'missing or malformed field');
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

export function parseSubject(row: unknown, groups: Map<string, CurriculumGroup>, issues: DataIssue[]): CurriculumSubject | null {
  if (!isRec(row)) return reject(issues, 'subjects', row, 'not an object');
  if (!hasVisibleStatus(row)) return reject(issues, 'subjects', row, 'status is not published or retired');
  if (!uuid(row.id) || !uuid(row.subject_group_id) || !str(row.name) || !str(row.short_name) || !int(row.paper_number) || !int(row.sort_order)) {
    return reject(issues, 'subjects', row, 'missing or malformed field');
  }
  if (!str(row.slug) || !SLUG.test(row.slug)) return reject(issues, 'subjects', row, 'slug is not a valid URL segment');
  const group = groups.get(row.subject_group_id);
  if (!group) return reject(issues, 'subjects', row, 'refers to a group that is not in this curriculum');
  return { id: row.id, slug: row.slug, paperNumber: row.paper_number, name: row.name, shortName: row.short_name, group: group.name, groupId: group.id };
}

export function parseSection(row: unknown, subjects: Map<string, CurriculumSubject>, issues: DataIssue[]): CurriculumSection | null {
  if (!isRec(row)) return reject(issues, 'syllabus_sections', row, 'not an object');
  if (!hasVisibleStatus(row)) return reject(issues, 'syllabus_sections', row, 'status is not published or retired');
  if (!uuid(row.id) || !uuid(row.subject_id) || !str(row.title) || !int(row.sort_order) || !nullableStr(row.official_label) || !(row.parent_section_id === null || uuid(row.parent_section_id))) {
    return reject(issues, 'syllabus_sections', row, 'missing or malformed field');
  }
  if (!subjects.has(row.subject_id)) return reject(issues, 'syllabus_sections', row, 'refers to a subject that is not in this curriculum');
  return { id: row.id, subjectId: row.subject_id, parentId: row.parent_section_id as string | null, officialLabel: row.official_label, title: row.title, sortOrder: row.sort_order };
}

export function parseChapter(row: unknown, subjects: Map<string, CurriculumSubject>, issues: DataIssue[]): CurriculumChapter | null {
  if (!isRec(row)) return reject(issues, 'chapters', row, 'not an object');
  if (!hasVisibleStatus(row)) return reject(issues, 'chapters', row, 'status is not published or retired');
  if (!uuid(row.id) || !uuid(row.subject_id) || !str(row.title) || !int(row.sequence_no) || !nullableStr(row.official_label) || !(row.section_id === null || uuid(row.section_id))) {
    return reject(issues, 'chapters', row, 'missing or malformed field');
  }
  const hours = row.suggested_study_hours;
  if (!(hours === null || (num(hours) && hours > 0))) return reject(issues, 'chapters', row, 'suggested_study_hours is not null or a positive number');
  if (!subjects.has(row.subject_id)) return reject(issues, 'chapters', row, 'refers to a subject that is not in this curriculum');
  return {
    id: row.id, subjectId: row.subject_id, sectionId: row.section_id as string | null, officialLabel: row.official_label, title: row.title,
    order: row.sequence_no, estimatedHours: hours === null ? 0 : hours, retired: row.status === 'retired',
  };
}

export function parseWeightage(row: unknown, known: Set<string>, issues: DataIssue[]): CurriculumWeightage | null {
  if (!isRec(row)) return reject(issues, 'official_weightages', row, 'not an object');
  if (!hasVisibleStatus(row)) return reject(issues, 'official_weightages', row, 'status is not published or retired');
  const level = row.level;
  if (level !== 'subject' && level !== 'section' && level !== 'chapter') return reject(issues, 'official_weightages', row, 'unknown level');
  const target = level === 'subject' ? row.subject_id : level === 'section' ? row.section_id : row.chapter_id;
  const min = typeof row.min_percent === 'string' ? Number(row.min_percent) : row.min_percent;
  const max = typeof row.max_percent === 'string' ? Number(row.max_percent) : row.max_percent;
  if (!uuid(row.id) || !uuid(target) || !num(min) || !num(max) || !str(row.published_label) || min < 0 || max > 100 || min > max) {
    return reject(issues, 'official_weightages', row, 'missing or malformed field');
  }
  if (!known.has(target)) return reject(issues, 'official_weightages', row, 'refers to an item that is not in this curriculum');
  return { id: row.id, level, targetId: target, minPercent: min, maxPercent: max, label: row.published_label };
}

export interface RawCurriculum {
  groups: unknown[];
  subjects: unknown[];
  sections: unknown[];
  chapters: unknown[];
  weightages: unknown[];
}

/** Deterministic official order: groups, then papers within a group, then sections and chapters in their published sequence. */
export function assembleCurriculum(raw: RawCurriculum): { tree: Omit<CurriculumTree, 'identity'>; issues: DataIssue[] } {
  const issues: DataIssue[] = [];
  const groups = raw.groups.map((r) => parseGroup(r, issues)).filter((g): g is CurriculumGroup => g !== null).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const subjectRows = raw.subjects.map((r) => parseSubject(r, groupMap, issues)).filter((s): s is CurriculumSubject => s !== null);
  const groupOrder = new Map(groups.map((g, i) => [g.id, i]));
  const sortOrderOf = new Map<string, number>(raw.subjects.filter(isRec).map((r) => [String(r.id), Number(r.sort_order)]));
  const subjects = subjectRows.sort(
    (a, b) => (groupOrder.get(a.groupId ?? '') ?? 0) - (groupOrder.get(b.groupId ?? '') ?? 0) || (sortOrderOf.get(a.id) ?? 0) - (sortOrderOf.get(b.id) ?? 0) || a.paperNumber - b.paperNumber,
  );
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const subjectIndex = new Map(subjects.map((s, i) => [s.id, i]));
  const sections = raw.sections.map((r) => parseSection(r, subjectMap, issues)).filter((s): s is CurriculumSection => s !== null)
    .sort((a, b) => (subjectIndex.get(a.subjectId) ?? 0) - (subjectIndex.get(b.subjectId) ?? 0) || a.sortOrder - b.sortOrder);
  const chapters = raw.chapters.map((r) => parseChapter(r, subjectMap, issues)).filter((c): c is CurriculumChapter => c !== null)
    .sort((a, b) => (subjectIndex.get(a.subjectId) ?? 0) - (subjectIndex.get(b.subjectId) ?? 0) || a.order - b.order);
  const known = new Set<string>([...subjects.map((s) => s.id), ...sections.map((s) => s.id), ...chapters.map((c) => c.id)]);
  const weightages = raw.weightages.map((r) => parseWeightage(r, known, issues)).filter((w): w is CurriculumWeightage => w !== null);
  return { tree: { groups, subjects, sections, chapters, weightages }, issues };
}

export function parseEnrollmentOption(row: unknown, issues: DataIssue[]): EnrollmentOption | null {
  const table = 'enrollment_options';
  if (!isRec(row)) return reject(issues, table, row, 'not an object');
  const groupsRaw = row.groups;
  const dateStatus = row.date_status;
  const session = row.attempt_session;
  if (
    !uuid(row.course_id) || !str(row.course_name) || !uuid(row.csv_id) || !uuid(row.syllabus_version_id) || !str(row.syllabus_name) || !uuid(row.exam_attempt_id) ||
    !str(row.attempt_label) || !int(row.attempt_year) || (session !== 'june' && session !== 'december') ||
    (dateStatus !== 'unannounced' && dateStatus !== 'provisional' && dateStatus !== 'official') || !nullableStr(row.exam_start_date) || !nullableStr(row.exam_end_date) ||
    !Array.isArray(groupsRaw)
  ) {
    return reject(issues, table, row, 'missing or malformed field');
  }
  const groups = groupsRaw.filter((g): g is { id: string; name: string } => isRec(g) && uuid(g.id) && str(g.name)).map((g) => ({ id: g.id, name: g.name }));
  // An option with no group cannot be enrolled in, and a date status that claims a date the row does not have is not believed.
  if (groups.length === 0) return reject(issues, table, row, 'offers no published group');
  if (dateStatus !== 'unannounced' && row.exam_start_date === null) return reject(issues, table, row, 'date status claims a date that is missing');
  return {
    courseId: row.course_id, courseName: row.course_name, courseOrder: int(row.course_order) ? row.course_order : 0, csvId: row.csv_id,
    syllabusVersionId: row.syllabus_version_id, syllabusName: row.syllabus_name, attemptId: row.exam_attempt_id, attemptLabel: row.attempt_label,
    attemptYear: row.attempt_year, attemptSession: session, examStartDate: row.exam_start_date, examEndDate: row.exam_end_date, dateStatus, groups,
  };
}

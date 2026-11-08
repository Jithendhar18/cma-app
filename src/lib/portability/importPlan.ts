import type { CurriculumTree } from '@/lib/curriculum/types';
import { same } from '@/lib/sync/diff';
import { snapshotToEntities, validateEntity } from '@/lib/sync/mappers';
import { entityId, isSingle, type Entity, type ServerEntity, type Table } from '@/lib/sync/types';
import type { Chapter, StudyDataSnapshot } from '@/types/study';

/**
 * The plan for an explicit, user-started import of local-mode study data into one account enrolment. Pure: no network, no storage.
 *
 * Identity rules (the point of this file):
 *   - A local chapter or subject reaches an account chapter or subject in exactly two ways: its id IS an id of the destination curriculum, or the
 *     student chose the destination for it. Never by position, order, or similarity of names.
 *   - Anything that cannot be resolved is listed as needing attention, never dropped and never guessed. The import is blocked until each one is
 *     resolved or explicitly excluded by the student.
 *   - Retired destination chapters are refused; sample (`demo`) records are never importable.
 */

export type ImportTable = Exclude<Table, 'profiles' | 'user_settings' | 'student_enrollments'>;
export const IMPORT_TABLES: ImportTable[] = ['chapter_progress', 'planner_sessions', 'study_sessions', 'revisions', 'practice_records', 'mock_tests'];
export const TABLE_LABEL: Record<ImportTable, string> = {
  chapter_progress: 'Chapter progress', planner_sessions: 'Planned sessions', study_sessions: 'Focus time', revisions: 'Revisions', practice_records: 'Practice records', mock_tests: 'Mock tests',
};

export interface ImportMapping {
  /** local chapter id -> destination chapter id, chosen by the student */
  chapters: Record<string, string>;
  /** local subject id -> destination subject id, chosen by the student (only needed for mock tests) */
  subjects: Record<string, string>;
}
export interface ImportExclusions {
  chapters: string[];
  subjects: string[];
}
export const EMPTY_MAPPING: ImportMapping = { chapters: {}, subjects: {} };
export const NO_EXCLUSIONS: ImportExclusions = { chapters: [], subjects: [] };

export type Reason = 'sample-data' | 'excluded-by-you' | 'unmatched-chapter' | 'unmatched-subject' | 'destination-retired' | 'invalid' | 'duplicate-id';

export interface Unresolved {
  kind: 'chapter' | 'subject';
  localId: string;
  label: string;
  /** How many records of each kind depend on it. */
  counts: Partial<Record<ImportTable, number>>;
  /** Set when the student chose a destination that cannot be used. */
  problem: string | null;
}

export interface CategoryCounts {
  /** Real (non-sample) records on this device in this category. */
  local: number;
  ready: number;
  /** Already in the account with the same content. */
  present: number;
  /** In the account with different content: the account's version is kept (server wins). */
  differs: number;
  attention: number;
  excluded: number;
}

export interface PlanIssue { table: ImportTable; key: string; reason: Reason; detail: string }

export interface ImportPlan {
  categories: Record<ImportTable, CategoryCounts>;
  /** Exactly what will be written. */
  ready: Entity[];
  /** What the account already has (same content), plus what will be written: the payload the run is recorded against. */
  payload: Entity[];
  unresolved: Unresolved[];
  issues: PlanIssue[];
  /** Planned sessions that were not importable, so a focus record's link to one was dropped (the record itself is imported). */
  droppedLinks: number;
  /** True when nothing needs the student's attention (every record is ready, present, differs-and-kept, or excluded on purpose). */
  canImport: boolean;
  /** True when there is nothing new to write. */
  nothingToDo: boolean;
}

const emptyCounts = (): CategoryCounts => ({ local: 0, ready: 0, present: 0, differs: 0, attention: 0, excluded: 0 });
const isDefaultProgress = (c: Chapter) => c.status === 'not_started' && c.confidence === 1 && c.notes === '' && (c.completedOn ?? null) === null;

export interface PlanInput {
  local: StudyDataSnapshot;
  destination: Pick<CurriculumTree, 'subjects' | 'chapters'>;
  mapping: ImportMapping;
  excluded: ImportExclusions;
  /** The account's current rows for this enrolment. */
  existing: ServerEntity[];
  /** Names of local subjects, for display only (never used to match anything). */
  localSubjectNames?: ReadonlyMap<string, string>;
}

export function buildImportPlan(input: PlanInput): ImportPlan {
  const { local, destination, mapping, excluded } = input;
  const destChapters = new Map(destination.chapters.map((c) => [c.id, c]));
  const destSubjects = new Map(destination.subjects.map((s) => [s.id, s]));
  const existing = new Map(input.existing.map((e) => [entityId(e.table, e.key), e]));
  const excludedChapters = new Set(excluded.chapters);
  const excludedSubjects = new Set(excluded.subjects);

  const categories = Object.fromEntries(IMPORT_TABLES.map((t) => [t, emptyCounts()])) as Record<ImportTable, CategoryCounts>;
  const issues: PlanIssue[] = [];
  const unresolved = new Map<string, Unresolved>();
  const localChapterTitle = new Map(local.chapters.map((c) => [c.id, c.title]));
  const localSubjectName = input.localSubjectNames ?? new Map<string, string>();

  const note = (table: ImportTable, key: string, reason: Reason, detail: string) => issues.push({ table, key, reason, detail });
  const need = (kind: 'chapter' | 'subject', localId: string, label: string, table: ImportTable, problem: string | null) => {
    const k = `${kind}:${localId}`;
    const u = unresolved.get(k) ?? { kind, localId, label, counts: {}, problem };
    u.counts[table] = (u.counts[table] ?? 0) + 1;
    unresolved.set(k, u);
  };

  /** local chapter id -> { chapter } | { problem } | { excluded } */
  const chapterTarget = (localId: string): { chapter: { id: string; subjectId: string } } | { excluded: true } | { unresolved: string | null } => {
    if (excludedChapters.has(localId)) return { excluded: true };
    const chosen = mapping.chapters[localId];
    const id = chosen ?? (destChapters.has(localId) ? localId : undefined); // exact id match only, never anything fuzzier
    if (id === undefined) return { unresolved: null };
    const target = destChapters.get(id);
    if (!target) return { unresolved: 'That chapter is not in your course.' };
    if (target.retired) return { unresolved: 'That chapter is retired and cannot receive new records.' };
    return { chapter: { id: target.id, subjectId: target.subjectId } };
  };
  const subjectTarget = (localId: string): { subject: string } | { excluded: true } | { unresolved: string | null } => {
    if (excludedSubjects.has(localId)) return { excluded: true };
    const chosen = mapping.subjects[localId];
    const id = chosen ?? (destSubjects.has(localId) ? localId : undefined);
    if (id === undefined) return { unresolved: null };
    return destSubjects.has(id) ? { subject: id } : { unresolved: 'That subject is not in your course.' };
  };


  // ---- build the remapped, sample-free snapshot that the existing mappers turn into entities ----------------------------------
  const chapters: Chapter[] = [];
  const resolveChapterFor = (table: ImportTable, key: string, localChapterId: string): { id: string; subjectId: string } | null => {
    const t = chapterTarget(localChapterId);
    if ('chapter' in t) return t.chapter;
    categories[table].local++;
    if ('excluded' in t) { categories[table].excluded++; note(table, key, 'excluded-by-you', 'You chose not to import this chapter.'); return null; }
    categories[table].attention++;
    need('chapter', localChapterId, localChapterTitle.get(localChapterId) ?? localChapterId, table, t.unresolved);
    note(table, key, t.unresolved ? 'destination-retired' : 'unmatched-chapter', t.unresolved ?? 'No matching chapter in your course.');
    return null;
  };
  // `local` counts are bumped on the success path below for resolved ones; the helper bumps them for the unresolved/excluded.
  const countLocal = (table: ImportTable) => { categories[table].local++; };

  // chapter progress
  const progressTargets = new Map<string, string>();
  for (const c of local.chapters) {
    if (isDefaultProgress(c)) continue;
    if (c.demo === true) continue; // untouched sample progress: not the student's data, not even counted
    const t = resolveChapterFor('chapter_progress', c.id, c.id);
    if (!t) continue;
    countLocal('chapter_progress');
    // Two local chapters landing on one destination chapter would silently merge (one would overwrite the other): never allowed.
    const taken = progressTargets.get(t.id);
    if (taken !== undefined) { categories.chapter_progress.attention++; note('chapter_progress', c.id, 'duplicate-id', 'Two of your chapters were matched to the same chapter in your course.'); continue; }
    progressTargets.set(t.id, c.id);
    chapters.push({ ...c, id: t.id, subjectId: t.subjectId });
  }
  const sessions: StudyDataSnapshot['sessions'] = [];
  for (const s of local.sessions) {
    if (s.demo === true) { note('planner_sessions', s.id, 'sample-data', 'Sample data'); continue; }
    const t = resolveChapterFor('planner_sessions', s.id, s.chapterId);
    if (!t) continue;
    countLocal('planner_sessions');
    sessions.push({ ...s, chapterId: t.id, subjectId: t.subjectId });
  }
  const sessionIds = new Set(sessions.map((s) => s.id));
  const focusLog: StudyDataSnapshot['focusLog'] = [];
  let droppedLinks = 0;
  for (const f of local.focusLog) {
    if (f.demo === true) { note('study_sessions', f.id, 'sample-data', 'Sample data'); continue; }
    const t = resolveChapterFor('study_sessions', f.id, f.chapterId);
    if (!t) continue;
    countLocal('study_sessions');
    // The planned-session link is kept only if that session is part of this import; the record itself is never lost for want of it.
    const linked = f.sessionId !== null && sessionIds.has(f.sessionId);
    if (f.sessionId !== null && !linked) droppedLinks++;
    focusLog.push({ ...f, chapterId: t.id, subjectId: t.subjectId, sessionId: linked ? f.sessionId : null });
  }
  const revisions: StudyDataSnapshot['revisions'] = [];
  for (const r of local.revisions) {
    if (r.demo === true) { note('revisions', r.id, 'sample-data', 'Sample data'); continue; }
    const t = resolveChapterFor('revisions', r.id, r.chapterId);
    if (!t) continue;
    countLocal('revisions');
    revisions.push({ ...r, chapterId: t.id });
  }
  const practiceLog: StudyDataSnapshot['practiceLog'] = [];
  for (const p of local.practiceLog) {
    if (p.demo === true) { note('practice_records', p.id, 'sample-data', 'Sample data'); continue; }
    const t = resolveChapterFor('practice_records', p.id, p.chapterId);
    if (!t) continue;
    countLocal('practice_records');
    practiceLog.push({ ...p, chapterId: t.id, subjectId: t.subjectId });
  }
  const mockExams: StudyDataSnapshot['mockExams'] = [];
  for (const m of local.mockExams) {
    if (m.demo === true) { note('mock_tests', m.id, 'sample-data', 'Sample data'); continue; }
    const t = subjectTarget(m.subjectId);
    if (!('subject' in t)) {
      countLocal('mock_tests');
      if ('excluded' in t) { categories.mock_tests.excluded++; note('mock_tests', m.id, 'excluded-by-you', 'You chose not to import this subject.'); continue; }
      categories.mock_tests.attention++;
      const name = localSubjectName.get(m.subjectId) ?? m.subjectId;
      need('subject', m.subjectId, name, 'mock_tests', t.unresolved);
      note('mock_tests', m.id, 'unmatched-subject', t.unresolved ?? 'No matching subject in your course.');
      continue;
    }
    countLocal('mock_tests');
    mockExams.push({ ...m, subjectId: t.subject });
  }

  const remapped: StudyDataSnapshot = { ...local, chapters, sessions, revisions, focusLog, mockExams, practiceLog };
  const entities = [...snapshotToEntities(remapped).values()].filter((e) => !isSingle(e.table));

  // Two different local records can never share a destination key: a collision would silently drop one.
  const seenKeys = new Set<string>();
  const ready: Entity[] = [];
  const payload: Entity[] = [];
  for (const e of entities) {
    const table = e.table as ImportTable;
    const id = entityId(e.table, e.key);
    if (seenKeys.has(id)) { categories[table].attention++; note(table, e.key, 'duplicate-id', 'Two records would land on the same account record.'); continue; }
    seenKeys.add(id);
    const problem = validateEntity(e);
    if (problem) { categories[table].attention++; note(table, e.key, 'invalid', problem); continue; }
    const have = existing.get(id);
    if (!have) { categories[table].ready++; ready.push(e); payload.push(e); continue; }
    if (same(have.row, e.row)) categories[table].present++;
    else categories[table].differs++;
    payload.push(e);
  }
  // `local` for categories above counted records, not entities; chapters with default progress are not records, so it already matches.

  const attention = IMPORT_TABLES.reduce((n, t) => n + categories[t].attention, 0);
  return {
    categories, ready, payload, unresolved: [...unresolved.values()], issues, droppedLinks,
    canImport: attention === 0 && unresolved.size === 0,
    nothingToDo: ready.length === 0,
  };
}

/** SHA-256 (hex) of the canonical payload of an import: the same approved data always has the same fingerprint, a different selection another. */
export async function fingerprint(payload: Entity[]): Promise<string> {
  const sorted = [...payload].sort((a, b) => entityId(a.table, a.key).localeCompare(entityId(b.table, b.key)));
  const text = JSON.stringify(sorted.map((e) => [e.table, e.key, Object.entries(e.row).sort(([x], [y]) => x.localeCompare(y))]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Which local chapters have importable data, with what, so the student can match them. Sample-only chapters are not listed. */
export function localChaptersWithData(local: StudyDataSnapshot): Array<{ id: string; title: string; subjectId: string; counts: Partial<Record<ImportTable, number>> }> {
  const out = new Map<string, { id: string; title: string; subjectId: string; counts: Partial<Record<ImportTable, number>> }>();
  const bump = (id: string, table: ImportTable) => {
    const c = local.chapters.find((x) => x.id === id);
    const row = out.get(id) ?? { id, title: c?.title ?? id, subjectId: c?.subjectId ?? '', counts: {} };
    row.counts[table] = (row.counts[table] ?? 0) + 1;
    out.set(id, row);
  };
  for (const c of local.chapters) if (!isDefaultProgress(c) && c.demo !== true) bump(c.id, 'chapter_progress');
  for (const s of local.sessions) if (s.demo !== true) bump(s.chapterId, 'planner_sessions');
  for (const f of local.focusLog) if (f.demo !== true) bump(f.chapterId, 'study_sessions');
  for (const r of local.revisions) if (r.demo !== true) bump(r.chapterId, 'revisions');
  for (const p of local.practiceLog) if (p.demo !== true) bump(p.chapterId, 'practice_records');
  return [...out.values()];
}

export function localSubjectsWithMocks(local: StudyDataSnapshot): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of local.mockExams) if (m.demo !== true) counts.set(m.subjectId, (counts.get(m.subjectId) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count }));
}

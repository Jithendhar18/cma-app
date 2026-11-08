import type { CurriculumTree } from '@/lib/curriculum/types';
import type { StudyDataSnapshot } from '@/types/study';
import { buildAccountChapters, buildAccountSnapshot, parseAccountSnapshot, type AccountSnapshotInput } from './accountSnapshot';
import { accountKeys } from './keys';

/**
 * The per-user local mirror: the last known account state, kept so the app starts instantly and keeps working offline. It belongs to ONE
 * enrolment of ONE syllabus (its scope), and a mirror is never reused for another.
 */
export interface MirrorScope {
  enrollmentId: string;
  csvId: string;
}

export function readScope(userId: string, storage: Storage = localStorage): MirrorScope | null {
  try {
    const raw = storage.getItem(accountKeys(userId).meta);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scope?: Partial<MirrorScope> };
    return typeof parsed.scope?.enrollmentId === 'string' && typeof parsed.scope.csvId === 'string' ? { enrollmentId: parsed.scope.enrollmentId, csvId: parsed.scope.csvId } : null;
  } catch {
    return null;
  }
}

/** Updates only the scope, preserving any other sync metadata kept in the same entry. */
export function writeScope(userId: string, scope: MirrorScope, storage: Storage = localStorage): void {
  const key = accountKeys(userId).meta;
  try {
    const current = JSON.parse(storage.getItem(key) ?? '{}') as Record<string, unknown>;
    storage.setItem(key, JSON.stringify({ ...current, scope }));
  } catch {
    /* the mirror still works for this session */
  }
}

export function readMirror(userId: string, storage: Storage = localStorage): StudyDataSnapshot | null {
  try {
    const raw = storage.getItem(accountKeys(userId).study);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: unknown };
    const result = parseAccountSnapshot(parsed.state);
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

/** The mirror for this exact scope, or null. A mirror recorded for a different enrolment or syllabus is NEVER returned. */
export function readScopedMirror(userId: string, scope: MirrorScope, storage: Storage = localStorage): StudyDataSnapshot | null {
  const recorded = readScope(userId, storage);
  if (!recorded || recorded.enrollmentId !== scope.enrollmentId || recorded.csvId !== scope.csvId) return null;
  return readMirror(userId, storage);
}

/**
 * The snapshot to put in the stores when account mode starts: the mirror if there is one for this scope, with its chapter list rebuilt
 * from the CURRENT curriculum (so a curriculum update appears), else an empty account snapshot. Never contains demo data.
 */
export function buildEntrySnapshot(input: AccountSnapshotInput & { curriculum: CurriculumTree }, mirror: StudyDataSnapshot | null): StudyDataSnapshot {
  if (!mirror) return buildAccountSnapshot(input);
  const progress = new Map(mirror.chapters.map((c) => [c.id, c]));
  return { ...mirror, chapters: buildAccountChapters(input.curriculum, progress), meta: { seedAnchor: null } };
}

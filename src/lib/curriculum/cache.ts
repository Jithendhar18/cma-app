import type { CurriculumTree } from './types';
import { assembleCurriculum } from './validate';

/**
 * A long-lived, validated cache of ONE syllabus's curriculum. Account curriculum is shared data that changes rarely, so the app shows
 * the cached copy at once and refreshes it in the background.
 *
 * The key contains the `csv_id`, and an entry is only ever returned for exactly that `csv_id`, so one syllabus's curriculum can never be
 * served for another. A cached entry is re-validated on read; anything that no longer validates is discarded, never half-used.
 */
export const CACHE_PREFIX = 'cma-curriculum-cache:';
const VERSION = 1;

export interface CacheEntry {
  identity: string;
  savedAt: string;
  tree: CurriculumTree;
}

/** A short deterministic fingerprint of the curriculum content (not a security hash). Changes whenever any curriculum field changes. */
export function curriculumIdentity(tree: Omit<CurriculumTree, 'identity'>): string {
  const text = JSON.stringify([tree.groups, tree.subjects, tree.sections, tree.chapters, tree.weightages]);
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}:${tree.chapters.length}`;
}

const keyFor = (csvId: string) => `${CACHE_PREFIX}${csvId}`;

export function readCurriculumCache(csvId: string, storage: Storage = localStorage): CacheEntry | null {
  try {
    const raw = storage.getItem(keyFor(csvId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; csvId?: string; identity?: string; savedAt?: string; tree?: CurriculumTree };
    if (parsed.v !== VERSION || parsed.csvId !== csvId || typeof parsed.identity !== 'string' || !parsed.tree) return null;
    if (parsed.tree.identity?.csvId !== csvId) return null; // an entry for a different syllabus is never used
    // Re-validate by round-tripping the stored view-model through the same rules the network data passes.
    const { identity: _identity, ...content } = parsed.tree;
    void _identity;
    const reassembled = assembleCurriculum({
      groups: content.groups.map((g) => ({ id: g.id, name: g.name, sort_order: g.sortOrder, status: 'published' })),
      subjects: content.subjects.map((s) => ({ id: s.id, subject_group_id: s.groupId, slug: s.slug, paper_number: s.paperNumber, name: s.name, short_name: s.shortName, sort_order: content.subjects.indexOf(s) + 1, status: 'published' })),
      sections: content.sections.map((s) => ({ id: s.id, subject_id: s.subjectId, parent_section_id: s.parentId, official_label: s.officialLabel, title: s.title, sort_order: s.sortOrder, status: 'published' })),
      chapters: content.chapters.map((c) => ({ id: c.id, subject_id: c.subjectId, section_id: c.sectionId, official_label: c.officialLabel, title: c.title, sequence_no: c.order, suggested_study_hours: c.estimatedHours > 0 ? c.estimatedHours : null, status: c.retired ? 'retired' : 'published' })),
      weightages: content.weightages.map((w) => ({ id: w.id, level: w.level, subject_id: w.level === 'subject' ? w.targetId : null, section_id: w.level === 'section' ? w.targetId : null, chapter_id: w.level === 'chapter' ? w.targetId : null, min_percent: w.minPercent, max_percent: w.maxPercent, published_label: w.label, status: 'published' })),
    });
    if (reassembled.issues.length > 0) return null;
    if (curriculumIdentity(reassembled.tree) !== parsed.identity) return null; // content no longer matches what was stored
    return { identity: parsed.identity, savedAt: parsed.savedAt ?? '', tree: parsed.tree };
  } catch {
    return null;
  }
}

export function writeCurriculumCache(csvId: string, tree: CurriculumTree, storage: Storage = localStorage): CacheEntry | null {
  if (tree.identity.csvId !== csvId) return null;
  const { identity: _identity, ...content } = tree;
  void _identity;
  const entry: CacheEntry = { identity: curriculumIdentity(content), savedAt: new Date().toISOString(), tree };
  try {
    storage.setItem(keyFor(csvId), JSON.stringify({ v: VERSION, csvId, ...entry }));
    return entry;
  } catch {
    return null; // storage full or blocked: the app works without a cache
  }
}

export function clearCurriculumCache(csvId: string, storage: Storage = localStorage): void {
  try {
    storage.removeItem(keyFor(csvId));
  } catch {
    /* ignore */
  }
}

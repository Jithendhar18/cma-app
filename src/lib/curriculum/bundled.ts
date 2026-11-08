import { CHAPTER_SEEDS, SUBJECTS } from '@/data/subjects';
import type { CurriculumChapter, CurriculumGroup, CurriculumSubject, CurriculumTree } from './types';

/**
 * The local-mode curriculum: today's bundled sample (`src/data/subjects.ts`), unchanged. Subject ids stay 'p5'..'p12' and chapter ids
 * stay `p5-1`.. so every existing local record keeps pointing at the same thing. This is NOT the official syllabus.
 */
export function buildBundledCurriculum(): CurriculumTree {
  const groupNames = Array.from(new Set(SUBJECTS.map((s) => s.group)));
  const groups: CurriculumGroup[] = groupNames.map((name, i) => ({ id: name, name, sortOrder: i + 1 }));
  const subjects: CurriculumSubject[] = SUBJECTS.map((s) => ({ ...s, slug: s.id, groupId: s.group }));
  const chapters: CurriculumChapter[] = SUBJECTS.flatMap((s) =>
    (CHAPTER_SEEDS[s.id] ?? []).map((seed, i) => ({
      id: `${s.id}-${i + 1}`,
      subjectId: s.id,
      sectionId: null,
      officialLabel: null,
      title: seed[0],
      order: i + 1,
      estimatedHours: seed[1],
      retired: false,
    })),
  );
  return { identity: { source: 'bundled', csvId: null, courseName: null, syllabusName: null }, groups, subjects, sections: [], chapters, weightages: [] };
}

/** One shared instance: the bundled data never changes, so every consumer sees the same objects. */
export const BUNDLED_CURRICULUM: CurriculumTree = buildBundledCurriculum();

import { SUBJECTS } from '@/data/subjects';
import { isChapterDone, subjectStats } from '@/lib/analytics';
import type { Chapter, RevisionTask } from '@/types/study';

export function overallCompletion(chapters: Chapter[]): number {
  if (chapters.length === 0) return 0;
  return (chapters.filter(isChapterDone).length / chapters.length) * 100;
}

export function groupCompletion(group: 'Group I' | 'Group II', chapters: Chapter[], revisions: RevisionTask[]) {
  const ids = SUBJECTS.filter((s) => s.group === group).map((s) => s.id);
  const own = chapters.filter((c) => ids.includes(c.subjectId));
  const stats = ids.map((id) => subjectStats(id, chapters, revisions));
  return {
    pct: overallCompletion(own),
    done: own.filter(isChapterDone).length,
    total: own.length,
    hours: stats.reduce((s, x) => s + x.actualHours, 0),
  };
}

export const REVISION_LABEL = (n: RevisionTask['revisionNumber']) => (n === 'final' ? 'Final revision' : `Revision ${n}`);

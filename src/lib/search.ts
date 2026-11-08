import { NAV_ITEMS } from '@/app/navigation';
import { BUNDLED_CURRICULUM } from '@/lib/curriculum/bundled';
import { flattenDocuments } from '@/data/library';
import { formatShortDate } from '@/lib/dates';
import { formatTime12h } from '@/lib/dates';
import type { LibrarySource } from '@/types/library';
import type { StudyDataSnapshot, Subject } from '@/types/study';

export type SearchKind = 'Page' | 'Subject' | 'Chapter' | 'Session' | 'Revision' | 'Resource';

export interface SearchItem {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  to: string;
}

export function buildSearchIndex(data: StudyDataSnapshot, library: LibrarySource[], subjects: Subject[] = BUNDLED_CURRICULUM.subjects): SearchItem[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.shortName]));
  const subjectSlug = new Map(subjects.map((s) => [s.id, s.slug ?? s.id]));
  const chapterById = new Map(data.chapters.map((c) => [c.id, c]));

  const pages = NAV_ITEMS.map<SearchItem>((n) => ({ id: `page-${n.path}`, kind: 'Page', title: n.label, subtitle: n.section, to: n.path }));
  const subjectItems = subjects.map<SearchItem>((s) => ({
    id: `subject-${s.id}`,
    kind: 'Subject',
    title: `Paper ${s.paperNumber} — ${s.name}`,
    subtitle: s.group,
    to: `/subjects/${s.slug ?? s.id}`,
  }));
  const chapters = data.chapters.map<SearchItem>((c) => ({
    id: `chapter-${c.id}`,
    kind: 'Chapter',
    title: c.title,
    subtitle: subjectName.get(c.subjectId) ?? '',
    to: `/subjects/${subjectSlug.get(c.subjectId) ?? c.subjectId}?tab=chapters&chapter=${c.id}`,
  }));
  const sessions = data.sessions.map<SearchItem>((s) => ({
    id: `session-${s.id}`,
    kind: 'Session',
    title: `${chapterById.get(s.chapterId)?.title ?? 'Study session'}`,
    subtitle: `${formatShortDate(s.date)} · ${formatTime12h(s.startTime)}`,
    to: `/planner?date=${s.date}`,
  }));
  const revisions = data.revisions
    .filter((r) => !r.completedOn && !r.cancelledOn)
    .map<SearchItem>((r) => ({
      id: `revision-${r.id}`,
      kind: 'Revision',
      title: `Revision ${r.revisionNumber === 'final' ? '(final)' : r.revisionNumber}: ${chapterById.get(r.chapterId)?.title ?? ''}`,
      subtitle: `Due ${formatShortDate(r.dueDate)}`,
      to: '/revisions',
    }));
  const resources = library.flatMap((source) =>
    flattenDocuments(source.nodes).map<SearchItem>(({ doc }) => ({
      id: `resource-${doc.id}`,
      kind: 'Resource',
      title: doc.title,
      subtitle: `${source.label} (demo)`,
      to: `/library?source=${source.id}&q=${encodeURIComponent(doc.title)}`,
    })),
  );
  return [...pages, ...subjectItems, ...chapters, ...sessions, ...revisions, ...resources];
}

export function searchItems(items: SearchItem[], query: string, limit = 30): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((i) => i.kind === 'Page' || i.kind === 'Subject').slice(0, limit);
  const tokens = q.split(/\s+/);
  return items
    .map((item) => {
      const hay = `${item.title} ${item.subtitle}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
      const score = item.title.toLowerCase().startsWith(q) ? 0 : item.title.toLowerCase().includes(q) ? 1 : 2;
      return { item, score };
    })
    .filter((x): x is { item: SearchItem; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.item);
}

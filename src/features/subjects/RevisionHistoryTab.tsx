import { History } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatShortDate } from '@/lib/dates';
import { REVISION_LABEL } from '@/lib/selectors';
import { useStudyStore } from '@/stores/studyStore';
import type { Subject } from '@/types/study';

export function RevisionHistoryTab({ subject }: { subject: Subject }) {
  const chapters = useStudyStore((s) => s.chapters).filter((c) => c.subjectId === subject.id);
  const ids = new Set(chapters.map((c) => c.id));
  const revisions = useStudyStore((s) => s.revisions)
    .filter((r) => ids.has(r.chapterId))
    .sort((a, b) => (b.completedOn ?? b.dueDate).localeCompare(a.completedOn ?? a.dueDate));

  return (
    <Card>
      {revisions.length === 0 ? (
        <EmptyState icon={History} title="No revisions yet" description="Revisions are scheduled automatically once a chapter is marked Completed." />
      ) : (
        <ul className="divide-y">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{chapters.find((c) => c.id === r.chapterId)?.title}</p>
                <p className="text-[12px] text-ink-3">{REVISION_LABEL(r.revisionNumber)} · due {formatShortDate(r.dueDate)}</p>
              </div>
              {r.completedOn ? <Badge tone="emerald">Done {formatShortDate(r.completedOn)}</Badge> : <Badge tone="amber">Pending</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

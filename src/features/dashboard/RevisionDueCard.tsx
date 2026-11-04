import { Link } from 'react-router-dom';
import { Check, PartyPopper } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PRIORITY_ORDER, revisionBucket } from '@/lib/analytics';
import { formatShortDate, todayISO } from '@/lib/dates';
import { REVISION_LABEL } from '@/lib/selectors';
import { PRIORITY_META } from '@/lib/statusMeta';
import { useStudyStore } from '@/stores/studyStore';

export function RevisionDueCard() {
  const today = todayISO();
  const revisions = useStudyStore((s) => s.revisions);
  const chapters = useStudyStore((s) => s.chapters);
  const complete = useStudyStore((s) => s.completeRevision);

  const due = revisions
    .filter((r) => ['overdue', 'today'].includes(revisionBucket(r, today)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const overdue = due.filter((r) => r.dueDate < today).length;

  return (
    <Card>
      <CardHeader
        title="Revision due"
        description={overdue > 0 ? `${overdue} overdue` : 'Due today'}
        action={<Link to="/revisions" className="text-[12px] font-medium text-violet-500 hover:underline">View all</Link>}
      />
      {due.length === 0 ? (
        <EmptyState icon={PartyPopper} title="All caught up" description="No revisions are due or overdue." className="py-8" />
      ) : (
        <ul className="divide-y">
          {due.slice(0, 5).map((r) => {
            const chapter = chapters.find((c) => c.id === r.chapterId);
            const isOverdue = r.dueDate < today;
            return (
              <li key={r.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{chapter?.title}</p>
                  <p className="text-[12px] text-ink-3">
                    {REVISION_LABEL(r.revisionNumber)} · {isOverdue ? `Overdue since ${formatShortDate(r.dueDate)}` : 'Today'}
                  </p>
                </div>
                <Badge tone={PRIORITY_META[r.priority].tone}>{PRIORITY_META[r.priority].label}</Badge>
                <Button size="icon" variant="secondary" onClick={() => complete(r.id)} aria-label={`Mark ${chapter?.title} revision complete`} icon={<Check className="size-4" />} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

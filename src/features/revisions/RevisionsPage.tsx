import { useMemo, useState } from 'react';
import { CalendarClock, Check } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { fieldClass } from '@/components/ui/field';
import { SUBJECTS } from '@/data/subjects';
import { PRIORITY_ORDER, revisionBucket, type RevisionBucket } from '@/lib/analytics';
import { addDaysISO, formatShortDate, todayISO } from '@/lib/dates';
import { REVISION_LABEL } from '@/lib/selectors';
import { PRIORITY_META } from '@/lib/statusMeta';
import { useStudyStore } from '@/stores/studyStore';
import type { RevisionTask } from '@/types/study';

const TABS: Array<{ id: RevisionBucket; label: string }> = [
  { id: 'today', label: 'Due today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
];

export default function RevisionsPage() {
  const today = todayISO();
  const revisions = useStudyStore((s) => s.revisions);
  const chapters = useStudyStore((s) => s.chapters);
  const [tab, setTab] = useState<RevisionBucket>('today');

  const grouped = useMemo(() => {
    const map: Record<RevisionBucket, RevisionTask[]> = { today: [], overdue: [], upcoming: [], completed: [] };
    revisions.forEach((r) => map[revisionBucket(r, today)].push(r));
    (Object.keys(map) as RevisionBucket[]).forEach((k) =>
      map[k].sort((a, b) => (k === 'completed' ? (b.completedOn ?? '').localeCompare(a.completedOn ?? '') : a.dueDate.localeCompare(b.dueDate) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])),
    );
    return map;
  }, [revisions, today]);

  const list = grouped[tab];

  return (
    <div className="space-y-6">
      <PageHeader title="Revision Centre" subtitle="Spaced revision: 1 day, then +7 days, then +21 days, then a final pre-exam pass." />
      <Tabs label="Revision status" tabs={TABS.map((t) => ({ ...t, count: grouped[t.id].length }))} active={tab} onChange={setTab} />
      <Card>
        {list.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Nothing here" description={tab === 'completed' ? 'Completed revisions will appear here.' : 'No revisions in this group.'} />
        ) : (
          <ul className="divide-y">
            {list.map((r) => (
              <RevisionRow key={r.id} task={r} title={chapters.find((c) => c.id === r.chapterId)?.title ?? ''} subject={SUBJECTS.find((s) => s.id === chapters.find((c) => c.id === r.chapterId)?.subjectId)?.shortName ?? ''} today={today} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RevisionRow({ task, title, subject, today }: { task: RevisionTask; title: string; subject: string; today: string }) {
  const complete = useStudyStore((s) => s.completeRevision);
  const reschedule = useStudyStore((s) => s.rescheduleRevision);
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(task.dueDate);
  const done = Boolean(task.completedOn);

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-[13px] font-medium text-ink">{title}</p>
        <p className="text-[12px] text-ink-3">
          {subject} · {REVISION_LABEL(task.revisionNumber)} · {done ? `Done ${formatShortDate(task.completedOn!)}` : `Due ${formatShortDate(task.dueDate)}`}
        </p>
      </div>
      <Badge tone={PRIORITY_META[task.priority].tone}>{PRIORITY_META[task.priority].label}</Badge>
      {!done && (
        <div className="flex items-center gap-2">
          {picking ? (
            <>
              <input type="date" aria-label="New due date" min={today} className={`${fieldClass} !w-36`} value={date} onChange={(e) => setDate(e.target.value)} />
              <Button size="sm" variant="primary" disabled={!date} onClick={() => { reschedule(task.id, date); setPicking(false); }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => { reschedule(task.id, addDaysISO(today, 1)); }}>Tomorrow</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>Reschedule</Button>
              <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => complete(task.id)}>Complete</Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

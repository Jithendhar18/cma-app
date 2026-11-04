import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SUBJECTS } from '@/data/subjects';
import { subjectStats } from '@/lib/analytics';
import { formatPercent } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';

export function SubjectProgressGrid() {
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);
  const rows = useMemo(
    () =>
      SUBJECTS.map((subject) => ({
        subject,
        stats: subjectStats(subject.id, chapters, revisions),
        weak: chapters.filter((c) => c.subjectId === subject.id && c.status !== 'not_started' && c.confidence <= 2).length,
      })),
    [chapters, revisions],
  );

  return (
    <section aria-label="Subject progress">
      <CardHeader title="Subject progress" description="All eight papers across both groups" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {rows.map(({ subject, stats, weak }) => (
          <Card key={subject.id} className="flex flex-col !p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-ink-3">Paper {subject.paperNumber} · {subject.group}</p>
                <h3 className="mt-0.5 line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-[18px] text-ink">{subject.name}</h3>
              </div>
              <span className="text-[15px] font-semibold text-ink">{formatPercent(stats.completionPct)}</span>
            </div>
            <ProgressBar className="mt-3" value={stats.completionPct} label={`${subject.shortName} progress`} color={weak > 1 ? 'bg-amber-500' : 'bg-violet-500'} />
            <div className="mt-3 flex items-center justify-between text-[12px] text-ink-2">
              <span>{stats.done}/{stats.total} chapters</span>
              {weak > 0 ? (
                <Badge tone="amber"><AlertTriangle className="size-3" />{weak} weak</Badge>
              ) : (
                <Badge tone="emerald">On track</Badge>
              )}
            </div>
            <Link to={`/subjects/${subject.id}`} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-violet-500 hover:underline">
              Continue <ArrowRight className="size-3.5" />
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}

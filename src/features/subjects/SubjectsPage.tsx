import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Tabs } from '@/components/ui/Tabs';
import { SUBJECTS } from '@/data/subjects';
import { subjectStats } from '@/lib/analytics';
import { formatHours, formatPercent } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';

const TABS = [
  { id: 'all', label: 'All papers' },
  { id: 'g1', label: 'Group I' },
  { id: 'g2', label: 'Group II' },
] as const;
type GroupTab = (typeof TABS)[number]['id'];

export default function SubjectsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('group'))?.id ?? 'all') as GroupTab;
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);

  const rows = useMemo(
    () =>
      SUBJECTS.filter((s) => tab === 'all' || (tab === 'g1' ? s.group === 'Group I' : s.group === 'Group II')).map((subject) => ({
        subject,
        stats: subjectStats(subject.id, chapters, revisions),
      })),
    [tab, chapters, revisions],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Subjects" subtitle="Chapter-level progress for every CMA Intermediate paper." />
      <Tabs label="Group" tabs={TABS.map((t) => ({ ...t }))} active={tab} onChange={(id) => setParams(id === 'all' ? {} : { group: id })} />
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ subject, stats }) => (
          <Link key={subject.id} to={`/subjects/${subject.id}`} className="group block rounded-xl">
            <Card className="h-full transition-colors group-hover:border-violet-500/40">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Paper {subject.paperNumber} · {subject.group}</p>
              <h2 className="mt-1 text-[16px] font-semibold text-ink">{subject.name}</h2>
              <div className="mt-4 flex items-center gap-3">
                <ProgressBar value={stats.completionPct} label={`${subject.shortName} completion`} />
                <span className="text-[13px] font-semibold text-ink">{formatPercent(stats.completionPct)}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Chapters" value={`${stats.done}/${stats.total}`} />
                <Metric label="Study hours" value={formatHours(Math.round(stats.actualHours * 10) / 10)} />
                <Metric label="Revisions" value={`${stats.revisionsDone}/${stats.revisionsTotal}`} />
                <Metric label="Accuracy" value={stats.accuracy === null ? '—' : formatPercent(stats.accuracy)} />
              </dl>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="text-[14px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

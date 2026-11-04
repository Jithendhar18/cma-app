import { useMemo } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatCard } from '@/components/ui/StatCard';
import { BookOpenCheck, Clock3, RotateCcw, Target } from 'lucide-react';
import { CONFIDENCE_LABELS, subjectMockSummary, subjectStats } from '@/lib/analytics';
import { CHAPTER_STATUS_META } from '@/lib/statusMeta';
import { Badge } from '@/components/ui/Badge';
import { formatHours, formatPercent } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';
import type { Subject } from '@/types/study';

export function OverviewTab({ subject }: { subject: Subject }) {
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);
  const mocks = useStudyStore((s) => s.mockExams);
  const stats = useMemo(() => subjectStats(subject.id, chapters, revisions), [subject.id, chapters, revisions]);
  const own = chapters.filter((c) => c.subjectId === subject.id);
  const mock = subjectMockSummary(mocks, subject.id);
  const counts = own.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  const avgConfidence = own.length ? own.reduce((s, c) => s + c.confidence, 0) / own.length : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Completion" value={formatPercent(stats.completionPct)} icon={BookOpenCheck} tone="emerald" hint={`${stats.done} of ${stats.total} chapters`} />
        <StatCard label="Study hours" value={formatHours(Math.round(stats.actualHours * 10) / 10)} icon={Clock3} tone="violet" hint={`${formatHours(stats.estimatedHours)} estimated`} />
        <StatCard label="Revisions" value={`${stats.revisionsDone}/${stats.revisionsTotal}`} icon={RotateCcw} tone="blue" hint="completed" />
        <StatCard label="Practice accuracy" value={stats.accuracy === null ? '—' : formatPercent(stats.accuracy)} icon={Target} tone="amber" hint={mock.latest === null ? 'No mock yet' : `Latest mock ${formatPercent(mock.latest)}`} />
      </div>
      <Card>
        <CardHeader title="Chapter status" description={`Average confidence: ${avgConfidence.toFixed(1)} (${CONFIDENCE_LABELS[Math.max(1, Math.round(avgConfidence)) as 1 | 2 | 3 | 4 | 5]})`} />
        <ProgressBar value={stats.completionPct} label="Subject completion" className="mb-5" />
        <div className="flex flex-wrap gap-2">
          {Object.entries(CHAPTER_STATUS_META).map(([status, meta]) => (
            <Badge key={status} tone={meta.tone}>{meta.label}: {counts[status] ?? 0}</Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}

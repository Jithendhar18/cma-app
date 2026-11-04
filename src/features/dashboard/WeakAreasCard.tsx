import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SUBJECTS } from '@/data/subjects';
import { CONFIDENCE_LABELS, weakAreas, weakSubjects } from '@/lib/analytics';
import { formatPercent } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';

export function WeakAreasCard() {
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);
  const areas = useMemo(() => weakAreas(chapters, SUBJECTS, 4), [chapters]);
  const subjects = useMemo(() => weakSubjects(SUBJECTS, chapters, revisions).slice(0, 3), [chapters, revisions]);

  return (
    <Card>
      <CardHeader title="Weak areas" description="Low accuracy or low confidence" />
      {areas.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No weak areas" description="Practise more questions to surface weak chapters." className="py-8" />
      ) : (
        <>
          {subjects.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {subjects.map((w) => (
                <Link key={w.subject.id} to={`/subjects/${w.subject.id}`}>
                  <Badge tone="red">{w.subject.shortName} · {formatPercent(w.accuracy ?? 0)}</Badge>
                </Link>
              ))}
            </div>
          )}
          <ul className="space-y-4">
            {areas.map(({ chapter, subject, accuracy, action }) => (
              <li key={chapter.id}>
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/subjects/${subject.id}?tab=chapters&chapter=${chapter.id}`} className="min-w-0 text-[13px] font-medium text-ink hover:underline">
                    <span className="block truncate">{chapter.title}</span>
                  </Link>
                  <span className="shrink-0 text-[12px] text-ink-2">
                    {accuracy === null ? 'No data' : formatPercent(accuracy)} · {CONFIDENCE_LABELS[chapter.confidence]}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-3">{subject.shortName}: {action}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

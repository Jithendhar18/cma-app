import { Link } from 'react-router-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { daysUntil } from '@/lib/analytics';
import { formatLongDate, todayISO } from '@/lib/dates';
import { formatPercent } from '@/lib/format';
import { groupCompletion } from '@/lib/selectors';
import { useStudyStore } from '@/stores/studyStore';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';

export function ExamCountdownCard() {
  const { subjects, groups } = useCurriculum();
  const settings = useStudyStore((s) => s.settings);
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);
  // An empty date means "not announced" (account mode). It is never replaced by a guess.
  const hasDate = settings.examDate !== '';
  const days = hasDate ? daysUntil(settings.examDate, todayISO()) : 0;

  return (
    <Card>
      <CardHeader title="Exam countdown" description={settings.examAttempt + ' attempt'} />
      <p className="text-[34px] font-semibold leading-none tracking-tight text-ink">
        {hasDate ? (days > 0 ? days : 0) : '—'}
        <span className="ml-2 text-[14px] font-normal text-ink-2">{hasDate ? 'days to go' : 'exam date not announced yet'}</span>
      </p>
      <p className="mt-2 text-[12px] text-ink-3">
        {hasDate ? formatLongDate(settings.examDate) : 'No official date is known.'}
        {settings.examDateIsSample && ' · placeholder date, not official.'}{' '}
        <Link to="/settings" className="text-violet-500 hover:underline">Set exam date</Link>
      </p>
      <div className="mt-5 space-y-4">
        {groups.map((gr) => gr.name).map((group) => {
          const g = groupCompletion(group, chapters, revisions, subjects);
          const active = settings.examGroups.includes(group);
          return (
            <div key={group} className={active ? '' : 'opacity-50'}>
              <div className="mb-1.5 flex justify-between text-[12px]">
                <span className="font-medium text-ink">{group}{active ? '' : ' (not selected)'}</span>
                <span className="text-ink-2">{formatPercent(g.pct)} · {g.done}/{g.total} chapters</span>
              </div>
              <ProgressBar value={g.pct} label={`${group} progress`} color={group === 'Group I' ? 'bg-blue-500' : 'bg-emerald-500'} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

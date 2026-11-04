import { Link } from 'react-router-dom';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { daysUntil } from '@/lib/analytics';
import { formatLongDate, todayISO } from '@/lib/dates';
import { formatPercent } from '@/lib/format';
import { groupCompletion } from '@/lib/selectors';
import { useStudyStore } from '@/stores/studyStore';

export function ExamCountdownCard() {
  const settings = useStudyStore((s) => s.settings);
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);
  const days = daysUntil(settings.examDate, todayISO());

  return (
    <Card>
      <CardHeader title="Exam countdown" description={settings.examAttempt + ' attempt'} />
      <p className="text-[34px] font-semibold leading-none tracking-tight text-ink">
        {days > 0 ? days : 0}
        <span className="ml-2 text-[14px] font-normal text-ink-2">days to go</span>
      </p>
      <p className="mt-2 text-[12px] text-ink-3">
        {formatLongDate(settings.examDate)}
        {settings.examDateIsSample && ' · placeholder date, not official.'}{' '}
        <Link to="/settings" className="text-violet-500 hover:underline">Set exam date</Link>
      </p>
      <div className="mt-5 space-y-4">
        {(['Group I', 'Group II'] as const).map((group) => {
          const g = groupCompletion(group, chapters, revisions);
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

import { StudyActivityChart } from '@/components/charts/StudyActivityChart';
import { Card, CardHeader } from '@/components/ui/Card';
import { useStudyLog } from '@/hooks/useStudyData';
import { weeklySeries } from '@/lib/analytics';
import { todayISO } from '@/lib/dates';
import { formatMinutes } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';

export function WeeklyActivityCard() {
  const today = todayISO();
  const target = useStudyStore((s) => s.settings.dailyTargetHours) * 60;
  const series = weeklySeries(useStudyLog(), today);
  const total = series.reduce((sum, d) => sum + d.minutes, 0);
  const elapsedDays = series.filter((d) => !d.isFuture).length;

  return (
    <Card>
      <CardHeader title="Study activity" description="This week, Monday to Sunday" />
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-ink-3">Weekly total</p>
          <p className="text-[18px] font-semibold text-ink">{formatMinutes(total)}</p>
        </div>
        <div>
          <p className="text-[11px] text-ink-3">Daily average</p>
          <p className="text-[18px] font-semibold text-ink">{formatMinutes(elapsedDays ? total / elapsedDays : 0)}</p>
        </div>
      </div>
      <StudyActivityChart data={series} targetMinutes={target} today={today} />
    </Card>
  );
}

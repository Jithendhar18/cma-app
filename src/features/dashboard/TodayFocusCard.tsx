import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RadialProgress } from '@/components/ui/RadialProgress';
import { useStudyLog } from '@/hooks/useStudyData';
import { todayMinutes } from '@/lib/analytics';
import { todayISO } from '@/lib/dates';
import { formatMinutes } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';

export function TodayFocusCard() {
  const navigate = useNavigate();
  const target = useStudyStore((s) => s.settings.dailyTargetHours) * 60;
  const studied = todayMinutes(useStudyLog(), todayISO());
  const remaining = Math.max(0, target - studied);
  const pct = target === 0 ? 0 : (studied / target) * 100;

  return (
    <Card className="flex flex-col items-center gap-6 sm:flex-row">
      <RadialProgress value={pct} size={168} stroke={12}>
        <span className="text-[26px] font-semibold leading-none text-ink">{formatMinutes(studied)}</span>
        <span className="mt-1 text-[12px] text-ink-3">of {formatMinutes(target)}</span>
      </RadialProgress>
      <div className="w-full min-w-0 flex-1 text-center sm:text-left">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Daily focus</p>
        <h2 className="mt-1 text-[18px] font-semibold text-ink">
          {remaining === 0 ? 'Daily target reached' : `${formatMinutes(remaining)} left today`}
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {remaining === 0
            ? 'Anything further is a bonus. Protect your revision time.'
            : `${Math.round(pct)}% of your ${formatMinutes(target)} target is done.`}
        </p>
        <Button variant="primary" className="mt-4" icon={<Play className="size-4" />} onClick={() => navigate('/timer')}>
          Start Focus Session
        </Button>
      </div>
    </Card>
  );
}

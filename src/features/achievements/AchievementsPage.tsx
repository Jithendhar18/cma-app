import { useMemo } from 'react';
import { Award, Flame, Lock, Sparkles, Target } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useStudyLog } from '@/hooks/useStudyData';
import { computeProgress } from '@/lib/achievements';
import { todayMinutes, weeklySeries } from '@/lib/analytics';
import { todayISO } from '@/lib/dates';
import { formatMinutes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useStudyStore } from '@/stores/studyStore';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';

export default function AchievementsPage() {
  const today = todayISO();
  const { subjects } = useCurriculum();
  const studyLog = useStudyLog();
  const { focusLog, chapters, revisions, practiceLog, settings } = useStudyStore();
  const progress = useMemo(() => computeProgress({ focusLog, studyLog, chapters, revisions, practiceLog, today, subjects }), [focusLog, studyLog, chapters, revisions, practiceLog, today, subjects]);

  const dailyTarget = settings.dailyTargetHours * 60;
  const weeklyTarget = settings.weeklyTargetHours * 60;
  const dayMin = todayMinutes(studyLog, today);
  const weekMin = weeklySeries(studyLog, today).reduce((s, d) => s + d.minutes, 0);
  const unlocked = progress.badges.filter((b) => b.current >= b.target);

  return (
    <div className="space-y-6">
      <PageHeader title="Achievements" subtitle="XP, levels and badges are all earned from real study activity." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-violet-500/15 text-[26px] font-semibold text-violet-500">{progress.level}</div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Level</p>
              <p className="text-[20px] font-semibold text-ink">{progress.xp.toLocaleString('en-IN')} XP</p>
            </div>
          </div>
          <ProgressBar className="mt-5" value={(progress.xpIntoLevel / progress.xpForLevel) * 100} label="Progress to next level" />
          <p className="mt-2 text-[12px] text-ink-3">{progress.xpForLevel - progress.xpIntoLevel} XP to level {progress.level + 1}</p>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-3">Earn 10 XP per focused hour, 40 per completed chapter, 15 per revision, 1 per 5 practice questions and 50 per badge.</p>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Goals" description="Targets come from Settings" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Goal icon={Target} label="Daily goal" value={dayMin} target={dailyTarget} />
            <Goal icon={Target} label="Weekly goal" value={weekMin} target={weeklyTarget} />
            <div className="flex items-center gap-3 rounded-lg border bg-canvas p-4">
              <Flame className="size-5 text-amber-500" />
              <div><p className="text-[18px] font-semibold text-ink">{progress.streak} days</p><p className="text-[12px] text-ink-3">Current streak</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-canvas p-4">
              <Sparkles className="size-5 text-violet-500" />
              <div><p className="text-[18px] font-semibold text-ink">{progress.longestStreak} days</p><p className="text-[12px] text-ink-3">Longest streak</p></div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Badges" description={`${unlocked.length} of ${progress.badges.length} unlocked`} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {progress.badges.map((b) => {
            const done = b.current >= b.target;
            return (
              <li key={b.id} className={cn('rounded-lg border p-4', done ? 'bg-emerald-500/[0.07]' : 'bg-canvas')}>
                <div className="flex items-start gap-3">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', done ? 'bg-emerald-500/15 text-emerald-500' : 'bg-ink/[0.06] text-ink-3')}>
                    {done ? <Award className="size-[18px]" /> : <Lock className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{b.title}</p>
                    <p className="text-[12px] text-ink-3">{b.description}</p>
                  </div>
                </div>
                <ProgressBar className="mt-3" value={(Math.min(b.current, b.target) / b.target) * 100} color={done ? 'bg-emerald-500' : 'bg-violet-500'} label={b.title} />
                <p className="mt-1.5 text-[11px] text-ink-3">{Math.min(Math.floor(b.current), b.target).toLocaleString('en-IN')} / {b.target.toLocaleString('en-IN')}</p>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Goal({ icon: Icon, label, value, target }: { icon: typeof Target; label: string; value: number; target: number }) {
  const pct = target === 0 ? 0 : (value / target) * 100;
  return (
    <div className="rounded-lg border bg-canvas p-4">
      <div className="mb-2 flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-1.5 text-ink-2"><Icon className="size-3.5" />{label}</span>
        <span className="font-medium text-ink">{formatMinutes(value)} / {formatMinutes(target)}</span>
      </div>
      <ProgressBar value={pct} color={pct >= 100 ? 'bg-emerald-500' : 'bg-violet-500'} label={label} />
    </div>
  );
}

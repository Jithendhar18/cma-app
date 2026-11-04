import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpenCheck, CalendarCheck, Clock3, Flame, Play, RotateCcw, Target } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { TodayFocusCard } from '@/features/dashboard/TodayFocusCard';
import { TodaySchedule } from '@/features/dashboard/TodaySchedule';
import { SubjectProgressGrid } from '@/features/dashboard/SubjectProgressGrid';
import { RevisionDueCard } from '@/features/dashboard/RevisionDueCard';
import { WeeklyActivityCard } from '@/features/dashboard/WeeklyActivityCard';
import { WeakAreasCard } from '@/features/dashboard/WeakAreasCard';
import { ExamCountdownCard } from '@/features/dashboard/ExamCountdownCard';
import { Sparkline } from '@/components/charts/Sparkline';
import { lastNDaysMinutes, studyStreak, totalMinutes } from '@/lib/analytics';
import { formatHours, formatPercent } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { overallCompletion } from '@/lib/selectors';
import { useStudyLog } from '@/hooks/useStudyData';
import { useStudyStore } from '@/stores/studyStore';

export default function DashboardPage() {
  const navigate = useNavigate();
  const today = todayISO();
  const name = useStudyStore((s) => s.settings.name);
  const chapters = useStudyStore((s) => s.chapters);
  const revisions = useStudyStore((s) => s.revisions);
  const studyLog = useStudyLog();

  const kpis = useMemo(
    () => ({
      hours: totalMinutes(studyLog) / 60,
      trend: lastNDaysMinutes(studyLog, today, 14),
      completion: overallCompletion(chapters),
      streak: studyStreak(studyLog, today),
      revDone: revisions.filter((r) => r.completedOn).length,
      revTotal: revisions.length,
    }),
    [studyLog, chapters, revisions, today],
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${name.split(' ')[0]}`}
        subtitle="Your study command centre for the December 2026 attempt."
        actions={
          <>
            <Button icon={<CalendarCheck className="size-4" />} onClick={() => navigate('/planner')}>
              View Today's Plan
            </Button>
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => navigate('/timer')}>
              Start Focus Session
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <TodayFocusCard />
        <TodaySchedule />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Total study hours" value={formatHours(Math.round(kpis.hours * 10) / 10)} icon={Clock3} tone="violet" hint="Last 14 days">
          <Sparkline values={kpis.trend} />
        </StatCard>
        <StatCard label="Syllabus completion" value={formatPercent(kpis.completion)} icon={BookOpenCheck} tone="emerald" hint={`${chapters.filter((c) => ['completed', 'revision_due', 'exam_ready'].includes(c.status)).length} of ${chapters.length} chapters`} />
        <StatCard label="Study streak" value={`${kpis.streak} ${kpis.streak === 1 ? 'day' : 'days'}`} icon={Flame} tone="amber" hint={kpis.streak === 0 ? 'Study today to start one' : 'Keep it going'} />
        <StatCard label="Revisions completed" value={`${kpis.revDone}`} icon={RotateCcw} tone="blue" hint={`of ${kpis.revTotal} scheduled`} />
      </div>

      <SubjectProgressGrid />

      <div className="grid gap-6 lg:grid-cols-2">
        <RevisionDueCard />
        <WeeklyActivityCard />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <WeakAreasCard />
        <ExamCountdownCard />
      </div>
      <p className="flex items-center gap-2 text-[12px] text-ink-3">
        <Target className="size-3.5" /> Sample data is shown until you log your own sessions.{' '}
        <Link to="/settings" className="text-violet-500 hover:underline">Manage data</Link>
      </p>
    </div>
  );
}

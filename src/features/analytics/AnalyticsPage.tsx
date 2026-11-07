import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BookOpenCheck, Clock3, Flame, Gauge, RotateCcw, Target } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Tabs } from '@/components/ui/Tabs';
import { SUBJECTS } from '@/data/subjects';
import { useStudyLog } from '@/hooks/useStudyData';
import { averageAccuracy, consistencyScore, minutesBySubject, mockPercent, plannedMinutesByDate, RANGE_OPTIONS, rangeDates, studyStreak, weakSubjects, type RangeKey } from '@/lib/analytics';
import { AXIS_TICK, GRID_STROKE, SUBJECT_COLORS } from '@/lib/chartTheme';
import { addDaysISO, formatShortDate, parseISODate, todayISO } from '@/lib/dates';
import { formatMinutes, formatPercent } from '@/lib/format';
import { overallCompletion } from '@/lib/selectors';
import { CHAPTER_STATUS_META } from '@/lib/statusMeta';
import { useStudyStore } from '@/stores/studyStore';
import type { ChapterStatus } from '@/types/study';

const hoursTick = (v: number) => `${Math.round(v * 10) / 10}h`;

function ChartTip({ active, payload, label, unit }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string; unit?: 'h' | '%' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-surface px-3 py-2 shadow-card">
      {label && <p className="text-[11px] text-ink-2">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="text-[12px] font-semibold text-ink">
          {p.name}: {unit === '%' ? formatPercent(p.value ?? 0) : `${Math.round((p.value ?? 0) * 10) / 10}h`}
        </p>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const today = todayISO();
  const [range, setRange] = useState<RangeKey>('30d');
  const studyLog = useStudyLog();
  const { chapters, revisions, focusLog, sessions, mockExams, settings } = useStudyStore();
  const target = settings.dailyTargetHours * 60;

  const dates = useMemo(() => rangeDates(range, studyLog, today), [range, studyLog, today]);
  const dateSet = useMemo(() => new Set(dates), [dates]);

  const data = useMemo(() => {
    const minutes = dates.map((d) => studyLog[d] ?? 0);
    const total = minutes.reduce((a, b) => a + b, 0);
    const activeDays = minutes.filter((m) => m > 0).length;

    // Daily points for short ranges; weekly sums for long ones so charts stay readable.
    const weekly = dates.length > 35;
    const trend = weekly
      ? Array.from({ length: Math.ceil(dates.length / 7) }, (_, i) => {
          const slice = dates.slice(i * 7, i * 7 + 7);
          return { label: formatShortDate(slice[0]), hours: slice.reduce((s, d) => s + (studyLog[d] ?? 0), 0) / 60, target: (target * slice.length) / 60 };
        })
      : dates.map((d) => ({ label: formatShortDate(d), hours: (studyLog[d] ?? 0) / 60, target: target / 60 }));

    const bySubject = minutesBySubject(focusLog, dateSet);
    const subjectData = SUBJECTS.map((s, i) => ({ name: s.shortName, value: (bySubject[s.id] ?? 0) / 60, color: SUBJECT_COLORS[i] })).filter((d) => d.value > 0);

    const months = new Map<string, number>();
    Object.entries(studyLog).forEach(([d, m]) => months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + m));
    const monthly = [...months.entries()].sort().map(([k, m]) => ({ label: parseISODate(`${k}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), hours: m / 60 }));

    const planned = plannedMinutesByDate(sessions);
    const pvcDates = dates.slice(-14);
    const pvc = pvcDates.map((d) => ({ label: formatShortDate(d), Planned: (planned[d] ?? 0) / 60, Completed: (studyLog[d] ?? 0) / 60 }));

    const statusCounts = (Object.keys(CHAPTER_STATUS_META) as ChapterStatus[]).map((s) => ({ name: CHAPTER_STATUS_META[s].label, count: chapters.filter((c) => c.status === s).length }));

    const mocks = [...mockExams].sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ label: formatShortDate(m.date), name: m.name, Score: mockPercent(m) }));

    const due = revisions.filter((r) => !r.cancelledOn && r.dueDate <= today);
    const revisionRate = due.length ? (due.filter((r) => r.completedOn).length / due.length) * 100 : 0;

    return {
      total, activeDays, trend, weekly, subjectData, monthly, pvc, statusCounts, mocks, revisionRate,
      daily: total / dates.length,
      weeklyAvg: total / Math.max(1, dates.length / 7),
      consistency: consistencyScore(studyLog, dates, target),
    };
  }, [dates, dateSet, studyLog, focusLog, sessions, chapters, mockExams, revisions, target, today]);

  const practiceInRange = useStudyStore((s) => s.practiceLog).filter((p) => dateSet.has(p.date));
  const rangeAccuracy = practiceInRange.length ? (practiceInRange.reduce((s, p) => s + p.correct, 0) / practiceInRange.reduce((s, p) => s + p.questions, 0)) * 100 : averageAccuracy(chapters);
  const weak = useMemo(() => weakSubjects(SUBJECTS, chapters, revisions), [chapters, revisions]);
  const streak = studyStreak(studyLog, today);
  const noData = data.total === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Everything below is computed from your logged sessions, chapters and revisions." />
      <Tabs label="Time range" tabs={RANGE_OPTIONS.map((r) => ({ id: r.id, label: r.label }))} active={range} onChange={setRange} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Focused hours" value={formatMinutes(data.total)} icon={Clock3} hint={`${data.activeDays} active days`} />
        <StatCard label="Daily average" value={formatMinutes(data.daily)} icon={Activity} tone="blue" hint={`Target ${formatMinutes(target)}`} />
        <StatCard label="Weekly average" value={formatMinutes(data.weeklyAvg)} icon={Gauge} tone="emerald" hint={`Target ${settings.weeklyTargetHours}h`} />
        <StatCard label="Consistency" value={formatPercent(data.consistency)} icon={Flame} tone="amber" hint={`${streak}-day current streak`} />
        <StatCard label="Syllabus complete" value={formatPercent(overallCompletion(chapters))} icon={BookOpenCheck} tone="emerald" hint={`${chapters.filter((c) => ['completed', 'revision_due', 'exam_ready'].includes(c.status)).length}/${chapters.length} chapters`} />
        <StatCard label="Revision completion" value={formatPercent(data.revisionRate)} icon={RotateCcw} tone="blue" hint="of revisions due so far" />
        <StatCard label="Practice accuracy" value={rangeAccuracy === null ? '—' : formatPercent(rangeAccuracy)} icon={Target} tone="violet" hint={`${practiceInRange.reduce((s, p) => s + p.questions, 0)} questions in range`} />
      </div>

      <Card>
        <CardHeader title="Study time trend" description={data.weekly ? 'Weekly totals vs weekly target' : 'Daily hours vs target'} />
        {noData ? <p className="py-10 text-center text-[13px] text-ink-2">No focused time in this range.</p> : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={hoursTick} width={44} />
                <Tooltip content={<ChartTip unit="h" />} />
                <Area type="monotone" dataKey="hours" name="Focused" stroke="#8B5CF6" strokeWidth={2} fill="url(#trendFill)" />
                <Line type="monotone" dataKey="target" name="Target" stroke="#F59E0B" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Time by subject" description="Focused hours in the selected range" />
          {data.subjectData.length === 0 ? <p className="py-10 text-center text-[13px] text-ink-2">No data.</p> : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-[200px] w-full max-w-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.subjectData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="none">
                      {data.subjectData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTip unit="h" />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full flex-1 space-y-1.5">
                {data.subjectData.map((d) => (
                  <li key={d.name} className="flex items-center gap-2 text-[12px]">
                    <span className="size-2.5 rounded-sm" style={{ background: d.color }} />
                    <span className="flex-1 truncate text-ink-2">{d.name}</span>
                    <span className="font-medium text-ink">{Math.round(d.value * 10) / 10}h</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Planned vs completed" description="Last 14 days of the range" />
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.pvc} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={hoursTick} width={44} />
                <Tooltip content={<ChartTip unit="h" />} cursor={{ fill: 'rgba(148,155,176,0.08)' }} />
                <Bar dataKey="Planned" fill="#3B82F6" fillOpacity={0.55} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Completed" fill="#10B981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Monthly study trend" description="All recorded months" />
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v)}h`} width={44} />
                <Tooltip content={<ChartTip unit="h" />} cursor={{ fill: 'rgba(148,155,176,0.08)' }} />
                <ReferenceLine y={settings.dailyTargetHours * 30} stroke="#F59E0B" strokeDasharray="4 4" />
                <Bar dataKey="hours" name="Focused" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Chapter completion" description="Chapters by status across all papers" />
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.statusCounts} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={92} />
                <Tooltip cursor={{ fill: 'rgba(148,155,176,0.08)' }} content={({ active, payload }) => active && payload?.length ? <div className="rounded-lg border bg-surface px-3 py-2 text-[12px] font-semibold text-ink shadow-card">{payload[0].payload.name}: {payload[0].value}</div> : null} />
                <Bar dataKey="count" fill="#10B981" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Mock examination scores" description="Percentage per attempt, oldest to newest" />
          {data.mocks.length === 0 ? <p className="py-10 text-center text-[13px] text-ink-2">No mock scores recorded.</p> : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.mocks} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={50} />
                  <Tooltip content={<ChartTip unit="%" />} />
                  <ReferenceLine y={50} stroke="#939BB0" strokeDasharray="4 4" label={{ value: '50% reference', fill: '#939BB0', fontSize: 10, position: 'insideBottomRight' }} />
                  <Line type="monotone" dataKey="Score" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Weak subjects" description="Practice accuracy below 60%" />
          {weak.length === 0 ? <p className="text-[13px] text-ink-2">No weak subjects right now.</p> : (
            <ul className="divide-y">
              {weak.map((w) => (
                <li key={w.subject.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate text-[13px] text-ink">{w.subject.shortName}</span>
                  <span className="flex items-center gap-2"><Badge tone="red">{formatPercent(w.accuracy ?? 0)}</Badge><span className="text-[12px] text-ink-3">{w.weakChapters} weak ch.</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="text-[12px] text-ink-3">Earlier history ({formatShortDate(addDaysISO(today, -89))} onward) is sample data until you log your own sessions.</p>
    </div>
  );
}

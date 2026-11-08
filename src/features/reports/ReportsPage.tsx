import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
import { useStudyLog } from '@/hooks/useStudyData';
import { effectiveSessionStatus, mockPercent, minutesBySubject, weakAreas } from '@/lib/analytics';
import { addDaysISO, formatShortDate, formatWeekday, todayISO, weekDatesISO } from '@/lib/dates';
import { formatMinutes, formatPercent } from '@/lib/format';
import { useStudyStore } from '@/stores/studyStore';

export default function ReportsPage() {
  const { subjects: curriculumSubjects } = useCurriculum();
  const today = todayISO();
  const [anchor, setAnchor] = useState(today);
  const studyLog = useStudyLog();
  const { settings, focusLog, chapters, revisions, practiceLog, mockExams, sessions } = useStudyStore();

  const report = useMemo(() => {
    const dates = weekDatesISO(anchor);
    const set = new Set(dates);
    const elapsed = dates.filter((d) => d <= today);
    const target = settings.dailyTargetHours * 60;
    const total = dates.reduce((s, d) => s + (studyLog[d] ?? 0), 0);
    const bySubject = minutesBySubject(focusLog, set);
    const q = practiceLog.filter((p) => set.has(p.date));
    const questions = q.reduce((s, p) => s + p.questions, 0);
    const correct = q.reduce((s, p) => s + p.correct, 0);
    const missedDays = elapsed.filter((d) => (studyLog[d] ?? 0) < target);
    const missedSessions = sessions.filter((s) => set.has(s.date) && effectiveSessionStatus(s, today) === 'missed');
    const doneChapters = chapters.filter((c) => c.completedOn && set.has(c.completedOn));
    const revDone = revisions.filter((r) => r.completedOn && set.has(r.completedOn)).length;
    const mocks = mockExams.filter((m) => set.has(m.date));
    const weak = weakAreas(chapters, curriculumSubjects, 3);
    const avg = elapsed.length ? total / elapsed.length : 0;
    const weeklyTarget = settings.weeklyTargetHours * 60;

    const tips: string[] = [];
    if (total < weeklyTarget) tips.push(`You are ${formatMinutes(weeklyTarget - total)} short of the weekly target. Add one extra session on your strongest day.`);
    if (missedDays.length > 2) tips.push(`${missedDays.length} days missed the daily target. Schedule fixed start times to protect them.`);
    if (missedSessions.length) tips.push(`${missedSessions.length} planned session(s) were missed. Reschedule them in the planner.`);
    if (questions > 0 && correct / questions < 0.6) tips.push('Practice accuracy is below 60%. Review wrong answers before attempting new questions.');
    if (questions === 0) tips.push('No practice questions were logged. Add at least 30 questions per week.');
    if (weak[0]) tips.push(`Prioritise "${weak[0].chapter.title}" (${weak[0].subject.shortName}), your weakest active chapter.`);
    if (tips.length === 0) tips.push('Strong week. Keep the same rhythm and add a mock test.');

    return { dates, total, avg, bySubject, questions, correct, missedDays, missedSessions, doneChapters, revDone, mocks, weak, tips, weeklyTarget, target };
  }, [anchor, today, studyLog, settings, focusLog, practiceLog, chapters, revisions, mockExams, sessions, curriculumSubjects]);

  const isCurrent = report.dates.includes(today);
  const subjectRows = curriculumSubjects.map((s) => ({ s, m: report.bySubject[s.id] ?? 0 })).filter((r) => r.m > 0).sort((a, b) => b.m - a.m);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly Report"
        subtitle={`${formatShortDate(report.dates[0])} – ${formatShortDate(report.dates[6])}${isCurrent ? ' (in progress)' : ''}`}
        actions={
          <div className="no-print flex items-center gap-2">
            <Button size="icon" variant="secondary" aria-label="Previous week" onClick={() => setAnchor(addDaysISO(anchor, -7))} icon={<ChevronLeft className="size-4" />} />
            <Button size="icon" variant="secondary" aria-label="Next week" disabled={isCurrent} onClick={() => setAnchor(addDaysISO(anchor, 7))} icon={<ChevronRight className="size-4" />} />
            <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print report</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Focused hours" value={formatMinutes(report.total)} hint={`${formatPercent((report.total / report.weeklyTarget) * 100)} of weekly target`} />
        <Kpi label="Average per day" value={formatMinutes(report.avg)} hint={`Target ${formatMinutes(report.target)}`} />
        <Kpi label="Chapters completed" value={String(report.doneChapters.length)} hint={`${report.revDone} revisions done`} />
        <Kpi label="Questions practised" value={String(report.questions)} hint={report.questions ? `${formatPercent((report.correct / report.questions) * 100)} accuracy` : 'None logged'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Daily hours" description="Against your daily target" />
          <ul className="space-y-3">
            {report.dates.map((d) => {
              const m = studyLog[d] ?? 0;
              return (
                <li key={d} className="grid grid-cols-[48px_1fr_64px] items-center gap-3 text-[12px]">
                  <span className="text-ink-2">{formatWeekday(d)}</span>
                  <ProgressBar value={(m / report.target) * 100} color={m >= report.target ? 'bg-emerald-500' : d > today ? 'bg-ink-3' : 'bg-blue-500'} label={`${formatWeekday(d)} hours`} />
                  <span className="text-right font-medium text-ink">{d > today ? '—' : formatMinutes(m)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Time by subject" />
          {subjectRows.length === 0 ? <p className="text-[13px] text-ink-2">No focused time this week.</p> : (
            <ul className="space-y-3">
              {subjectRows.map(({ s, m }) => (
                <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[12px]">
                  <div>
                    <p className="mb-1 truncate text-ink">{s.shortName}</p>
                    <ProgressBar value={(m / subjectRows[0].m) * 100} label={s.shortName} />
                  </div>
                  <span className="font-medium text-ink">{formatMinutes(m)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Mock examinations" />
          {report.mocks.length === 0 ? <p className="text-[13px] text-ink-2">No mock exams this week.</p> : (
            <ul className="divide-y">
              {report.mocks.map((m) => (
                <li key={m.id} className="flex justify-between py-2 text-[13px]"><span className="text-ink">{curriculumSubjects.find((s) => s.id === m.subjectId)?.shortName} · {m.name}</span><span className="font-semibold text-ink">{formatPercent(mockPercent(m))}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Weak areas" />
          <ul className="space-y-2">
            {report.weak.length === 0 && <li className="text-[13px] text-ink-2">No weak areas detected.</li>}
            {report.weak.map((w) => <li key={w.chapter.id} className="text-[13px] text-ink">{w.chapter.title} <span className="text-ink-3">· {w.subject.shortName}</span></li>)}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Missed targets" />
          {report.missedDays.length === 0 && report.missedSessions.length === 0 ? <p className="text-[13px] text-ink-2">No missed targets.</p> : (
            <div className="flex flex-wrap gap-2">
              {report.missedDays.map((d) => <Badge key={d} tone="amber">{formatWeekday(d)} below target</Badge>)}
              {report.missedSessions.map((s) => <Badge key={s.id} tone="red">Missed session {formatShortDate(s.date)}</Badge>)}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Suggested improvements" />
          <ul className="list-disc space-y-2 pl-5 text-[13px] text-ink">{report.tips.map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="!p-4">
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className="mt-1 text-[22px] font-semibold text-ink">{value}</p>
      <p className="mt-1 text-[12px] text-ink-3">{hint}</p>
    </Card>
  );
}

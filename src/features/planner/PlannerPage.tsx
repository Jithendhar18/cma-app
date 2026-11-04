import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarX, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { SessionFormSheet } from '@/features/planner/SessionFormSheet';
import { SessionRow } from '@/features/planner/SessionRow';
import { useStudyLog } from '@/hooks/useStudyData';
import { addDaysISO, formatLongDate, formatShortDate, formatWeekday, parseISODate, todayISO, toISODate, weekDatesISO } from '@/lib/dates';
import { formatMinutes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useStudyStore } from '@/stores/studyStore';
import type { StudySession } from '@/types/study';

type View = 'day' | 'week' | 'month';
const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
] as const;

function monthGrid(anchor: string): string[] {
  const d = parseISODate(anchor);
  const first = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = weekDatesISO(first)[0];
  return Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
}

export default function PlannerPage() {
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : today;
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'day') as View;

  const sessions = useStudyStore((s) => s.sessions);
  const studyLog = useStudyLog();
  const [editing, setEditing] = useState<StudySession | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  const go = (nextDate: string, nextView: View = view) => setParams({ date: nextDate, view: nextView }, { replace: true });
  const step = (dir: 1 | -1) => {
    if (view === 'day') go(addDaysISO(date, dir));
    else if (view === 'week') go(addDaysISO(date, 7 * dir));
    else {
      const d = parseISODate(date);
      go(toISODate(new Date(d.getFullYear(), d.getMonth() + dir, 1)));
    }
  };

  const weekDates = useMemo(() => weekDatesISO(date), [date]);
  const monthDates = useMemo(() => monthGrid(date), [date]);
  const visible = view === 'day' ? [date] : view === 'week' ? weekDates : monthDates.filter((d) => d.slice(0, 7) === date.slice(0, 7));

  const byDate = useMemo(() => {
    const map = new Map<string, StudySession[]>();
    for (const s of sessions) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    map.forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [sessions]);

  const planned = visible.reduce((sum, d) => sum + (byDate.get(d) ?? []).reduce((a, s) => a + s.durationMinutes, 0), 0);
  const completed = visible.reduce((sum, d) => sum + (studyLog[d] ?? 0), 0);

  const title =
    view === 'day' ? formatLongDate(date) : view === 'week' ? `${formatShortDate(weekDates[0])} – ${formatShortDate(weekDates[6])}` : parseISODate(date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (s: StudySession) => {
    setEditing(s);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Study Planner"
        subtitle="Plan sessions, then let focused time fill the gaps."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={openNew}>New session</Button>}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="secondary" aria-label="Previous" onClick={() => step(-1)} icon={<ChevronLeft className="size-4" />} />
          <Button size="icon" variant="secondary" aria-label="Next" onClick={() => step(1)} icon={<ChevronRight className="size-4" />} />
          <Button variant="secondary" onClick={() => go(today)}>Today</Button>
          <h2 className="ml-2 text-[15px] font-semibold text-ink">{title}</h2>
        </div>
        <Tabs label="Planner view" tabs={VIEWS.map((v) => ({ ...v }))} active={view} onChange={(id) => go(date, id)} className="border-b-0" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Card className="!p-4">
          <p className="text-[11px] text-ink-3">Planned</p>
          <p className="text-[18px] font-semibold text-ink">{formatMinutes(planned)}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-[11px] text-ink-3">Completed (focused)</p>
          <p className="text-[18px] font-semibold text-ink">{formatMinutes(completed)}</p>
        </Card>
      </div>

      {view === 'day' && (
        <Card>
          {(byDate.get(date) ?? []).length === 0 ? (
            <EmptyState icon={CalendarX} title="No sessions this day" description="Add a session to start planning." action={<Button variant="primary" onClick={openNew}>New session</Button>} />
          ) : (
            <div className="space-y-2">{(byDate.get(date) ?? []).map((s) => <SessionRow key={s.id} session={s} onEdit={openEdit} />)}</div>
          )}
        </Card>
      )}

      {view === 'week' && (
        <div className="grid gap-3 lg:grid-cols-7">
          {weekDates.map((d) => (
            <Card key={d} className={cn('!p-3', d === today && 'border-violet-500/50')}>
              <button type="button" onClick={() => go(d, 'day')} className="mb-2 flex w-full items-baseline justify-between text-left">
                <span className="text-[12px] font-semibold text-ink">{formatWeekday(d)} <span className="font-normal text-ink-3">{formatShortDate(d)}</span></span>
                <span className="text-[11px] text-ink-3">{formatMinutes(studyLog[d] ?? 0)}</span>
              </button>
              <div className="space-y-1.5">
                {(byDate.get(d) ?? []).length === 0 && <p className="text-[12px] text-ink-3">No sessions</p>}
                {(byDate.get(d) ?? []).map((s) => <WeekChip key={s.id} session={s} onClick={() => openEdit(s)} />)}
              </div>
            </Card>
          ))}
        </div>
      )}

      {view === 'month' && (
        <Card padded={false} className="overflow-hidden">
          <div className="grid grid-cols-7 border-b text-center text-[11px] font-medium text-ink-3">
            {weekDates.map((d) => <div key={d} className="py-2">{formatWeekday(d)}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthDates.map((d) => {
              const list = byDate.get(d) ?? [];
              const inMonth = d.slice(0, 7) === date.slice(0, 7);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => go(d, 'day')}
                  aria-label={`${formatLongDate(d)}, ${list.length} sessions`}
                  className={cn('flex h-16 flex-col items-start gap-1 border-b border-r p-1.5 text-left transition-colors hover:bg-ink/[0.04] md:h-24 md:p-2', !inMonth && 'opacity-40', d === today && 'bg-violet-500/10')}
                >
                  <span className={cn('text-[12px]', d === today ? 'font-semibold text-violet-500' : 'text-ink-2')}>{parseISODate(d).getDate()}</span>
                  {list.length > 0 && <span className="rounded bg-violet-500/15 px-1 text-[10px] font-medium text-violet-500">{list.length}<span className="hidden md:inline"> session{list.length > 1 ? 's' : ''}</span></span>}
                  {(studyLog[d] ?? 0) > 0 && <span className="hidden text-[10px] text-ink-3 md:block">{formatMinutes(studyLog[d])}</span>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <SessionFormSheet open={formOpen} onClose={() => setFormOpen(false)} session={editing} defaultDate={date} />
    </div>
  );
}

function WeekChip({ session, onClick }: { session: StudySession; onClick: () => void }) {
  const chapter = useStudyStore((s) => s.chapters).find((c) => c.id === session.chapterId);
  const done = session.status === 'completed';
  return (
    <button type="button" onClick={onClick} className={cn('w-full rounded-md border bg-canvas px-2 py-1.5 text-left transition-colors hover:border-violet-500/40', done && 'opacity-60')}>
      <span className="block text-[10px] text-ink-3">{session.startTime} · {formatMinutes(session.durationMinutes)}</span>
      <span className="block truncate text-[12px] text-ink">{chapter?.title}</span>
    </button>
  );
}

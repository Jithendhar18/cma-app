import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { daysUntil } from '@/lib/analytics';
import { formatShortDate, todayISO } from '@/lib/dates';
import { useStudyStore } from '@/stores/studyStore';

export function ExamCountdownWidget() {
  const examDate = useStudyStore((state) => state.settings.examDate);
  const isSample = useStudyStore((state) => state.settings.examDateIsSample);
  const days = daysUntil(examDate, todayISO());

  return (
    <Link
      to="/settings"
      className="block rounded-lg border bg-canvas p-3 transition-colors hover:border-violet-500/40"
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">
        <CalendarClock className="size-3.5" />
        Exam countdown
      </div>
      <p className="mt-1.5 text-[20px] font-semibold leading-none text-ink">
        {days > 0 ? `${days} days` : 'Exam day passed'}
      </p>
      <p className="mt-1 text-[11px] text-ink-3">
        {formatShortDate(examDate)}
        {isSample ? ' (sample date)' : ''}
      </p>
    </Link>
  );
}

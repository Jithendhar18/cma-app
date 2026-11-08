import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { daysUntil } from '@/lib/analytics';
import { formatShortDate, todayISO } from '@/lib/dates';
import { useShellIdentity } from '@/features/account/useShellIdentity';

export function ExamCountdownWidget() {
  const { examDate, examDateIsSample: isSample } = useShellIdentity();
  const hasDate = examDate !== ''; // empty means "not announced" (account mode), never a guessed date
  const days = hasDate ? daysUntil(examDate, todayISO()) : 0;

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
        {!hasDate ? 'Date not announced' : days > 0 ? `${days} days` : 'Exam day passed'}
      </p>
      <p className="mt-1 text-[11px] text-ink-3">
        {hasDate ? formatShortDate(examDate) : 'No official date yet'}
        {hasDate && isSample ? ' (sample date)' : ''}
      </p>
    </Link>
  );
}

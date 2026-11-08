import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'error' | 'success' | 'info';

const STYLE: Record<Tone, string> = {
  error: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
};
const ICON = { error: AlertCircle, success: CheckCircle2, info: Info } as const;

/** An inline message. Errors are announced immediately (role="alert"); the rest politely (role="status"). */
export function Notice({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-5', STYLE[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

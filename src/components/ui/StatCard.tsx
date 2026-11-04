import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { TONE_BG, TONE_TEXT, type Tone } from '@/lib/statusMeta';
import { cn } from '@/lib/cn';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  children?: ReactNode;
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'violet', children }: StatCardProps) {
  return (
    <Card className="!p-4 md:!p-5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-ink-2">{label}</p>
        <span className={cn('flex size-7 items-center justify-center rounded-lg', TONE_BG[tone], TONE_TEXT[tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-2 text-[24px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </Card>
  );
}

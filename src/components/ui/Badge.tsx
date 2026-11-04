import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TONE_BG, TONE_TEXT, type Tone } from '@/lib/statusMeta';

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}

export function Badge({ tone = 'neutral', dot = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium',
        TONE_BG[tone],
        TONE_TEXT[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

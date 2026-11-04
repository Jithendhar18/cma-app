import { cn } from '@/lib/cn';

interface ProgressBarProps {
  value: number;
  color?: string;
  className?: string;
  label?: string;
}

export function ProgressBar({ value, color = 'bg-violet-500', className, label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.07]', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-700 ease-out', color)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

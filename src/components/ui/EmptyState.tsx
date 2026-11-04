import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ink/[0.06] text-ink-2">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-ink-2">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

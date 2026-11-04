import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: 'div' | 'section' | 'article';
}

export function Card({ children, className, padded = true, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={cn(
        'min-w-0 rounded-xl border bg-surface shadow-card',
        padded && 'p-5 md:p-6',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}

export function CardHeader({ title, description, action, eyebrow }: CardHeaderProps) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{eyebrow}</p>}
        <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

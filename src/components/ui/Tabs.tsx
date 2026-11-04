import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, label, className }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 px-3 pb-3 pt-2 text-[13px] font-medium transition-colors',
              selected ? 'text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-md bg-ink/[0.07] px-1.5 text-[11px] text-ink-2">{tab.count}</span>
              )}
            </span>
            {selected && (
              <motion.span
                layoutId="tab-indicator"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-violet-500"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

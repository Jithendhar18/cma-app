import { Moon, Monitor, Sun, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStudyStore } from '@/stores/studyStore';
import type { ThemeMode } from '@/types/study';

const OPTIONS: Array<{ value: ThemeMode; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'System theme', icon: Monitor },
];

export function ThemeSwitcher() {
  const theme = useStudyStore((state) => state.settings.theme);
  const updateSettings = useStudyStore((state) => state.updateSettings);

  return (
    <div role="radiogroup" aria-label="Theme" className="flex items-center gap-0.5 rounded-lg border bg-canvas p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => updateSettings({ theme: value })}
            className={cn(
              'flex size-7 items-center justify-center rounded-md transition-colors',
              selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

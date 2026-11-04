import { useEffect } from 'react';
import { useStudyStore } from '@/stores/studyStore';
import type { ThemeMode } from '@/types/study';

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Keeps the document's theme class in sync with the saved preference. */
export function useThemeSync() {
  const mode = useStudyStore((state) => state.settings.theme);

  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      const resolved = resolveTheme(mode);
      root.classList.remove('dark', 'light');
      root.classList.add(resolved);
    };
    apply();
    if (mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [mode]);
}

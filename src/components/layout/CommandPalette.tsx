import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { buildSearchIndex, searchItems, type SearchItem } from '@/lib/search';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
import { useStudyStore } from '@/stores/studyStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import type { LibrarySource } from '@/types/library';

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useUiStore.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const { subjects, library: adapter } = useCurriculum();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [library, setLibrary] = useState<LibrarySource[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  const settings = useStudyStore((s) => s.settings);
  const chapters = useStudyStore((s) => s.chapters);
  const sessions = useStudyStore((s) => s.sessions);
  const revisions = useStudyStore((s) => s.revisions);

  useEffect(() => {
    let alive = true;
    adapter.load().then((sources) => alive && setLibrary(sources)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [adapter]);

  const index = useMemo(
    () => buildSearchIndex({ settings, chapters, sessions, revisions, focusLog: [], mockExams: [], practiceLog: [], meta: { seedAnchor: null } }, library, subjects),
    [settings, chapters, sessions, revisions, library, subjects],
  );
  const results = useMemo(() => searchItems(index, query), [index, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item: SearchItem | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[10vh] md:pt-[14vh]" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-scrim/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Search" className="relative w-full max-w-xl overflow-hidden rounded-2xl border bg-surface shadow-card">
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, subjects, chapters, sessions, revisions, resources…"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            className="h-12 w-full bg-transparent text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-ink-3 sm:block">ESC</kbd>
        </div>
        <ul id="palette-results" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-ink-2">No results for “{query}”.</li>}
          {results.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === active} data-index={i}>
              <button
                type="button"
                onMouseMove={() => setActive(i)}
                onClick={() => choose(item)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-violet-500/12')}
              >
                <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wider text-ink-3">{item.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-3">{item.subtitle}</span>
                </span>
                {i === active && <CornerDownLeft className="size-3.5 text-ink-3" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

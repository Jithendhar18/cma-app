import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { findNavItem } from '@/app/navigation';
import { Avatar } from '@/components/layout/Sidebar';
import { ThemeSwitcher } from '@/components/layout/ThemeSwitcher';
import { AccountEntry } from '@/features/auth/AccountEntry';
import { formatLongDate, todayISO } from '@/lib/dates';
import { useStudyStore } from '@/stores/studyStore';

export function TopHeader() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const name = useStudyStore((state) => state.settings.name);
  const openPalette = useUiStore((state) => state.setPaletteOpen);
  const isSubjectDetail = pathname.startsWith('/subjects/');

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-canvas/85 px-4 backdrop-blur-md md:px-8">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <span>{item?.section ?? 'CMA Study OS'}</span>
          {!isSubjectDetail && item && <span aria-hidden>/</span>}
          {!isSubjectDetail && item && <span className="text-ink-2">{item.label}</span>}
        </div>
        <p className="truncate text-[13px] font-medium text-ink md:hidden">{item?.label ?? 'CMA Study OS'}</p>
        <p className="hidden text-[13px] text-ink-2 md:block">{formatLongDate(todayISO())}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => openPalette(true)}
          aria-label="Search"
          className="flex h-9 items-center gap-2 rounded-lg border bg-surface px-2.5 text-[12px] text-ink-3 transition-colors hover:text-ink md:w-56"
        >
          <Search className="size-4" />
          <span className="hidden flex-1 text-left md:block">Search…</span>
          <kbd className="hidden rounded border px-1.5 text-[10px] md:block">⌘K</kbd>
        </button>
        <div className="hidden md:block">
          <ThemeSwitcher />
        </div>
        <AccountEntry />
        <Link to="/settings" aria-label={`Settings for ${name}`} className="rounded-full ring-offset-canvas">
          <Avatar name={name} />
        </Link>
      </div>
    </header>
  );
}

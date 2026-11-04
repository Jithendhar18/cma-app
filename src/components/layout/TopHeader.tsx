import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { findNavItem } from '@/app/navigation';
import { Avatar } from '@/components/layout/Sidebar';
import { ThemeSwitcher } from '@/components/layout/ThemeSwitcher';
import { formatLongDate, todayISO } from '@/lib/dates';
import { useStudyStore } from '@/stores/studyStore';

export function TopHeader() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const name = useStudyStore((state) => state.settings.name);
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
        <div className="hidden md:block">
          <ThemeSwitcher />
        </div>
        <Link to="/settings" aria-label={`Settings for ${name}`} className="rounded-full ring-offset-canvas">
          <Avatar name={name} />
        </Link>
      </div>
    </header>
  );
}

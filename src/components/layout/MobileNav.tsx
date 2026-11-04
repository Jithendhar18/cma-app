import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { MOBILE_PRIMARY_PATHS, NAV_ITEMS } from '@/app/navigation';
import { Sheet } from '@/components/ui/Sheet';
import { ThemeSwitcher } from '@/components/layout/ThemeSwitcher';
import { cn } from '@/lib/cn';

const PRIMARY = MOBILE_PRIMARY_PATHS.map((p) => NAV_ITEMS.find((n) => n.path === p)!).filter(Boolean);
const SECONDARY = NAV_ITEMS.filter((n) => !MOBILE_PRIMARY_PATHS.includes(n.path));

export function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const moreActive = SECONDARY.some((n) => pathname.startsWith(n.path));

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="grid grid-cols-6">
          {PRIMARY.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cn('flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium', isActive ? 'text-violet-500' : 'text-ink-3')
                }
              >
                <item.icon className="size-5" />
                <span className="max-w-full truncate px-0.5">{item.label.replace('Study ', '').replace(' Centre', '').replace('Focus ', '')}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn('flex h-14 w-full flex-col items-center justify-center gap-1 text-[10px] font-medium', moreActive ? 'text-violet-500' : 'text-ink-3')}
              aria-label="More destinations"
            >
              <MoreHorizontal className="size-5" />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="space-y-1">
          {SECONDARY.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn('flex h-12 items-center gap-3 rounded-lg px-3 text-[14px] font-medium', isActive ? 'bg-violet-500/12 text-ink' : 'text-ink-2')
                }
              >
                <item.icon className="size-[18px]" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-between border-t pt-4">
          <span className="text-[13px] text-ink-2">Theme</span>
          <ThemeSwitcher />
        </div>
      </Sheet>
    </>
  );
}

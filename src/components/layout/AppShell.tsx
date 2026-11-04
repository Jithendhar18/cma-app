import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopHeader } from '@/components/layout/TopHeader';
import { MobileNav } from '@/components/layout/MobileNav';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { MiniTimer } from '@/components/layout/MiniTimer';
import { useThemeSync } from '@/hooks/useThemeSync';
import { useTimerEngine } from '@/hooks/useTimerEngine';

export function AppShell() {
  useThemeSync();
  useTimerEngine();
  const { pathname } = useLocation();
  const isTimer = pathname === '/timer';

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The focus timer takes over the whole screen on phones. */}
        <div className={isTimer ? 'hidden md:block' : ''}>
          <TopHeader />
        </div>
        <main className={isTimer ? 'flex-1 md:px-8 md:py-8' : 'flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-8'}>
          <div className="mx-auto w-full max-w-[1240px]">
            <Suspense fallback={<div className="py-24 text-center text-[13px] text-ink-3">Loading…</div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {!isTimer && <MiniTimer />}
      {!isTimer && <MobileNav />}
      <CommandPalette />
    </div>
  );
}

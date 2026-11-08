import { Link, NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronsLeft, ChevronsRight, GraduationCap } from 'lucide-react';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from '@/app/navigation';
import { ExamCountdownWidget } from '@/components/layout/ExamCountdownWidget';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/stores/uiStore';
import { useShellIdentity } from '@/features/account/useShellIdentity';
import { Button } from '@/components/ui/Button';

export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggle = useUiStore((state) => state.toggleSidebar);
  const { name, course } = useShellIdentity();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-300 ease-out md:flex',
        collapsed ? 'w-[76px]' : 'w-[250px]',
      )}
    >
      <div className={cn('flex h-16 items-center gap-3 px-4', collapsed && 'justify-center px-0')}>
        <BrandMark />
        {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-ink">CMA Study OS</span>}
      </div>

      <nav aria-label="Main" className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section} className="mb-5">
            {!collapsed && (
              <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-ink-3">{section}</p>
            )}
            <ul className="space-y-0.5">
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => (
                <li key={item.path}>
                  <SidebarLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-3 border-t p-3">
        {collapsed ? null : <ExamCountdownWidget />}
        <Link
          to="/settings"
          className={cn(
            'flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-ink/[0.05]',
            collapsed && 'justify-center',
          )}
        >
          <Avatar name={name} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{name}</p>
              <p className="truncate text-[11px] text-ink-3">{course}</p>
            </div>
          )}
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className={cn('w-full', collapsed && 'px-0')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          icon={collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        >
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive ? 'text-ink' : 'text-ink-2 hover:bg-ink/[0.05] hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="sidebar-active"
              className="absolute inset-0 rounded-lg bg-violet-500/12"
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            />
          )}
          {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-violet-500" aria-hidden />}
          <Icon className={cn('relative size-[17px] shrink-0', isActive && 'text-violet-500')} />
          {!collapsed && <span className="relative truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

export function BrandMark() {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
      <GraduationCap className="size-[18px]" />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-[12px] font-semibold text-blue-600 dark:text-blue-400',
        className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}

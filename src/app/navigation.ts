import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  Library,
  LayoutDashboard,
  RotateCcw,
  Settings,
  Sparkles,
  Timer,
  Trophy,
  FileText,
  LineChart,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  section: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, section: 'Workspace' },
  { label: 'Study Planner', path: '/planner', icon: CalendarDays, section: 'Workspace' },
  { label: 'Focus Timer', path: '/timer', icon: Timer, section: 'Workspace' },
  { label: 'Subjects', path: '/subjects', icon: BookOpen, section: 'Workspace' },
  { label: 'Revision Centre', path: '/revisions', icon: RotateCcw, section: 'Workspace' },
  { label: 'Analytics', path: '/analytics', icon: LineChart, section: 'Performance' },
  { label: 'Achievements', path: '/achievements', icon: Trophy, section: 'Performance' },
  { label: 'Weekly Reports', path: '/reports', icon: FileText, section: 'Performance' },
  { label: 'Study Library', path: '/library', icon: Library, section: 'Resources' },
  { label: 'CMA Intelligence', path: '/intelligence', icon: Sparkles, section: 'Resources' },
  { label: 'Settings', path: '/settings', icon: Settings, section: 'Preferences' },
];

export const NAV_SECTIONS = ['Workspace', 'Performance', 'Resources', 'Preferences'] as const;

export const MOBILE_PRIMARY_PATHS = ['/', '/planner', '/timer', '/subjects', '/revisions'];

export const BRAND = { name: 'CMA Study OS', icon: GraduationCap };

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') return NAV_ITEMS[0];
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path));
}

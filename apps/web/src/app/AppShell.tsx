import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { OfflineBanner } from '@/shared/ui/offline-banner';
import { RateLimitBanner } from '@/shared/ui/rate-limit-banner';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  GraduationCap,
  Home,
  Library,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  Sun,
  NotebookPen,
  ShieldCheck,
  Flag,
  Compass,
  Tags,
  SearchX,
  FileSearch,
  Scale,
} from 'lucide-react';
import type { Role } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { applyTheme, readTheme, type ThemeChoice } from '@/shared/lib/theme';
import { cn } from '@/shared/lib/utils';
import { Menu } from '@/shared/ui/menu';
import { queryClient } from './queryClient';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  roles?: Role[];
}

/**
 * Left rail (LLD §12.2): only screens that work. Items for screens still being built are added when they land, so
 * nothing on the rail is a dead end.
 */
const NAV: NavItem[] = [
  { to: '/', label: 'Prepare', icon: Home, roles: ['teacher', 'admin'] },
  { to: '/explore', label: 'Explore', icon: Compass, roles: ['teacher'] },
  { to: '/research', label: 'Research', icon: FileSearch, roles: ['teacher'] },
  { to: '/courses', label: 'Courses', icon: GraduationCap, roles: ['teacher'] },
  { to: '/notes', label: 'My notes', icon: NotebookPen, roles: ['teacher'] },
  { to: '/library', label: 'Library', icon: Library, roles: ['library_editor'] },
  { to: '/library/topics', label: 'Topics', icon: Tags, roles: ['library_editor'] },
  { to: '/library/gaps', label: 'Gaps', icon: SearchX, roles: ['library_editor'] },
  { to: '/library/mappings', label: 'Old → new law', icon: Scale, roles: ['library_editor'] },
  { to: '/library/reports', label: 'Reports', icon: Flag, roles: ['library_editor'] },
];

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Match my computer', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const initials = (name = '') =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '·';

/**
 * Full-bleed screens manage their own padding and scrolling: the Studio, and the judgment review (two panes that
 * scroll apart). The other library screens (Topics, Gaps, Reports) are ordinary pages that scroll.
 */
export const FULL_BLEED = /^\/lectures\/[^/]+$|^\/library\/?$/;

export function AppShell() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = me.data?.user.role;
  const fullBleed = FULL_BLEED.test(pathname);
  // The Studio needs the width for the slide: the menu folds away there (she can open it again).
  const studio = /^\/lectures\//.test(pathname);
  useEffect(() => setCollapsed(studio), [studio]);

  async function signOut() {
    await api.logout();
    queryClient.clear();
    void navigate('/login');
  }

  const items = NAV.filter((n) => !n.roles || (role && n.roles.includes(role)));

  return (
    // overflow-clip, not hidden: a hidden box can still be scrolled by the browser (focusing a select, jumping to an
    // item), which slid the whole app up and left an empty band below. A clipped box never scrolls.
    <div className="flex h-dvh overflow-clip">
      <nav
        aria-label="Main"
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 ease-calm md:flex',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b border-border px-4',
            collapsed ? 'justify-center px-0' : 'justify-between',
          )}
        >
          {!collapsed && <span className="text-base font-semibold tracking-tight">NYAAI</span>}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-control p-1.5 text-muted hover:bg-bg hover:text-text"
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-expanded={!collapsed}
          >
            <PanelLeft className="size-4" aria-hidden />
          </button>
        </div>
        <ul className="flex-1 space-y-0.5 p-2">
          {items.map((n) => {
            const Icon = n.icon;
            return (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/' || n.to === '/library'}
                  title={collapsed ? n.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-bg hover:text-text',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{n.label}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
        {!collapsed && me.data && (
          <p className="border-t border-border px-4 py-3 text-xs leading-snug text-muted">{me.data.college.name}</p>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6 md:justify-end">
          <span className="text-base font-semibold md:hidden">NYAAI</span>
          <Menu
            label="Your account"
            trigger={
              <span className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm hover:bg-bg">
                <span className="grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast">
                  {initials(me.data?.user.name)}
                </span>
                <span className="hidden sm:inline">{me.data?.user.name}</span>
              </span>
            }
            header={
              <>
                <p className="font-medium">{me.data?.user.name}</p>
                <p className="text-xs text-muted">{me.data?.user.email}</p>
              </>
            }
            items={[
              ...THEMES.map((t) => {
                const Icon = t.icon;
                return {
                  label: (
                    <span className="flex flex-1 items-center justify-between gap-3">
                      {t.label}
                      {theme === t.value && <Check className="size-4 text-accent" aria-label="chosen" />}
                    </span>
                  ),
                  icon: <Icon className="size-4 text-muted" aria-hidden />,
                  onSelect: () => setTheme(t.value),
                };
              }),
              {
                label: 'Your data',
                icon: <ShieldCheck className="size-4 text-muted" aria-hidden />,
                onSelect: () => void navigate('/account/data'),
              },
              {
                label: 'Sign out',
                icon: <LogOut className="size-4 text-muted" aria-hidden />,
                onSelect: () => void signOut(),
              },
            ]}
          />
        </header>
        <OfflineBanner />
        <RateLimitBanner />
        <main
          className={cn(
            'min-h-0 flex-1',
            fullBleed ? 'overflow-clip' : 'relative overflow-y-auto px-4 py-8 sm:px-8 lg:py-10',
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

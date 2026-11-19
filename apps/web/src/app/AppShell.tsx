import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Compass, GraduationCap, Home, Library, LogOut, Palette, PanelLeft, Search, Shield } from 'lucide-react';
import type { Role } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { ThemeSwitch } from '@/features/home/ThemeSwitch';
import { cn } from '@/shared/lib/utils';
import { queryClient } from './queryClient';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  ready: boolean;
  roles?: Role[];
}

/** Left rail (LLD §12.2). Items whose screens are not built yet are shown, but cannot be opened. */
const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, ready: true },
  { to: '/lectures', label: 'My lectures', icon: BookOpen, ready: false },
  { to: '/courses', label: 'Courses', icon: GraduationCap, ready: false },
  { to: '/explore', label: 'Explore', icon: Compass, ready: false },
  { to: '/research', label: 'Research', icon: Search, ready: false },
  { to: '/style', label: 'My Style', icon: Palette, ready: false },
  { to: '/library', label: 'Library', icon: Library, ready: false, roles: ['library_editor'] },
  { to: '/admin', label: 'Admin', icon: Shield, ready: false, roles: ['admin'] },
];

export function AppShell() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const role = me.data?.user.role;

  async function signOut() {
    await api.logout();
    queryClient.clear();
    navigate('/login');
  }

  return (
    <div className="flex min-h-dvh">
      <nav
        aria-label="Main"
        className={cn('hidden shrink-0 border-r border-border bg-surface py-4 transition-[width] duration-150 ease-calm md:block', collapsed ? 'w-16' : 'w-56')}
      >
        <div className={cn('mb-6 flex items-center px-4', collapsed ? 'justify-center px-0' : 'justify-between')}>
          {!collapsed && <span className="text-lg font-semibold">NYAAI</span>}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-control p-1.5 text-muted hover:bg-bg"
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-expanded={!collapsed}
          >
            <PanelLeft className="size-4" aria-hidden />
          </button>
        </div>
        <ul className="space-y-1 px-2">
          {NAV.filter((n) => !n.roles || (role && n.roles.includes(role))).map((n) => {
            const Icon = n.icon;
            const body = (
              <>
                <Icon className="size-4 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{n.label}</span>}
                {!collapsed && !n.ready && <span className="ml-auto text-xs text-muted">Soon</span>}
              </>
            );
            const base = cn('flex items-center gap-3 rounded-control px-3 py-2 text-sm', collapsed && 'justify-center px-0');
            return (
              <li key={n.to}>
                {n.ready ? (
                  <NavLink to={n.to} end title={collapsed ? n.label : undefined} className={({ isActive }) => cn(base, isActive ? 'bg-bg font-medium text-text' : 'text-muted hover:bg-bg')}>
                    {body}
                  </NavLink>
                ) : (
                  <span aria-disabled="true" title={`${n.label}: coming soon`} className={cn(base, 'cursor-default text-muted opacity-60')}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <span className="text-base font-semibold md:hidden">NYAAI</span>
          <span className="hidden text-sm text-muted md:block">{me.data?.college.name}</span>
          <div className="flex items-center gap-3">
            <ThemeSwitch />
            <span className="hidden text-sm sm:inline">{me.data?.user.name}</span>
            <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-sm text-muted hover:bg-bg">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-8 sm:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

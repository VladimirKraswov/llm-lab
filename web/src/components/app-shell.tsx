import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Bot,
  Database,
  Gauge,
  PlayCircle,
  Settings,
  TerminalSquare,
  Workflow,
  Boxes,
  Layers3,
  ScrollText,
  Activity,
  SplitSquareHorizontal,
  CheckCircle,
  Cpu,
  Menu,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/use-auth';

const items = [
  { to: '/app', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/app/models', label: 'Models', icon: Boxes },
  { to: '/app/loras', label: 'LoRAs', icon: Layers3 },
  { to: '/app/datasets', label: 'Datasets', icon: Database },
  { to: '/app/training', label: 'Train', icon: Workflow },
  { to: '/app/jobs', label: 'Jobs', icon: TerminalSquare },
  { to: '/app/infrastructure', label: 'Infrastructure', icon: Wrench },
  { to: '/app/runtime', label: 'Runtime', icon: PlayCircle },
  { to: '/app/evaluations', label: 'Evaluations', icon: CheckCircle },
  { to: '/app/comparisons', label: 'Comparisons', icon: SplitSquareHorizontal },
  { to: '/app/workers', label: 'Workers', icon: Cpu },
  { to: '/app/playground', label: 'Playground', icon: Bot },
  { to: '/app/logs', label: 'Logs', icon: ScrollText },
  { to: '/app/monitor', label: 'Monitoring', icon: Activity },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-950 text-slate-50">
      <aside
        className={cn(
          'relative hidden flex-col border-r border-slate-800 bg-slate-950/90 transition-all duration-300 ease-in-out md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className={cn('mb-4 flex items-center justify-between p-4', collapsed && 'justify-center')}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[10px] uppercase tracking-[0.2em] text-slate-500">LLM Lab</div>
              <div className="truncate text-lg font-bold text-white">Lab Console</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-900 hover:text-white"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2">
          {user && (
            <div className={cn('mb-2 flex items-center gap-3 border-b border-slate-800 px-2 py-3 text-slate-400', collapsed && 'justify-center')}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                <UserIcon size={16} />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-white">{user.username}</div>
                  <div className="truncate text-[10px] text-slate-500">Authenticated</div>
                </div>
              )}
            </div>
          )}

          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-400 transition-all hover:bg-slate-900 hover:text-white',
                    isActive && 'bg-slate-900 text-white ring-1 ring-slate-800',
                    collapsed && 'justify-center px-0',
                  )
                }
                title={collapsed ? item.label : undefined}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} className={cn('shrink-0', isActive ? 'text-blue-400' : 'group-hover:text-blue-400')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {collapsed && (
                      <div className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100">
                        {item.label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}

          <div className="mt-4 border-t border-slate-800 pt-4">
            <button
              onClick={logout}
              className={cn(
                'group relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-red-400 transition-all hover:bg-red-950/30 hover:text-red-300',
                collapsed && 'justify-center px-0',
              )}
              title={collapsed ? 'Logout' : undefined}
            >
              <LogOut size={18} className="shrink-0" />
              {!collapsed && <span>Logout</span>}
            </button>
          </div>
        </nav>
      </aside>

      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center border-b border-slate-800 bg-slate-950/95 px-4 md:hidden">
        <button onClick={() => setMobileOpen(true)} className="-ml-2 p-2 text-slate-400 hover:text-white">
          <Menu size={24} />
        </button>
        <div className="ml-3 font-bold text-white">LLM Lab</div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)}>
          <aside
            className="flex h-full w-64 flex-col border-r border-slate-800 bg-slate-950 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-8 flex items-center justify-between">
              <div className="font-bold text-white">LLM Lab</div>
              <button onClick={() => setMobileOpen(false)} className="text-slate-400">
                <ChevronLeft size={24} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              {user && (
                <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-900 px-3 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <UserIcon size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white">{user.username}</div>
                    <div className="text-xs text-slate-400">Authenticated</div>
                  </div>
                </div>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-300 transition hover:bg-slate-900 hover:text-white',
                        isActive && 'bg-slate-900 text-white ring-1 ring-slate-800',
                      )
                    }
                  >
                    <Icon size={18} />
                    {item.label}
                  </NavLink>
                );
              })}
              <div className="mt-6 border-t border-slate-800 pt-6">
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-400 transition hover:bg-red-950/30 hover:text-red-300"
                >
                  <LogOut size={18} />
                  Logout
                </button>
              </div>
            </nav>
          </aside>
        </div>
      )}

      <main className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        <div className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto max-w-[1680px] p-4 md:p-6 lg:p-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

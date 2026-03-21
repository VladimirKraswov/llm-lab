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
  Server,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/use-auth';

const items = [
  { to: '/app', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/app/models', label: 'Models', icon: Boxes },
  { to: '/app/loras', label: 'LoRAs', icon: Layers3 },
  { to: '/app/datasets', label: 'Datasets', icon: Database },
  { to: '/app/training', label: 'Training', icon: Workflow },
  { to: '/app/comparisons', label: 'Comparisons', icon: SplitSquareHorizontal },
  { to: '/app/evaluations', label: 'Evaluations', icon: CheckCircle },
  { to: '/app/workers', label: 'Workers', icon: Cpu },
  { to: '/app/jobs', label: 'Jobs', icon: TerminalSquare },
  { to: '/app/infrastructure', label: 'Infrastructure', icon: Server },
  { to: '/app/runtime', label: 'Runtime', icon: PlayCircle },
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
    <div className="flex h-screen w-full bg-slate-950 text-slate-50 overflow-hidden">
      <aside
        className={cn(
          'hidden md:flex flex-col border-r border-slate-800 bg-slate-950/90 transition-all duration-300 ease-in-out relative',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className={cn('p-4 mb-4 flex items-center justify-between', collapsed && 'justify-center')}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 truncate">LLM Lab</div>
              <div className="text-lg font-bold text-white truncate">Lab Console</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 hover:bg-slate-900 rounded-md text-slate-400 hover:text-white transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-2 overflow-y-auto scrollbar-thin">
          {user && (
            <div className={cn('px-2 py-3 mb-2 border-b border-slate-800 flex items-center gap-3 text-slate-400', collapsed && 'justify-center')}>
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
                <UserIcon size={16} />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">{user.username}</div>
                  <div className="text-[10px] text-slate-500 truncate">Authenticated</div>
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
                    'flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-400 transition-all hover:bg-slate-900 hover:text-white group relative',
                    isActive && 'bg-slate-900 text-white ring-1 ring-slate-800',
                    collapsed && 'justify-center px-0'
                  )
                }
                title={collapsed ? item.label : undefined}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} className={cn('shrink-0', isActive ? 'text-blue-400' : 'group-hover:text-blue-400')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {collapsed && (
                      <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none z-50 whitespace-nowrap border border-slate-700">
                        {item.label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
          <div className="pt-4 mt-4 border-t border-slate-800">
            <button
              onClick={logout}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-red-400 transition-all hover:bg-red-950/30 hover:text-red-300 group relative',
                collapsed && 'justify-center px-0'
              )}
              title={collapsed ? 'Logout' : undefined}
            >
              <LogOut size={18} className="shrink-0" />
              {!collapsed && <span>Logout</span>}
            </button>
          </div>
        </nav>
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 h-14 border-b border-slate-800 bg-slate-950/95 flex items-center px-4 z-40">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 text-slate-400 hover:text-white"
        >
          <Menu size={24} />
        </button>
        <div className="ml-3 font-bold text-white">LLM Lab</div>
      </div>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="w-64 h-full bg-slate-950 border-r border-slate-800 p-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="font-bold text-white">LLM Lab</div>
              <button onClick={() => setMobileOpen(false)} className="text-slate-400">
                <ChevronLeft size={24} />
              </button>
            </div>
            <nav className="space-y-1 flex-1 overflow-y-auto">
              {user && (
                <div className="px-3 py-4 mb-4 bg-slate-900 rounded-xl flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
                    <UserIcon size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-white truncate">{user.username}</div>
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
              <div className="pt-6 mt-6 border-t border-slate-800">
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-400 transition hover:bg-red-950/30 hover:text-red-300"
                >
                  <LogOut size={18} />
                  Logout
                </button>
              </div>
            </nav>
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0 h-screen relative pt-14 md:pt-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

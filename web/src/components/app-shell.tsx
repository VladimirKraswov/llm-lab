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
} from 'lucide-react';
import { cn } from '../lib/utils';

const items = [
  { to: '/app', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/app/models', label: 'Models', icon: Boxes },
  { to: '/app/loras', label: 'LoRAs', icon: Layers3 },
  { to: '/app/datasets', label: 'Datasets', icon: Database },
  { to: '/app/training', label: 'Training', icon: Workflow },
  { to: '/app/comparisons', label: 'Comparisons', icon: SplitSquareHorizontal },
  { to: '/app/jobs', label: 'Jobs', icon: TerminalSquare },
  { to: '/app/runtime', label: 'Runtime', icon: PlayCircle },
  { to: '/app/playground', label: 'Playground', icon: Bot },
  { to: '/app/logs', label: 'Logs', icon: ScrollText },
  { to: '/app/monitor', label: 'Monitoring', icon: Activity },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 md:grid-cols-[280px_1fr]">
        <aside className="border-r border-slate-800 bg-slate-950/90 p-5">
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">LLM Lab</div>
            <div className="mt-2 text-xl font-semibold text-white">Training Console</div>
            <div className="mt-2 text-sm text-slate-400">
              База моделей, LoRA, обучение, инференс и упаковка.
            </div>
          </div>

          <nav className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-2xl px-3 py-3 text-sm text-slate-300 transition hover:bg-slate-900 hover:text-white',
                      isActive && 'bg-slate-900 text-white ring-1 ring-slate-800',
                    )
                  }
                >
                  <Icon size={18} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
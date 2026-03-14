import { cn } from '../lib/utils';

const styles: Record<string, string> = {
  running: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  completed: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  failed: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  queued: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  stopped: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  healthy: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
};

export function StatusBadge({ value }: { value: string }) {
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1', styles[value] || 'bg-slate-700 text-slate-200 ring-slate-600')}>{value}</span>;
}

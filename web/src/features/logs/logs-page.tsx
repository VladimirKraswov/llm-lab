import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, LogEntry } from '../../lib/api';
import { ChevronDown, ChevronRight, Search, RefreshCcw } from 'lucide-react';

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const colors = {
    info: 'text-green-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
    debug: 'text-blue-400',
  };

  const { timestamp, level, message, ...meta } = entry;

  return (
    <div className="border-b border-slate-800/50 last:border-0">
      <div
        className="flex items-start gap-3 py-2 px-3 hover:bg-slate-800/30 cursor-pointer transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="mt-1 text-slate-600">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <div className="min-w-[160px] text-xs font-mono text-slate-500">
          {new Date(timestamp).toLocaleString()}
        </div>
        <div className={`min-w-[60px] text-xs font-bold uppercase ${colors[level] || 'text-slate-400'}`}>
          {level}
        </div>
        <div className="text-sm text-slate-200 break-all">{message}</div>
      </div>

      {expanded && Object.keys(meta).length > 0 && (
        <div className="bg-slate-950/50 p-4 mx-3 mb-2 rounded-xl border border-slate-800/50">
          <pre className="text-xs text-slate-400 overflow-auto max-h-[300px]">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function LogsPage() {
  const [level, setLevel] = useState<string>('');
  const [q, setQ] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logs', level, q],
    queryFn: () => api.getLogs({ level, q }),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">System Logs</h1>
          <p className="mt-1 text-sm text-slate-400">
            Просмотр событий системы в реальном времени.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCcw size={16} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="text"
            placeholder="Search logs..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-10 pr-4 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white outline-none"
        >
          <option value="">All Levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-slate-500">Loading logs...</div>
        ) : !data?.length ? (
          <div className="p-10 text-center text-slate-500">No logs found matching your criteria.</div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {data.map((entry, idx) => (
              <LogRow key={idx} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

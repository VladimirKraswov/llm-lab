import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, truncate } from '../../lib/utils';
import { PageHeader } from '../../components/page-header';
import { StatCard } from '../../components/stat-card';
import { StatusBadge } from '../../components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, refetchInterval: 5000 });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Сводка по окружению, датасетам, обучению и runtime."
        actions={<Link to="/app/training"><Button>Start training</Button></Link>}
      />

      {isLoading ? <p className="text-slate-400">Loading…</p> : null}
      {error ? <p className="text-rose-300">{(error as Error).message}</p> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Datasets" value={data.counts.datasets} />
            <StatCard title="Jobs" value={data.counts.jobs} />
            <StatCard title="Running jobs" value={data.counts.runningJobs} />
            <StatCard title="Completed jobs" value={data.counts.completedJobs} />
            <StatCard title="Failed jobs" value={data.counts.failedJobs} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Recent jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.recentJobs.length ? data.recentJobs.map((job) => (
                    <div key={job.id} className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="font-medium text-white">{job.name}</div>
                        <div className="mt-1 text-sm text-slate-400">{truncate(job.baseModel, 70)}</div>
                        <div className="mt-1 text-xs text-slate-500">Started: {fmtDate(job.startedAt || job.createdAt)}</div>
                      </div>
                      <StatusBadge value={job.status} />
                    </div>
                  )) : <p className="text-slate-400">No jobs yet.</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Python</span>
                  <StatusBadge value={data.health.python ? 'healthy' : 'failed'} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">vLLM binary</span>
                  <StatusBadge value={data.health.vllmBin ? 'healthy' : 'failed'} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Runtime model</span>
                  <span className="text-sm text-white">{data.runtime.vllm?.model || 'Not running'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Runtime port</span>
                  <span className="text-sm text-white">{data.settings.inferencePort}</span>
                </div>
                <div className="text-xs text-slate-500">Updated: {fmtDate(data.health.time)}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

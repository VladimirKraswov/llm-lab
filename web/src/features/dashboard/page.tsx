import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, truncate } from '../../lib/utils';
import { PageHeader } from '../../components/page-header';
import { StatCard } from '../../components/stat-card';
import { StatusBadge } from '../../components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { JobTypeBadge } from '../../components/job-type-badge';

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboardSummary,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        description="Сводка по окружению, датасетам, обучению и runtime."
        actions={
          <Link to="/app/training">
            <Button size="sm">Start training</Button>
          </Link>
        }
      />

      {isLoading ? <p className="text-slate-400 text-sm">Loading…</p> : null}
      {error ? <p className="text-rose-300 text-sm">{(error as Error).message}</p> : null}

      {data ? (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <StatCard title="Datasets" value={data.counts.datasets} />
            <StatCard title="Jobs" value={data.counts.jobs} />
            <StatCard title="Running" value={data.counts.runningJobs} />
            <StatCard title="Completed" value={data.counts.completedJobs} />
            <StatCard title="Failed" value={data.counts.failedJobs} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent jobs</CardTitle>
                <Link to="/app/jobs" className="text-xs text-blue-400 hover:text-blue-300">View all</Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.recentJobs.length ? (
                    data.recentJobs.map((job) => {
                      const isSynthetic = job.type === 'synthetic-gen';
                      const isQuantize = job.type === 'model-quantize';

                      return (
                        <div
                          key={job.id}
                          className={`flex items-center justify-between gap-4 rounded-xl border p-2.5 ${
                            isSynthetic
                              ? 'border-cyan-500/20 bg-cyan-500/5'
                              : isQuantize
                                ? 'border-amber-500/20 bg-amber-500/5'
                                : 'border-purple-500/20 bg-purple-500/5'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold text-white text-sm truncate">{job.name}</div>
                              <JobTypeBadge type={job.type} />
                            </div>

                            <div className="mt-0.5 text-xs text-slate-400 truncate">
                              {isSynthetic
                                ? `Step: ${job.syntheticMeta?.progressStep || job.progressStep || '—'}`
                                : job.baseModel || '—'}
                            </div>

                            <div className="mt-0.5 text-[10px] text-slate-500">
                              {fmtDate(job.startedAt || job.createdAt)}
                              {job.runner ? ` · ${job.runner}` : ''}
                            </div>
                          </div>

                          <StatusBadge value={job.status} />
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-slate-400 text-sm">No jobs yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Python</span>
                  <StatusBadge value={data.health.python ? 'healthy' : 'failed'} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Quantize Env</span>
                  <StatusBadge value={data.health.quantizeEnvOk ? 'healthy' : 'failed'} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">vLLM Binary</span>
                  <StatusBadge value={data.health.vllmBin ? 'healthy' : 'failed'} />
                </div>

                <div className="pt-2 mt-2 border-t border-slate-800 space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Runtime model</span>
                    <span className="text-xs text-white truncate font-mono bg-slate-950/50 p-1.5 rounded border border-slate-800">
                       {data.runtime.vllm?.model || 'Not running'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Port</span>
                    <span className="text-xs font-mono text-white">{data.settings.inferencePort}</span>
                  </div>
                </div>

                <div className="text-[10px] text-slate-600 text-right">Updated: {fmtDate(data.health.time)}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
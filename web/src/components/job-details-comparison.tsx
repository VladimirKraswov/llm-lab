import { useQuery } from '@tanstack/react-query';
import type { Job } from '../lib/api';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ResponseRenderer } from './response-renderer';

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export function JobDetailsComparison({ job }: { job: Job }) {
  const summaryQuery = useQuery({
    queryKey: ['comparison-summary', job.id],
    queryFn: () => api.getComparisonSummary(job.id),
    enabled: !!job.id,
    refetchInterval: job.status === 'running' ? 3000 : false,
  });

  const resultQuery = useQuery({
    queryKey: ['comparison-result', job.id],
    queryFn: () => api.getComparisonResult(job.id),
    enabled: !!job.id,
    refetchInterval: job.status === 'running' ? 3000 : false,
  });

  const prompts = Array.isArray(job.paramsSnapshot?.prompts) ? job.paramsSnapshot.prompts : [];
  const targets = Array.isArray(job.paramsSnapshot?.targets) ? job.paramsSnapshot.targets : [];

  return (
    <div className="space-y-4">
      <Card className="border-indigo-500/20 bg-indigo-500/5">
        <CardHeader>
          <CardTitle>Model Comparison Job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Created</div>
            <div className="mt-1 text-white">{fmtDate(job.createdAt)}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Finished</div>
            <div className="mt-1 text-white">{fmtDate(job.finishedAt)}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Targets</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {job.summaryMetrics?.targets ?? targets.length ?? '—'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Prompts per target</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {job.summaryMetrics?.promptsPerTarget ?? prompts.length ?? '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requested targets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!targets.length ? (
              <div className="text-sm text-slate-500">No targets snapshot available.</div>
            ) : (
              targets.map((target: any, idx: number) => (
                <div key={idx} className="rounded-xl bg-slate-950/40 p-3 text-sm">
                  <div className="text-xs text-slate-500">Target #{idx + 1}</div>
                  <div className="mt-1 text-white">
                    {target.type}: {target.id}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prompts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!prompts.length ? (
              <div className="text-sm text-slate-500">No prompts snapshot available.</div>
            ) : (
              prompts.map((prompt: string, idx: number) => (
                <div key={idx} className="rounded-xl bg-slate-950/40 p-3 text-sm text-slate-200">
                  <div className="mb-2 text-xs text-slate-500">Prompt #{idx + 1}</div>
                  <div className="whitespace-pre-wrap">{prompt}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <div className="text-sm text-slate-500">Loading summary…</div>
          ) : summaryQuery.error ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
              {(summaryQuery.error as Error).message}
            </div>
          ) : summaryQuery.data?.targetSummaries?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="pb-3 pr-4">Target</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Provider</th>
                    <th className="pb-3 pr-4">OK</th>
                    <th className="pb-3 pr-4">Failed</th>
                    <th className="pb-3 pr-4">Avg duration</th>
                    <th className="pb-3 pr-4">Avg completion tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryQuery.data.targetSummaries.map((row: any, idx: number) => (
                    <tr key={idx} className="border-t border-slate-800 align-top">
                      <td className="py-3 pr-4 text-white">{row.target?.label || row.target?.id || '—'}</td>
                      <td className="py-3 pr-4 text-slate-300">{row.target?.type || '—'}</td>
                      <td className="py-3 pr-4 text-slate-300">{row.provider || '—'}</td>
                      <td className="py-3 pr-4 text-emerald-300">{row.okCount ?? '—'}</td>
                      <td className="py-3 pr-4 text-rose-300">{row.failedCount ?? '—'}</td>
                      <td className="py-3 pr-4 text-slate-300">
                        {typeof row.avgDurationSec === 'number' ? `${row.avgDurationSec.toFixed(3)}s` : '—'}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {typeof row.avgCompletionTokens === 'number'
                          ? row.avgCompletionTokens.toFixed(3)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-500">No summary yet.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detailed results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {resultQuery.isLoading ? (
            <div className="text-sm text-slate-500">Loading results…</div>
          ) : resultQuery.error ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
              {(resultQuery.error as Error).message}
            </div>
          ) : resultQuery.data?.length ? (
            resultQuery.data.map((targetResult: any, targetIdx: number) => (
              <div
                key={targetIdx}
                className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"
              >
                <div className="mb-4">
                  <div className="text-lg font-semibold text-white">
                    {targetResult.target?.label || targetResult.target?.id || `Target ${targetIdx + 1}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {targetResult.target?.type} · provider {targetResult.runtime?.provider || '—'}
                  </div>
                </div>

                <div className="space-y-4">
                  {(targetResult.results || []).map((row: any, rowIdx: number) => (
                    <div key={rowIdx} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
                          Prompt #{rowIdx + 1}
                        </span>
                        <span
                          className={`rounded-full px-2 py-1 ${
                            row.ok
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {row.ok ? 'ok' : 'failed'}
                        </span>
                        <span className="text-slate-500">
                          {typeof row.durationSec === 'number' ? `${row.durationSec.toFixed(3)}s` : '—'}
                        </span>
                      </div>

                      <div className="mb-3 rounded-xl bg-slate-950/60 p-3">
                        <div className="mb-2 text-xs text-slate-500">Prompt</div>
                        <div className="whitespace-pre-wrap text-sm text-slate-200">{row.prompt}</div>
                      </div>

                      {row.ok ? (
                        <div className="rounded-xl bg-slate-950/60 p-3">
                          <div className="mb-2 text-xs text-slate-500">Response</div>
                          <ResponseRenderer content={row.response?.content || ''} />
                        </div>
                      ) : (
                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
                          {row.error || 'Unknown comparison error'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-slate-500">No detailed results yet.</div>
          )}
        </CardContent>
      </Card>

      {job.error ? (
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader>
            <CardTitle>Job error</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-rose-500/20 bg-slate-950/60 p-3 text-sm text-rose-200">
              {job.error}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
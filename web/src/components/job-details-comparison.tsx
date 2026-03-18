import { useQuery } from '@tanstack/react-query';
import type { Job } from '../lib/api';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ResponseRenderer } from './response-renderer';
import { Button } from './ui/button';

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function isNotFoundError(error: unknown) {
  const message = String((error as Error)?.message || '').toLowerCase();
  return message.includes('not found') || message.includes('404');
}

function truncateText(value: unknown, max = 140) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function CompactStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl bg-slate-950/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function escapeCsvCell(value: unknown) {
  const text = String(value ?? '');
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const csv = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export function JobDetailsComparison({ job }: { job: Job }) {
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isStopped = job.status === 'stopped';

  const summaryQuery = useQuery({
    queryKey: ['comparison-summary', job.id],
    queryFn: () => api.getComparisonSummary(job.id),
    enabled: !!job.id && isCompleted,
    refetchInterval: false,
    retry: false,
  });

  const resultQuery = useQuery({
    queryKey: ['comparison-result', job.id],
    queryFn: () => api.getComparisonResult(job.id),
    enabled: !!job.id && isCompleted,
    refetchInterval: false,
    retry: false,
  });

  const prompts = Array.isArray(job.paramsSnapshot?.prompts) ? job.paramsSnapshot.prompts : [];
  const targets = Array.isArray(job.paramsSnapshot?.targets) ? job.paramsSnapshot.targets : [];

  function exportSummaryCsv() {
    const items = summaryQuery.data?.targetSummaries || [];
    if (!items.length) return;

    downloadCsv(
      `comparison-summary-${job.id}.csv`,
      [
        'target_label',
        'target_id',
        'target_type',
        'provider',
        'ok_count',
        'failed_count',
        'avg_duration_sec',
        'avg_completion_tokens',
      ],
      items.map((row: any) => [
        row.target?.label || '',
        row.target?.id || '',
        row.target?.type || '',
        row.provider || '',
        row.okCount ?? '',
        row.failedCount ?? '',
        row.avgDurationSec ?? '',
        row.avgCompletionTokens ?? '',
      ]),
    );
  }

  function exportDetailedCsv() {
    const targetResults = resultQuery.data || [];
    if (!targetResults.length) return;

    const rows: Array<Array<unknown>> = [];

    for (const targetResult of targetResults as any[]) {
      const targetLabel = targetResult.target?.label || '';
      const targetId = targetResult.target?.id || '';
      const targetType = targetResult.target?.type || '';
      const provider = targetResult.runtime?.provider || '';

      for (const row of targetResult.results || []) {
        rows.push([
          targetLabel,
          targetId,
          targetType,
          provider,
          row.ok ? 'ok' : 'failed',
          row.durationSec ?? '',
          row.prompt ?? '',
          row.response?.content ?? '',
          row.error ?? '',
          row.response?.usage?.prompt_tokens ?? '',
          row.response?.usage?.completion_tokens ?? '',
          row.response?.usage?.total_tokens ?? '',
        ]);
      }
    }

    downloadCsv(
      `comparison-detailed-${job.id}.csv`,
      [
        'target_label',
        'target_id',
        'target_type',
        'provider',
        'status',
        'duration_sec',
        'prompt',
        'response',
        'error',
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
      ],
      rows,
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-indigo-500/20 bg-indigo-500/5">
        <CardHeader>
          <CardTitle>Model Comparison Job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CompactStat label="Created" value={fmtDate(job.createdAt)} />
            <CompactStat label="Finished" value={fmtDate(job.finishedAt)} />
            <CompactStat
              label="Targets"
              value={job.summaryMetrics?.targets ?? targets.length ?? '—'}
            />
            <CompactStat
              label="Prompts / target"
              value={job.summaryMetrics?.promptsPerTarget ?? prompts.length ?? '—'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl bg-slate-950/30 p-3">
              <div className="mb-2 text-xs font-medium text-slate-400">Requested targets</div>
              {!targets.length ? (
                <div className="text-sm text-slate-500">No targets snapshot available.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-500">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">Type</th>
                        <th className="pb-2 pr-4 font-medium">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.map((target: any, idx: number) => (
                        <tr key={idx} className="border-t border-slate-800/70">
                          <td className="py-2 pr-4 text-slate-300">{target.type || '—'}</td>
                          <td className="py-2 pr-4 text-white">{target.id || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-950/30 p-3">
              <div className="mb-2 text-xs font-medium text-slate-400">Prompts</div>
              {!prompts.length ? (
                <div className="text-sm text-slate-500">No prompts snapshot available.</div>
              ) : (
                <div className="max-h-[260px] overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-500">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">#</th>
                        <th className="pb-2 pr-4 font-medium">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prompts.map((prompt: string, idx: number) => (
                        <tr key={idx} className="border-t border-slate-800/70 align-top">
                          <td className="py-2 pr-4 text-slate-500">{idx + 1}</td>
                          <td className="py-2 pr-4 text-slate-200 whitespace-pre-wrap">
                            {truncateText(prompt, 180)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Summary</CardTitle>
          <Button
            onClick={exportSummaryCsv}
            disabled={!summaryQuery.data?.targetSummaries?.length}
            className="bg-slate-800 hover:bg-slate-700"
          >
            Export summary CSV
          </Button>
        </CardHeader>
        <CardContent>
          {!isCompleted ? (
            <div className="text-sm text-slate-500">
              {isFailed || isStopped
                ? 'Summary is unavailable because the comparison job did not complete.'
                : 'Summary will appear after the comparison job is completed.'}
            </div>
          ) : summaryQuery.isLoading ? (
            <div className="text-sm text-slate-500">Loading summary…</div>
          ) : summaryQuery.error ? (
            isNotFoundError(summaryQuery.error) ? (
              <div className="text-sm text-slate-500">Summary is not available yet.</div>
            ) : (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
                {(summaryQuery.error as Error).message}
              </div>
            )
          ) : summaryQuery.data?.targetSummaries?.length ? (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Target</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">OK</th>
                    <th className="px-3 py-2 font-medium">Failed</th>
                    <th className="px-3 py-2 font-medium">Avg duration</th>
                    <th className="px-3 py-2 font-medium">Avg tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryQuery.data.targetSummaries.map((row: any, idx: number) => (
                    <tr key={idx} className="border-t border-slate-800 align-top">
                      <td className="px-3 py-2 text-white">
                        {row.target?.label || row.target?.id || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{row.target?.type || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">{row.provider || '—'}</td>
                      <td className="px-3 py-2 text-emerald-300">{row.okCount ?? '—'}</td>
                      <td className="px-3 py-2 text-rose-300">{row.failedCount ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {typeof row.avgDurationSec === 'number'
                          ? `${row.avgDurationSec.toFixed(3)}s`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {typeof row.avgCompletionTokens === 'number'
                          ? row.avgCompletionTokens.toFixed(2)
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Detailed results</CardTitle>
          <Button
            onClick={exportDetailedCsv}
            disabled={!resultQuery.data?.length}
            className="bg-slate-800 hover:bg-slate-700"
          >
            Export detailed CSV
          </Button>
        </CardHeader>
        <CardContent>
          {!isCompleted ? (
            <div className="text-sm text-slate-500">
              {isFailed || isStopped
                ? 'Detailed results are unavailable because the comparison job did not complete.'
                : 'Detailed results will appear after the comparison job is completed.'}
            </div>
          ) : resultQuery.isLoading ? (
            <div className="text-sm text-slate-500">Loading results…</div>
          ) : resultQuery.error ? (
            isNotFoundError(resultQuery.error) ? (
              <div className="text-sm text-slate-500">Detailed results are not available yet.</div>
            ) : (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
                {(resultQuery.error as Error).message}
              </div>
            )
          ) : resultQuery.data?.length ? (
            <div className="space-y-4">
              {resultQuery.data.map((targetResult: any, targetIdx: number) => (
                <div
                  key={targetIdx}
                  className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/20"
                >
                  <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-3">
                    <div className="text-sm font-semibold text-white">
                      {targetResult.target?.label ||
                        targetResult.target?.id ||
                        `Target ${targetIdx + 1}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {targetResult.target?.type || '—'} · provider{' '}
                      {targetResult.runtime?.provider || '—'}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">#</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Duration</th>
                          <th className="px-3 py-2 font-medium">Prompt</th>
                          <th className="px-3 py-2 font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(targetResult.results || []).map((row: any, rowIdx: number) => (
                          <tr key={rowIdx} className="border-t border-slate-800 align-top">
                            <td className="px-3 py-2 text-slate-500">{rowIdx + 1}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-xs ${
                                  row.ok
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {row.ok ? 'ok' : 'failed'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {typeof row.durationSec === 'number'
                                ? `${row.durationSec.toFixed(3)}s`
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-200 whitespace-pre-wrap">
                              <details>
                                <summary className="cursor-pointer text-slate-300 hover:text-white">
                                  {truncateText(row.prompt, 120)}
                                </summary>
                                <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-950/70 p-3 text-xs text-slate-300">
                                  {row.prompt}
                                </div>
                              </details>
                            </td>
                            <td className="px-3 py-2">
                              {row.ok ? (
                                <details>
                                  <summary className="cursor-pointer text-slate-300 hover:text-white">
                                    {truncateText(row.response?.content || '', 140) || 'Open response'}
                                  </summary>
                                  <div className="mt-3 rounded-lg bg-slate-950/70 p-3">
                                    <ResponseRenderer content={row.response?.content || ''} />
                                  </div>
                                </details>
                              ) : (
                                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
                                  {row.error || 'Unknown comparison error'}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
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
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiBase } from '../../lib/api';
import { formatSize } from '../../utils';

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
        props.disabled
          ? 'cursor-not-allowed bg-slate-800 text-slate-500'
          : 'bg-blue-600 text-white hover:bg-blue-500'
      } ${props.className || ''}`}
    />
  );
}

function StatusBadge({ value }: { value?: string | null }) {
  const tone =
    value === 'completed'
      ? 'bg-emerald-500/15 text-emerald-300'
      : value === 'running'
      ? 'bg-blue-500/15 text-blue-300'
      : value === 'failed'
      ? 'bg-rose-500/15 text-rose-300'
      : value === 'stopped'
      ? 'bg-amber-500/15 text-amber-300'
      : 'bg-slate-500/15 text-slate-300';

  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{value || 'unknown'}</span>;
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function JobsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: api.getJobs,
    refetchInterval: 3000,
  });

  const lorasQuery = useQuery({
    queryKey: ['loras'],
    queryFn: api.getLoras,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!selectedId && jobsQuery.data?.[0]?.id) {
      setSelectedId(jobsQuery.data[0].id);
    }
  }, [jobsQuery.data, selectedId]);

  const jobQuery = useQuery({
    queryKey: ['job', selectedId],
    queryFn: () => api.getJob(selectedId as string),
    enabled: Boolean(selectedId),
    refetchInterval: 3000,
  });

  const metadataMutation = useMutation({
    mutationFn: (payload: { tags?: string[]; notes?: string }) =>
      api.updateJobMetadata(selectedId as string, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', selectedId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const logsQuery = useQuery({
    queryKey: ['job-logs', selectedId],
    queryFn: () => api.getJobLogs(selectedId as string, 300),
    enabled: Boolean(selectedId),
    refetchInterval: 3000,
  });

  const stopMutation = useMutation({
    mutationFn: api.stopJob,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['jobs'] });
      await qc.invalidateQueries({ queryKey: ['job', selectedId] });
      await qc.invalidateQueries({ queryKey: ['job-logs', selectedId] });
    },
  });

  const useOutputMutation = useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api.useJobOutput(jobId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['runtime'] });
      await qc.invalidateQueries({ queryKey: ['runtime-health'] });
      await qc.invalidateQueries({ queryKey: ['loras'] });
      navigate('/app/runtime');
    },
  });

  const registerLoraMutation = useMutation({
    mutationFn: ({ jobId, name }: { jobId: string; name?: string }) => api.registerLoraFromJob({ jobId, name }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const jobs = useMemo(
    () => [...(jobsQuery.data || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [jobsQuery.data],
  );

  const selectedLora = useMemo(() => {
    if (!jobQuery.data) return null;
    return (lorasQuery.data || []).find((x) => x.jobId === jobQuery.data?.id) || null;
  }, [lorasQuery.data, jobQuery.data]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 5)
    );
  };

  const compareJobs = useMemo(() => {
    return jobs.filter((j) => compareIds.includes(j.id));
  }, [jobs, compareIds]);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const sortedCompareJobs = useMemo(() => {
    if (!sortConfig) return compareJobs;
    const sorted = [...compareJobs].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.key) {
        case 'loss':
          aValue = a.summaryMetrics?.final_loss ?? Infinity;
          bValue = b.summaryMetrics?.final_loss ?? Infinity;
          break;
        case 'duration':
          // Simplified duration comparison if possible, or just string compare
          aValue = a.summaryMetrics?.duration_human ?? '';
          bValue = b.summaryMetrics?.duration_human ?? '';
          break;
        case 'epochs':
          aValue = a.qlora?.numTrainEpochs ?? 0;
          bValue = b.qlora?.numTrainEpochs ?? 0;
          break;
        case 'lr':
          aValue = a.qlora?.learningRate ?? 0;
          bValue = b.qlora?.learningRate ?? 0;
          break;
        case 'size':
          aValue = (lorasQuery.data || []).find(l => l.jobId === a.id)?.size ?? 0;
          bValue = (lorasQuery.data || []).find(l => l.jobId === b.id)?.size ?? 0;
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        default:
          aValue = (a as any)[sortConfig.key];
          bValue = (b as any)[sortConfig.key];
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [compareJobs, sortConfig, lorasQuery.data]);

  const bestRunId = useMemo(() => {
    const completed = compareJobs.filter(j => j.status === 'completed' && j.summaryMetrics?.final_loss);
    if (completed.length === 0) return null;
    return completed.reduce((prev, curr) =>
      (curr.summaryMetrics!.final_loss! < prev.summaryMetrics!.final_loss!) ? curr : prev
    ).id;
  }, [compareJobs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Jobs</h1>
        <p className="mt-1 text-sm text-slate-400">
          Следи за обучением, смотри логи, регистрируй LoRA и запускай готовый результат на инференс.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">All jobs</div>
            {compareIds.length >= 2 && (
              <Button
                onClick={() => setIsComparing(true)}
                className="h-7 px-2 py-0 text-xs bg-emerald-600 hover:bg-emerald-500"
              >
                Compare ({compareIds.length})
              </Button>
            )}
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto">
            {jobsQuery.isLoading ? (
              <div className="text-sm text-slate-500">Loading…</div>
            ) : !jobs.length ? (
              <div className="text-sm text-slate-500">No jobs yet.</div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className={`relative flex items-center gap-2 w-full rounded-2xl border p-3 text-left transition ${
                    selectedId === job.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-slate-800 bg-slate-950/30 hover:border-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={compareIds.includes(job.id)}
                    onChange={() => toggleCompare(job.id)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                  <button
                    onClick={() => setSelectedId(job.id)}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{job.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{job.id}</div>
                      </div>
                      <StatusBadge value={job.status} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{fmtDate(job.createdAt)}</div>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          {isComparing ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Comparison Matrix</h2>
                  <p className="text-sm text-slate-400">Comparing {compareJobs.length} training runs</p>
                </div>
                <Button onClick={() => setIsComparing(false)} className="bg-slate-800 hover:bg-slate-700">
                  Back to Details
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="pb-3 pr-4 font-medium">Metric / Param</th>
                      {sortedCompareJobs.map(job => (
                        <th key={job.id} className="pb-3 pr-4 font-medium min-w-[150px]">
                          <div className="flex flex-col">
                            <span className="text-white">{job.name}</span>
                            <span className="text-[10px] text-slate-600 font-mono">{job.id.slice(0, 8)}</span>
                            {job.id === bestRunId && (
                              <span className="mt-1 inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400 font-bold uppercase w-fit">
                                Best
                              </span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-3 pr-4 text-slate-400">Dataset</td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.datasetId}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-3 pr-4 text-slate-400">Base Model</td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4 text-xs text-slate-300 max-w-[200px] truncate" title={job.baseModel}>
                          {job.baseModel.split('/').pop()}
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() => setSortConfig({ key: 'status', direction: sortConfig?.key === 'status' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                      >
                        Status {sortConfig?.key === 'status' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4"><StatusBadge value={job.status} /></td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20 border-t border-slate-800/50">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() => setSortConfig({ key: 'epochs', direction: sortConfig?.key === 'epochs' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                      >
                        Epochs {sortConfig?.key === 'epochs' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.qlora?.numTrainEpochs ?? '—'}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() => setSortConfig({ key: 'lr', direction: sortConfig?.key === 'lr' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                      >
                        LR {sortConfig?.key === 'lr' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.qlora?.learningRate?.toExponential(2) ?? '—'}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-3 pr-4 text-slate-400">LoRA r/alpha/drop</td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4 text-white">
                          {job.qlora?.loraR ?? '—'} / {job.qlora?.loraAlpha ?? '—'} / {job.qlora?.loraDropout ?? '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className={`hover:bg-slate-800/20 border-t border-slate-800/50 ${sortConfig?.key === 'loss' ? 'bg-blue-500/5' : ''}`}>
                      <td
                        className="py-3 pr-4 font-semibold text-emerald-400 cursor-pointer flex items-center gap-1"
                        onClick={() => setSortConfig({ key: 'loss', direction: sortConfig?.key === 'loss' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                      >
                        Final Loss {sortConfig?.key === 'loss' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className={`py-3 pr-4 font-mono text-lg ${job.id === bestRunId ? 'text-emerald-400 underline decoration-double' : 'text-white'}`}>
                          {job.summaryMetrics?.final_loss?.toFixed(4) ?? '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() => setSortConfig({ key: 'duration', direction: sortConfig?.key === 'duration' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                      >
                        Duration {sortConfig?.key === 'duration' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map(job => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.summaryMetrics?.duration_human ?? '—'}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() => setSortConfig({ key: 'size', direction: sortConfig?.key === 'size' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                      >
                        Adapter Size {sortConfig?.key === 'size' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map(job => {
                        const lora = (lorasQuery.data || []).find(l => l.jobId === job.id);
                        return (
                          <td key={job.id} className="py-3 pr-4 text-white">
                            {lora ? formatSize(lora.size || 0) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                {!jobQuery.data ? (
                  <div className="text-sm text-slate-500">Select a job to view details.</div>
                ) : (
                  <>
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-white">{jobQuery.data.name}</h2>
                        <div className="mt-1 text-xs text-slate-500">{jobQuery.data.id}</div>
                      </div>
                      <StatusBadge value={jobQuery.data.status} />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-500">Base model path / ref</div>
                        <div className="mt-1 break-all text-sm text-white">{jobQuery.data.baseModel}</div>
                      </div>

                      <div className="rounded-xl bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-500">Model id</div>
                        <div className="mt-1 text-sm text-white">{jobQuery.data.modelId || 'manual / external model'}</div>
                      </div>

                      <div className="rounded-xl bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-500">Dataset</div>
                        <div className="mt-1 text-sm text-white">{jobQuery.data.datasetId}</div>
                      </div>

                      <div className="rounded-xl bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-500">Created</div>
                        <div className="mt-1 text-sm text-white">{fmtDate(jobQuery.data.createdAt)}</div>
                      </div>

                      <div className="rounded-xl bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-500">Started</div>
                        <div className="mt-1 text-sm text-white">{fmtDate(jobQuery.data.startedAt)}</div>
                      </div>

                      <div className="rounded-xl bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-500">Finished</div>
                        <div className="mt-1 text-sm text-white">{fmtDate(jobQuery.data.finishedAt)}</div>
                      </div>

                      <div className="rounded-xl bg-slate-950/40 p-3 md:col-span-2">
                        <div className="text-xs text-slate-500">Output dir</div>
                        <div className="mt-1 break-all text-sm text-white">{jobQuery.data.outputDir}</div>
                      </div>
                    </div>

                    {jobQuery.data.summaryMetrics && (
                      <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                        <div className="text-sm font-medium text-emerald-400">Summary Results</div>
                        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">Final Loss</div>
                            <div className="text-lg font-semibold text-white">
                              {jobQuery.data.summaryMetrics.final_loss?.toFixed(4) || '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">Duration</div>
                            <div className="text-lg font-semibold text-white">
                              {jobQuery.data.summaryMetrics.duration_human || '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">Rows Used</div>
                            <div className="text-lg font-semibold text-white">{jobQuery.data.summaryMetrics.rows || '—'}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">Precision</div>
                            <div className="text-lg font-semibold text-white">
                              {jobQuery.data.summaryMetrics.bf16 ? 'BF16' : jobQuery.data.summaryMetrics.fp16 ? 'FP16' : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                        <div className="text-sm font-medium text-white">Environment & Snapshots</div>
                        <div className="mt-3 space-y-2">
                          {jobQuery.data.envSnapshot && (
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-500">Env:</span>
                              <span className="text-slate-300">
                                Python {jobQuery.data.envSnapshot.python}, Torch {jobQuery.data.envSnapshot.torch}
                              </span>
                            </div>
                          )}
                          {jobQuery.data.datasetSnapshot && (
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-500">Dataset:</span>
                              <span className="text-slate-300" title={jobQuery.data.datasetSnapshot.path}>
                                {formatSize(jobQuery.data.datasetSnapshot.size)} (
                                {jobQuery.data.datasetSnapshot.hash?.slice(0, 8) || 'no hash'})
                              </span>
                            </div>
                          )}
                          {jobQuery.data.modelSnapshot && (
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-500">Base Model:</span>
                              <span className="text-slate-300">
                                {jobQuery.data.modelSnapshot.quantization || 'none'} /{' '}
                                {jobQuery.data.modelSnapshot.sizeHuman || 'unknown size'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                        <div className="text-sm font-medium text-white">Metadata & Tags</div>
                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="mb-1 text-[10px] uppercase text-slate-500">Tags</div>
                            <div className="flex flex-wrap gap-1">
                              {jobQuery.data.tags?.map((tag: string) => (
                                <span
                                  key={tag}
                                  className="group flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400"
                                >
                                  {tag}
                                  <button
                                    onClick={() =>
                                      metadataMutation.mutate({
                                        tags: jobQuery.data.tags?.filter((t: string) => t !== tag),
                                      })
                                    }
                                    className="opacity-50 hover:text-white hover:opacity-100"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              <input
                                type="text"
                                placeholder="+ tag"
                                className="w-16 bg-transparent text-[10px] text-white outline-none placeholder:text-slate-600"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const val = (e.target as HTMLInputElement).value.trim();
                                    if (val && !jobQuery.data.tags?.includes(val)) {
                                      metadataMutation.mutate({ tags: [...(jobQuery.data.tags || []), val] });
                                      (e.target as HTMLInputElement).value = '';
                                    }
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="mb-1 text-[10px] uppercase text-slate-500">Notes</div>
                            <textarea
                              className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                              rows={2}
                              placeholder="Add notes..."
                              defaultValue={jobQuery.data.notes || ''}
                              onBlur={(e) => {
                                if (e.target.value !== (jobQuery.data?.notes || '')) {
                                  metadataMutation.mutate({ notes: e.target.value });
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-white">Artifacts</div>
                        <div className="text-xs text-slate-500">
                          {jobQuery.data.artifacts?.length || 0} files in output directory
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={`${apiBase}/jobs/${jobQuery.data.id}/artifacts/metrics`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Download Metrics
                        </a>
                        <a
                          href={`${apiBase}/jobs/${jobQuery.data.id}/artifacts/logs`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Download Logs
                        </a>
                        <a
                          href={`${apiBase}/jobs/${jobQuery.data.id}/artifacts/wandb`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Download W&B Run (.tar.gz)
                        </a>
                      </div>
                      {jobQuery.data.artifacts && jobQuery.data.artifacts.length > 0 && (
                        <div className="mt-3 max-h-32 overflow-y-auto rounded-xl bg-slate-950/50 p-2 text-[10px]">
                          {jobQuery.data.artifacts.map((art: any, idx: number) => (
                            <div key={idx} className="flex justify-between border-b border-slate-800 py-1 last:border-0">
                              <span className="text-slate-400">{art.name}</span>
                              <span className="text-slate-600">{formatSize(art.size)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                      <div className="text-sm font-medium text-white">LoRA status</div>

                      {selectedLora ? (
                        <div className="mt-3 space-y-2">
                          <div className="text-sm text-slate-300">
                            Registered as LoRA: <span className="text-white">{selectedLora.name}</span>
                          </div>
                          <div className="text-xs text-slate-500">Base model: {selectedLora.baseModelName}</div>
                          <div className="text-xs text-slate-500">
                            Runtime from this job will use merged LoRA automatically.
                          </div>
                          <div className="flex flex-wrap gap-2 pt-2">
                            <Link
                              to="/app/loras"
                              className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                            >
                              Open LoRAs
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          <div className="text-sm text-slate-400">
                            Для completed job LoRA обычно регистрируется автоматически. Если нет — можно зарегистрировать вручную.
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => registerLoraMutation.mutate({ jobId: jobQuery.data!.id, name: jobQuery.data!.name })}
                              disabled={jobQuery.data.status !== 'completed' || registerLoraMutation.isPending}
                              className="bg-slate-800 hover:bg-slate-700"
                            >
                              Register LoRA
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {jobQuery.data.error && (
                      <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">
                        {jobQuery.data.error}
                      </div>
                    )}

                    {useOutputMutation.error ? (
                      <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">
                        {(useOutputMutation.error as Error).message}
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap gap-3">
                      <Button
                        onClick={() => stopMutation.mutate(jobQuery.data.id)}
                        disabled={jobQuery.data.status !== 'running' || stopMutation.isPending}
                        className="bg-rose-700 hover:bg-rose-600"
                      >
                        Stop
                      </Button>

                      <Button
                        onClick={() => useOutputMutation.mutate({ jobId: jobQuery.data.id })}
                        disabled={jobQuery.data.status !== 'completed' || useOutputMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-500"
                      >
                        {useOutputMutation.isPending ? 'Preparing runtime…' : 'Use in runtime'}
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="mb-3 text-sm font-semibold text-white">Logs</div>
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">
                  {logsQuery.data?.content || 'No logs yet'}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
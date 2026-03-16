import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiBase, type Job } from '../../lib/api';
import { formatSize } from '../../utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { JobTypeBadge } from '../../components/job-type-badge';
import { JobDetailsFineTune } from '../../components/job-details-fine-tune';
import { JobDetailsSynthetic } from '../../components/job-details-synthetic';
import { JobDetailsQuantize } from '../../components/job-details-quantize';

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

function JobListCard({
  job,
  selected,
  checked,
  onClick,
  onToggleCompare,
}: {
  job: Job;
  selected: boolean;
  checked: boolean;
  onClick: () => void;
  onToggleCompare: () => void;
}) {
  const isSynthetic = job.type === 'synthetic-gen';

  return (
    <div
      className={`relative flex items-center gap-2 w-full rounded-2xl border p-3 text-left transition ${
        selected
          ? isSynthetic
            ? 'border-cyan-500 bg-cyan-500/10'
            : 'border-purple-500 bg-purple-500/10'
          : 'border-slate-800 bg-slate-950/30 hover:border-slate-700'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCompare}
        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600"
      />

      <button onClick={onClick} className="flex-1 text-left min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-white">{job.name}</div>
              <JobTypeBadge type={job.type} />
            </div>

            <div className="mt-1 text-xs text-slate-500">{job.id}</div>

            {isSynthetic ? (
              <div className="mt-2 text-xs text-slate-400">
                Step: {job.syntheticMeta?.progressStep || job.progressStep || '—'}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-400 break-all">{job.baseModel || '—'}</div>
            )}
          </div>

          <StatusBadge value={job.status} />
        </div>

        <div className="mt-2 text-xs text-slate-500">{fmtDate(job.createdAt)}</div>
      </button>
    </div>
  );
}

export default function JobsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

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

  const selectedJob = jobQuery.data;
  const isSynthetic = selectedJob?.type === 'synthetic-gen';
  const isQuantize = selectedJob?.type === 'model-quantize';

  const selectedLora = useMemo(() => {
    if (!selectedJob) return null;
    return (lorasQuery.data || []).find((x) => x.jobId === selectedJob.id) || null;
  }, [lorasQuery.data, selectedJob]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 5),
    );
  };

  const compareJobs = useMemo(() => {
    return jobs.filter((j) => compareIds.includes(j.id));
  }, [jobs, compareIds]);

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
          aValue = (lorasQuery.data || []).find((l) => l.jobId === a.id)?.size ?? 0;
          bValue = (lorasQuery.data || []).find((l) => l.jobId === b.id)?.size ?? 0;
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
    const completed = compareJobs.filter((j) => j.status === 'completed' && j.summaryMetrics?.final_loss !== undefined);
    if (completed.length === 0) return null;

    return completed.reduce((prev, curr) =>
      (curr.summaryMetrics!.final_loss! < prev.summaryMetrics!.final_loss!) ? curr : prev,
    ).id;
  }, [compareJobs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Jobs</h1>
        <p className="mt-1 text-sm text-slate-400">
          Обучение и создание synthetic datasets теперь показываются по-разному и с отдельной детализацией.
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
                <JobListCard
                  key={job.id}
                  job={job}
                  selected={selectedId === job.id}
                  checked={compareIds.includes(job.id)}
                  onClick={() => setSelectedId(job.id)}
                  onToggleCompare={() => toggleCompare(job.id)}
                />
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
                      {sortedCompareJobs.map((job) => (
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
                      {sortedCompareJobs.map((job) => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.datasetId}</td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20">
                      <td className="py-3 pr-4 text-slate-400">Base Model</td>
                      {sortedCompareJobs.map((job) => (
                        <td
                          key={job.id}
                          className="py-3 pr-4 text-xs text-slate-300 max-w-[200px] truncate"
                          title={job.baseModel}
                        >
                          {job.baseModel?.split('/').pop() || '—'}
                        </td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() =>
                          setSortConfig({
                            key: 'status',
                            direction: sortConfig?.key === 'status' && sortConfig.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        Status {sortConfig?.key === 'status' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map((job) => (
                        <td key={job.id} className="py-3 pr-4"><StatusBadge value={job.status} /></td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20 border-t border-slate-800/50">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() =>
                          setSortConfig({
                            key: 'epochs',
                            direction: sortConfig?.key === 'epochs' && sortConfig.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        Epochs {sortConfig?.key === 'epochs' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map((job) => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.qlora?.numTrainEpochs ?? '—'}</td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() =>
                          setSortConfig({
                            key: 'lr',
                            direction: sortConfig?.key === 'lr' && sortConfig.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        LR {sortConfig?.key === 'lr' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map((job) => (
                        <td key={job.id} className="py-3 pr-4 text-white">
                          {job.qlora?.learningRate?.toExponential(2) ?? '—'}
                        </td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20">
                      <td className="py-3 pr-4 text-slate-400">LoRA r/alpha/drop</td>
                      {sortedCompareJobs.map((job) => (
                        <td key={job.id} className="py-3 pr-4 text-white">
                          {job.qlora?.loraR ?? '—'} / {job.qlora?.loraAlpha ?? '—'} / {job.qlora?.loraDropout ?? '—'}
                        </td>
                      ))}
                    </tr>

                    <tr className={`hover:bg-slate-800/20 border-t border-slate-800/50 ${sortConfig?.key === 'loss' ? 'bg-blue-500/5' : ''}`}>
                      <td
                        className="py-3 pr-4 font-semibold text-emerald-400 cursor-pointer flex items-center gap-1"
                        onClick={() =>
                          setSortConfig({
                            key: 'loss',
                            direction: sortConfig?.key === 'loss' && sortConfig.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        Final Loss {sortConfig?.key === 'loss' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map((job) => (
                        <td
                          key={job.id}
                          className={`py-3 pr-4 font-mono text-lg ${
                            job.id === bestRunId ? 'text-emerald-400 underline decoration-double' : 'text-white'
                          }`}
                        >
                          {job.summaryMetrics?.final_loss?.toFixed(4) ?? '—'}
                        </td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() =>
                          setSortConfig({
                            key: 'duration',
                            direction: sortConfig?.key === 'duration' && sortConfig.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        Duration {sortConfig?.key === 'duration' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map((job) => (
                        <td key={job.id} className="py-3 pr-4 text-white">{job.summaryMetrics?.duration_human ?? '—'}</td>
                      ))}
                    </tr>

                    <tr className="hover:bg-slate-800/20">
                      <td
                        className="py-3 pr-4 text-slate-400 cursor-pointer hover:text-white flex items-center gap-1"
                        onClick={() =>
                          setSortConfig({
                            key: 'size',
                            direction: sortConfig?.key === 'size' && sortConfig.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        Adapter Size {sortConfig?.key === 'size' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                      </td>
                      {sortedCompareJobs.map((job) => {
                        const lora = (lorasQuery.data || []).find((l) => l.jobId === job.id);
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
          ) : null}

          {!isComparing ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {!selectedJob ? (
                      'Job details'
                    ) : (
                      <div className="flex items-center gap-3">
                        <span>{selectedJob.name}</span>
                        <JobTypeBadge type={selectedJob.type} />
                        <StatusBadge value={selectedJob.status} />
                      </div>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!selectedJob ? (
                    <div className="text-sm text-slate-500">Select a job to view details.</div>
                  ) : isSynthetic ? (
                    <JobDetailsSynthetic job={selectedJob} />
                  ) : isQuantize ? (
                    <JobDetailsQuantize job={selectedJob} />
                  ) : (
                    <JobDetailsFineTune job={selectedJob} />
                  )}
                </CardContent>
              </Card>

              {!isSynthetic && !isQuantize && selectedJob ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Metadata & Tags</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <div className="mb-1 text-[10px] uppercase text-slate-500">Tags</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedJob.tags?.map((tag: string) => (
                            <span
                              key={tag}
                              className="group flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400"
                            >
                              {tag}
                              <button
                                onClick={() =>
                                  metadataMutation.mutate({
                                    tags: selectedJob.tags?.filter((t: string) => t !== tag),
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
                                if (val && !selectedJob.tags?.includes(val)) {
                                  metadataMutation.mutate({ tags: [...(selectedJob.tags || []), val] });
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
                          rows={3}
                          placeholder="Add notes..."
                          defaultValue={selectedJob.notes || ''}
                          onBlur={(e) => {
                            if (e.target.value !== (selectedJob.notes || '')) {
                              metadataMutation.mutate({ notes: e.target.value });
                            }
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Artifacts & LoRA</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`${apiBase}/jobs/${selectedJob.id}/artifacts/metrics`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Download Metrics
                        </a>
                        <a
                          href={`${apiBase}/jobs/${selectedJob.id}/artifacts/logs`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Download Logs
                        </a>
                        <a
                          href={`${apiBase}/jobs/${selectedJob.id}/artifacts/wandb`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Download W&B Run
                        </a>
                      </div>

                      {selectedJob.artifacts?.length ? (
                        <div className="max-h-40 overflow-y-auto rounded-xl bg-slate-950/50 p-2 text-[10px]">
                          {selectedJob.artifacts.map((art: any, idx: number) => (
                            <div key={idx} className="flex justify-between border-b border-slate-800 py-1 last:border-0">
                              <span className="text-slate-400">{art.name}</span>
                              <span className="text-slate-600">{formatSize(art.size)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {selectedLora ? (
                        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                          <div className="text-sm text-slate-300">
                            Registered as LoRA: <span className="text-white">{selectedLora.name}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">Base model: {selectedLora.baseModelName}</div>
                          <div className="mt-3">
                            <Link
                              to="/app/loras"
                              className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                            >
                              Open LoRAs
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                          <div className="text-sm text-slate-400">
                            Для completed training job LoRA обычно регистрируется автоматически.
                          </div>
                          <div className="mt-3">
                            <Button
                              onClick={() =>
                                registerLoraMutation.mutate({ jobId: selectedJob.id, name: selectedJob.name })
                              }
                              disabled={selectedJob.status !== 'completed' || registerLoraMutation.isPending}
                              className="bg-slate-800 hover:bg-slate-700"
                            >
                              Register LoRA
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : null}

              {selectedJob ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Logs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">
                      {logsQuery.data?.content || 'No logs yet'}
                    </pre>
                  </CardContent>
                </Card>
              ) : null}

              {selectedJob ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={() => stopMutation.mutate(selectedJob.id)}
                        disabled={selectedJob.status !== 'running' || stopMutation.isPending}
                        className="bg-rose-700 hover:bg-rose-600"
                      >
                        Stop
                      </Button>

                      <Button
                        onClick={() => useOutputMutation.mutate({ jobId: selectedJob.id })}
                        disabled={
                          selectedJob.status !== 'completed' ||
                          isSynthetic ||
                          isQuantize ||
                          useOutputMutation.isPending
                        }
                        className="bg-emerald-600 hover:bg-emerald-500"
                      >
                        {useOutputMutation.isPending ? 'Preparing runtime…' : 'Use in runtime'}
                      </Button>
                    </div>

                    {selectedJob.error ? (
                      <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">
                        {selectedJob.error}
                      </div>
                    ) : null}

                    {useOutputMutation.error ? (
                      <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">
                        {(useOutputMutation.error as Error).message}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
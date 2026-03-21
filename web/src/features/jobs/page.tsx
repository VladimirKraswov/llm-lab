import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiBase, type Job } from '../../lib/api';
import { formatSize } from '../../utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { JobTypeBadge } from '../../components/job-type-badge';
import { JobDetailsFineTune } from '../../components/job-details-fine-tune';
import { JobDetailsSynthetic } from '../../components/job-details-synthetic';
import { JobDetailsQuantize } from '../../components/job-details-quantize';
import { JobDetailsComparison } from '../../components/job-details-comparison';
import { JobDetailsEval } from '../../components/job-details-eval';
import { PageHeader } from '../../components/page-header';
import { cn } from '../../lib/utils';
import { CopyButton } from '../../components/copy-button';
import { LaunchBundleCard } from '../../components/launch-bundle-card';
import { RemoteLogViewer } from '../../components/remote-log-viewer';
import { ExternalLink } from 'lucide-react';

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) {
  return (
    <button
      {...props}
      className={cn(
        'rounded-xl px-4 py-2 text-sm font-medium transition',
        props.disabled ? 'cursor-not-allowed bg-slate-800 text-slate-500' : 'bg-blue-600 text-white hover:bg-blue-500',
        props.size === 'sm' && 'rounded-lg px-2 py-1 text-[10px]',
        props.className,
      )}
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
  const isComparison = job.type === 'model-comparison';
  const isRemote = job.mode === 'remote';

  return (
    <div className={selected ? 'relative flex items-center gap-2 rounded-2xl border border-blue-500 bg-blue-500/10 p-3 text-left' : 'relative flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/30 p-3 text-left hover:border-slate-700'}>
      <input type="checkbox" checked={checked} onChange={onToggleCompare} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-white">{job.name}</div>
              <JobTypeBadge type={job.type} />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{job.id}</span>
              <CopyButton text={job.id} className="h-4 w-4 border-none bg-transparent px-0.5 py-0 hover:bg-slate-800" />
            </div>
            {isSynthetic ? (
              <div className="mt-2 text-xs text-slate-400">Step: {job.syntheticMeta?.progressStep || job.progressStep || '—'}</div>
            ) : isComparison ? (
              <div className="mt-2 text-xs text-slate-400">Targets: {job.summaryMetrics?.targets ?? job.paramsSnapshot?.targets?.length ?? '—'}</div>
            ) : (
              <div className="mt-2 truncate text-xs text-slate-400">{job.baseModel || job.runtimePresetTitle || '—'}</div>
            )}
            {isRemote ? (
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                <span className="rounded bg-blue-500/10 px-1 py-0.5 font-bold uppercase text-blue-400">remote</span>
                <span>{job.runtimePresetId || 'legacy image'}</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge value={job.status} />
            {typeof job.progressPercent === 'number' && job.status === 'running' ? <div className="text-[10px] font-bold text-blue-400">{job.progressPercent}%</div> : null}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">{fmtDate(job.createdAt)}</div>
      </button>
    </div>
  );
}

function effectivePipeline(job: Job) {
  return job.paramsSnapshot?.pipeline || job.paramsSnapshot?.effectivePipeline || null;
}

export default function JobsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  useEffect(() => {
    const nextSelected = searchParams.get('selected');
    if (nextSelected) setSelectedId(nextSelected);
  }, [searchParams]);

  const jobsQuery = useQuery({ queryKey: ['jobs'], queryFn: api.getJobs, refetchInterval: 3000 });
  const lorasQuery = useQuery({ queryKey: ['loras'], queryFn: api.getLoras, refetchInterval: 3000 });

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

  const logsQuery = useQuery({
    queryKey: ['job-logs', selectedId],
    queryFn: () => api.getJobLogs(selectedId as string, 400),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId && jobQuery.data?.status === 'running' ? 3000 : false,
  });

  const metadataMutation = useMutation({
    mutationFn: (payload: { tags?: string[]; notes?: string }) => api.updateJobMetadata(selectedId as string, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: api.stopJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['job', selectedId] });
      await queryClient.invalidateQueries({ queryKey: ['job-logs', selectedId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: api.retryJob,
    onSuccess: async (newJob) => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setSelectedId(newJob.id);
      navigate(`/app/jobs?selected=${encodeURIComponent(newJob.id)}`);
    },
  });

  const useOutputMutation = useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api.useJobOutput(jobId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime'] });
      await queryClient.invalidateQueries({ queryKey: ['runtime-health'] });
      await queryClient.invalidateQueries({ queryKey: ['loras'] });
      navigate('/app/runtime');
    },
  });

  const registerLoraMutation = useMutation({
    mutationFn: ({ jobId, name }: { jobId: string; name?: string }) => api.registerLoraFromJob({ jobId, name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const jobs = useMemo(() => [...(jobsQuery.data || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [jobsQuery.data]);
  const selectedJob = jobQuery.data;
  const isSynthetic = selectedJob?.type === 'synthetic-gen';
  const isQuantize = selectedJob?.type === 'model-quantize';
  const isComparison = selectedJob?.type === 'model-comparison';
  const isEval = selectedJob?.type === 'eval-benchmark';

  const selectedLora = useMemo(() => {
    if (!selectedJob) return null;
    return (lorasQuery.data || []).find((item) => item.jobId === selectedJob.id) || null;
  }, [lorasQuery.data, selectedJob]);

  const toggleCompare = (id: string) => {
    setCompareIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 5)));
  };

  const compareJobs = useMemo(() => jobs.filter((job) => compareIds.includes(job.id)), [jobs, compareIds]);

  const sortedCompareJobs = useMemo(() => {
    if (!sortConfig) return compareJobs;
    return [...compareJobs].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.key) {
        case 'loss':
          aValue = a.summaryMetrics?.final_loss ?? Infinity;
          bValue = b.summaryMetrics?.final_loss ?? Infinity;
          break;
        case 'epochs':
          aValue = a.qlora?.numTrainEpochs ?? 0;
          bValue = b.qlora?.numTrainEpochs ?? 0;
          break;
        case 'lr':
          aValue = a.qlora?.learningRate ?? 0;
          bValue = b.qlora?.learningRate ?? 0;
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
  }, [compareJobs, sortConfig]);

  const bestRunId = useMemo(() => {
    const completed = compareJobs.filter((job) => job.status === 'completed' && typeof job.summaryMetrics?.final_loss === 'number');
    if (!completed.length) return null;
    return completed.reduce((best, current) => (current.summaryMetrics!.final_loss! < best.summaryMetrics!.final_loss! ? current : best)).id;
  }, [compareJobs]);

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col overflow-hidden space-y-4">
      <PageHeader title="Jobs & Runs" description="Remote jobs, launch bundles, logs and result snapshots." />

      <div className="grid flex-1 gap-4 overflow-hidden xl:grid-cols-[320px_1fr]">
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">History</div>
            {compareIds.length >= 2 ? (
              <Button onClick={() => setIsComparing(true)} className="h-6 bg-emerald-600 px-2 py-0 text-[10px] hover:bg-emerald-500">
                Compare ({compareIds.length})
              </Button>
            ) : null}
          </div>
          <div className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto p-2">
            {jobsQuery.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : null}
            {!jobsQuery.isLoading && !jobs.length ? <div className="text-sm text-slate-500">No jobs yet.</div> : null}
            {jobs.map((job) => (
              <JobListCard
                key={job.id}
                job={job}
                selected={selectedId === job.id}
                checked={compareIds.includes(job.id)}
                onClick={() => setSelectedId(job.id)}
                onToggleCompare={() => toggleCompare(job.id)}
              />
            ))}
          </div>
        </div>

        <div className="scrollbar-thin min-w-0 overflow-y-auto pr-1">
          {isComparing ? (
            <div className="mb-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900 p-4">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-tight text-white">Comparison Matrix</h2>
                  <p className="text-[10px] text-slate-500">Selected {compareJobs.length} runs</p>
                </div>
                <Button onClick={() => setIsComparing(false)} size="sm" className="h-7 bg-slate-800 text-[10px] hover:bg-slate-700">
                  Close
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 z-10 bg-slate-900 text-slate-500">
                    <tr className="border-b border-slate-800">
                      <th className="min-w-[120px] p-3 font-bold uppercase tracking-wider">Metric / Param</th>
                      {sortedCompareJobs.map((job) => (
                        <th key={job.id} className="min-w-[160px] border-l border-slate-800/50 p-3 font-medium">
                          <div className="flex flex-col">
                            <span className="text-white">{job.name}</span>
                            <span className="font-mono text-[10px] text-slate-600">{job.id.slice(0, 8)}</span>
                            {job.id === bestRunId ? <span className="mt-1 w-fit rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-400">Best</span> : null}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {[
                      ['Dataset', (job: Job) => job.datasetId || '—'],
                      ['Runtime preset', (job: Job) => job.runtimePresetId || 'legacy'],
                      ['Base model', (job: Job) => job.baseModel || '—'],
                      ['Status', (job: Job) => job.status],
                      ['Epochs', (job: Job) => job.qlora?.numTrainEpochs ?? '—'],
                      ['LR', (job: Job) => job.qlora?.learningRate ?? '—'],
                      ['Final loss', (job: Job) => typeof job.summaryMetrics?.final_loss === 'number' ? job.summaryMetrics.final_loss.toFixed(4) : '—'],
                      ['Duration', (job: Job) => job.summaryMetrics?.duration_human || '—'],
                    ].map(([label, getter]) => (
                      <tr key={label} className="hover:bg-white/[0.02]">
                        <td className="p-3 font-medium text-slate-500">{label}</td>
                        {sortedCompareJobs.map((job) => (
                          <td key={`${job.id}:${label}`} className="border-l border-slate-800/50 p-3 text-white">{(getter as (job: Job) => ReactNode)(job)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!isComparing && selectedJob ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <div className="flex flex-wrap items-center gap-3">
                      <span>{selectedJob.name}</span>
                      <div className="flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 px-2 py-0.5">
                        <span className="font-mono text-[10px] text-slate-400">{selectedJob.id}</span>
                        <CopyButton text={selectedJob.id} className="h-4 w-4 border-none bg-transparent px-0.5 py-0 hover:bg-slate-700" />
                      </div>
                      <JobTypeBadge type={selectedJob.type} />
                      <StatusBadge value={selectedJob.status} />
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedJob.mode === 'remote' ? <LaunchBundleCard job={selectedJob} /> : null}

                  {isSynthetic ? <JobDetailsSynthetic job={selectedJob} /> : null}
                  {isQuantize ? <JobDetailsQuantize job={selectedJob} /> : null}
                  {isComparison ? <JobDetailsComparison job={selectedJob} /> : null}
                  {isEval ? <JobDetailsEval job={selectedJob} /> : null}
                  {!isSynthetic && !isQuantize && !isComparison && !isEval ? <JobDetailsFineTune job={selectedJob} /> : null}
                </CardContent>
              </Card>

              {!isSynthetic && !isQuantize && !isComparison && !isEval ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Metadata & pipeline snapshot</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="mb-1 text-[10px] uppercase text-slate-500">Tags</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedJob.tags?.map((tag) => (
                          <span key={tag} className="group flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                            {tag}
                            <button onClick={() => metadataMutation.mutate({ tags: selectedJob.tags?.filter((item) => item !== tag) })} className="opacity-50 hover:text-white hover:opacity-100">×</button>
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="+ tag"
                          className="w-20 bg-transparent text-[10px] text-white outline-none placeholder:text-slate-600"
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            const value = (event.target as HTMLInputElement).value.trim();
                            if (value && !selectedJob.tags?.includes(value)) {
                              metadataMutation.mutate({ tags: [...(selectedJob.tags || []), value] });
                              (event.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] uppercase text-slate-500">Notes</div>
                      <textarea
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 p-2 text-xs text-white outline-none focus:border-blue-500"
                        rows={3}
                        placeholder="Add notes..."
                        defaultValue={selectedJob.notes || ''}
                        onBlur={(event) => {
                          if (event.target.value !== (selectedJob.notes || '')) {
                            metadataMutation.mutate({ notes: event.target.value });
                          }
                        }}
                      />
                    </div>
                    {effectivePipeline(selectedJob) ? (
                      <div>
                        <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">effective pipeline</div>
                        <pre className="max-h-[420px] overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] text-slate-300">{JSON.stringify(effectivePipeline(selectedJob), null, 2)}</pre>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {!isSynthetic && !isQuantize && !isComparison && !isEval ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Artifacts & HF-backed data</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <a href={`${apiBase}/jobs/${selectedJob.id}/artifacts/metrics`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Download metrics</a>
                      <a href={`${apiBase}/jobs/${selectedJob.id}/artifacts/logs`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Download logs</a>
                      <a href={`${apiBase}/jobs/${selectedJob.id}/artifacts/wandb`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Download W&B</a>
                    </div>

                    {(selectedJob.hfRepoIdLora || selectedJob.hfRepoIdMerged || selectedJob.hfRepoIdMetadata) ? (
                      <div className="rounded-xl border border-blue-900/30 bg-blue-950/20 p-3 space-y-2">
                        <div className="text-[10px] font-bold uppercase text-blue-400">Hugging Face repositories</div>
                        <div className="grid gap-2">
                          {selectedJob.hfRepoIdLora ? <a href={`https://huggingface.co/${selectedJob.hfRepoIdLora}`} target="_blank" rel="noreferrer" className="flex items-center justify-between text-xs text-slate-300 hover:text-white"><span>LoRA: {selectedJob.hfRepoIdLora}</span><ExternalLink size={12} /></a> : null}
                          {selectedJob.hfRepoIdMerged ? <a href={`https://huggingface.co/${selectedJob.hfRepoIdMerged}`} target="_blank" rel="noreferrer" className="flex items-center justify-between text-xs text-slate-300 hover:text-white"><span>Merged: {selectedJob.hfRepoIdMerged}</span><ExternalLink size={12} /></a> : null}
                          {selectedJob.hfRepoIdMetadata ? <a href={`https://huggingface.co/${selectedJob.hfRepoIdMetadata}`} target="_blank" rel="noreferrer" className="flex items-center justify-between text-xs text-slate-300 hover:text-white"><span>Metadata: {selectedJob.hfRepoIdMetadata}</span><ExternalLink size={12} /></a> : null}
                        </div>
                      </div>
                    ) : null}

                    {selectedJob.artifacts?.length ? (
                      <div className="max-h-48 overflow-y-auto rounded-xl bg-slate-950/50 p-2 text-[10px]">
                        {selectedJob.artifacts.map((artifact: any, index: number) => (
                          <div key={index} className="flex justify-between border-b border-slate-800 py-1 last:border-0">
                            <span className="text-slate-400">{artifact.name}</span>
                            <span className="text-slate-600">{formatSize(artifact.size)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {selectedLora ? (
                      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                        <div className="text-sm text-slate-300">Registered as LoRA: <span className="text-white">{selectedLora.name}</span></div>
                        <div className="mt-1 text-xs text-slate-500">Base model: {selectedLora.baseModelName}</div>
                        <div className="mt-3">
                          <Link to="/app/loras" className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">Open LoRAs</Link>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                        <div className="text-sm text-slate-400">Completed training job can be registered as LoRA for runtime usage.</div>
                        <div className="mt-3">
                          <Button onClick={() => registerLoraMutation.mutate({ jobId: selectedJob.id, name: selectedJob.name })} disabled={selectedJob.status !== 'completed' || registerLoraMutation.isPending} className="bg-slate-800 hover:bg-slate-700">
                            Register LoRA
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {selectedJob ? (
                <RemoteLogViewer
                  title="Runtime logs"
                  content={logsQuery.data?.content || ''}
                  isLive={selectedJob.status === 'running'}
                  onRefresh={() => logsQuery.refetch()}
                />
              ) : null}

              {selectedJob ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={() => stopMutation.mutate(selectedJob.id)} disabled={selectedJob.status !== 'running' || stopMutation.isPending} className="bg-rose-700 hover:bg-rose-600">Stop</Button>

                      {(selectedJob.status === 'failed' || selectedJob.status === 'stopped') ? (
                        <Button onClick={() => retryMutation.mutate(selectedJob.id)} disabled={retryMutation.isPending} className="bg-amber-600 hover:bg-amber-500">
                          {retryMutation.isPending ? 'Retrying…' : 'Retry as new job'}
                        </Button>
                      ) : null}

                      <Button
                        onClick={() => useOutputMutation.mutate({ jobId: selectedJob.id })}
                        disabled={selectedJob.status !== 'completed' || isSynthetic || isQuantize || isComparison || useOutputMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-500"
                      >
                        {useOutputMutation.isPending ? 'Preparing runtime…' : 'Use in runtime'}
                      </Button>
                    </div>

                    {(selectedJob.status === 'failed' || selectedJob.status === 'stopped') && selectedJob.mode === 'remote' ? (
                      <div className="mt-4 rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">
                        Retry creates a new remote job with the same dataset, runtime preset, image and pipeline snapshot. It does not restart the old job in place.
                      </div>
                    ) : null}

                    {selectedJob.error ? <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">{selectedJob.error}</div> : null}
                    {useOutputMutation.error ? <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">{(useOutputMutation.error as Error).message}</div> : null}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}

          {!isComparing && !selectedJob ? (
            <Card>
              <CardHeader>
                <CardTitle>Job details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-500">Select a job to view details.</div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

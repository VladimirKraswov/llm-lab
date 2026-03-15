import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiBase, type Job } from '../../lib/api';
import { formatSize } from '../../utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { JobTypeBadge } from '../../components/job-type-badge';
import { JobDetailsFineTune } from '../../components/job-details-fine-tune';
import { JobDetailsSynthetic } from '../../components/job-details-synthetic';

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

function JobListCard({ job, selected, onClick }: { job: Job; selected: boolean; onClick: () => void }) {
  const isSynthetic = job.type === 'synthetic-gen';

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-3 text-left transition ${
        selected
          ? isSynthetic
            ? 'border-cyan-500 bg-cyan-500/10'
            : 'border-purple-500 bg-purple-500/10'
          : 'border-slate-800 bg-slate-950/30 hover:border-slate-700'
      }`}
    >
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
            <div className="mt-2 text-xs text-slate-400 break-all">
              {job.baseModel || '—'}
            </div>
          )}
        </div>
        <StatusBadge value={job.status} />
      </div>

      <div className="mt-2 text-xs text-slate-500">{fmtDate(job.createdAt)}</div>
    </button>
  );
}

export default function JobsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));

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

  const selectedLora = useMemo(() => {
    if (!selectedJob) return null;
    return (lorasQuery.data || []).find((x) => x.jobId === selectedJob.id) || null;
  }, [lorasQuery.data, selectedJob]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Jobs</h1>
        <p className="mt-1 text-sm text-slate-400">
          Обучение и создание synthetic datasets теперь показываются по-разному и с отдельной детализацией.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 text-sm font-semibold text-white">All jobs</div>

          <div className="space-y-2">
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
                  onClick={() => setSelectedId(job.id)}
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {!selectedJob ? 'Job details' : (
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
              ) : (
                <JobDetailsFineTune job={selectedJob} />
              )}
            </CardContent>
          </Card>

          {!isSynthetic && selectedJob ? (
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
                      useOutputMutation.isPending
                    }
                    className="bg-emerald-600 hover:bg-emerald-500"
                  >
                    {useOutputMutation.isPending ? 'Preparing runtime…' : 'Use in runtime'}
                  </Button>
                </div>

                {useOutputMutation.error ? (
                  <div className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">
                    {(useOutputMutation.error as Error).message}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
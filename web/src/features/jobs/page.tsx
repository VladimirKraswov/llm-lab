import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';

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
      // Short delay to allow runtime health check to catch up
      setTimeout(() => navigate('/app/playground'), 1500);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Jobs</h1>
        <p className="mt-1 text-sm text-slate-400">
          Следи за обучением, смотри логи, регистрируй LoRA и запускай готовый результат на инференс.
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
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className={`w-full rounded-2xl border p-3 text-left transition ${
                    selectedId === job.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-slate-800 bg-slate-950/30 hover:border-slate-700'
                  }`}
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
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
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
        </div>
      </div>
    </div>
  );
}
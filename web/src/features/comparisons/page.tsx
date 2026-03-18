import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type ComparisonTargetInput } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select } from '../../components/ui/select';
import { JobTypeBadge } from '../../components/job-type-badge';
import { StatusBadge } from '../../components/status-badge';

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

type TargetRow = {
  kind: 'model' | 'lora';
  id: string;
};

function parsePrompts(text: string) {
  return text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function ComparisonsPage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [targets, setTargets] = useState<TargetRow[]>([
    { kind: 'model', id: '' },
    { kind: 'model', id: '' },
  ]);
  const [promptsText, setPromptsText] = useState(
    'What is the capital of France?\nExplain gravity like I am five.\nWrite a short poem about coding.',
  );
  const [provider, setProvider] = useState('auto');
  const [temperature, setTemperature] = useState('0');
  const [maxTokens, setMaxTokens] = useState('256');

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: api.getModels,
    refetchInterval: 5000,
  });

  const lorasQuery = useQuery({
    queryKey: ['loras'],
    queryFn: api.getLoras,
    refetchInterval: 5000,
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: api.getJobs,
    refetchInterval: 3000,
  });

  const providersQuery = useQuery({
    queryKey: ['runtime-providers'],
    queryFn: api.getRuntimeProviders,
    staleTime: 30000,
  });

  const readyModels = useMemo(
    () => (modelsQuery.data || []).filter((m) => m.status === 'ready'),
    [modelsQuery.data],
  );

  const readyLoras = useMemo(
    () => (lorasQuery.data || []).filter((l) => l.status === 'ready'),
    [lorasQuery.data],
  );

  const comparisonJobs = useMemo(
    () =>
      (jobsQuery.data || [])
        .filter((j) => j.type === 'model-comparison')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [jobsQuery.data],
  );

  const prompts = useMemo(() => parsePrompts(promptsText), [promptsText]);

  const startMutation = useMutation({
    mutationFn: api.startComparison,
    onSuccess: (data) => {
      navigate(`/app/jobs?selected=${encodeURIComponent(data.jobId)}`);
    },
  });

  function updateTarget(index: number, patch: Partial<TargetRow>) {
    setTargets((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addTarget() {
    setTargets((prev) => [...prev, { kind: 'model', id: '' }]);
  }

  function removeTarget(index: number) {
    setTargets((prev) => prev.filter((_, i) => i !== index));
  }

  const preparedTargets: ComparisonTargetInput[] = targets
    .filter((x) => x.id)
    .map((x) => ({ type: x.kind, id: x.id }));

  const canSubmit = preparedTargets.length >= 2 && prompts.length >= 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comparisons"
        description="Запусти один comparison job на нескольких моделях и LoRA, затем смотри результаты в Jobs."
      />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] flex-1 overflow-hidden">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>Create comparison job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 overflow-y-auto scrollbar-thin">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500 tracking-wider">Job name</label>
              <Input
                size="sm"
                className="h-8 text-xs font-mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="compare-qwen-runs"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase text-slate-400">Targets</div>

              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2 scrollbar-thin">
                {targets.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/30 p-3 md:grid-cols-[100px_1fr_auto]"
                  >
                    <div>
                      <label className="mb-1 block text-[9px] uppercase font-bold text-slate-600">
                        Type
                      </label>
                      <Select
                        size="sm"
                        className="h-7 text-[10px]"
                        value={row.kind}
                        onChange={(e) =>
                          updateTarget(idx, {
                            kind: e.target.value as 'model' | 'lora',
                            id: '',
                          })
                        }
                      >
                        <option value="model">Model</option>
                        <option value="lora">LoRA</option>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[9px] uppercase font-bold text-slate-600">
                        Select {row.kind}
                      </label>
                      <Select
                        size="sm"
                        className="h-7 text-[10px]"
                        value={row.id}
                        onChange={(e) => updateTarget(idx, { id: e.target.value })}
                      >
                        <option value="">Choose...</option>
                        {row.kind === 'model'
                          ? readyModels.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))
                          : readyLoras.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                      </Select>
                    </div>

                    <div className="flex items-end">
                      <Button
                        size="sm"
                        className="h-7 px-2 bg-rose-700/80 text-[10px] text-white hover:bg-rose-600"
                        onClick={() => removeTarget(idx)}
                        disabled={targets.length <= 2}
                      >
                        Del
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button size="sm" className="w-full h-7 text-[10px] bg-slate-800 hover:bg-slate-700 border-dashed border border-slate-700" onClick={addTarget}>
                + Add target
              </Button>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                Prompts (one per line)
              </label>
              <Textarea
                className="min-h-[120px] text-xs font-mono bg-slate-950/50"
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
                placeholder={'What is the capital of France?\nExplain gravity like I am five.'}
              />
              <div className="mt-1 text-[10px] text-slate-500">
                Parsed: {prompts.length}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500 tracking-wider">Provider</label>
                <Select size="sm" className="h-8 text-[10px]" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {(providersQuery.data?.available || []).map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.label} {!p.available ? '(Unavailable)' : ''}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-400">Temperature</label>
                <Input
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-400">Max tokens</label>
                <Input
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
              Comparison будет по очереди поднимать target-модели в runtime и собирать ответы в один job.
            </div>

            <Button
              onClick={() =>
                startMutation.mutate({
                  name: name.trim() || undefined,
                  targets: preparedTargets,
                  prompts,
                  inference: {
                    provider,
                    temperature: Number(temperature),
                    max_tokens: Number(maxTokens),
                  },
                })
              }
              disabled={!canSubmit || startMutation.isPending}
            >
              {startMutation.isPending ? 'Starting…' : 'Start comparison'}
            </Button>

            {startMutation.error ? (
              <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-300">
                {(startMutation.error as Error).message}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent comparison jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!comparisonJobs.length ? (
              <div className="text-sm text-slate-500">No comparison jobs yet.</div>
            ) : (
              comparisonJobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => navigate(`/app/jobs?selected=${encodeURIComponent(job.id)}`)}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/30 p-4 text-left transition hover:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium text-white">{job.name}</div>
                        <JobTypeBadge type={job.type} />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{job.id}</div>
                    </div>
                    <StatusBadge value={job.status} />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
                    <div className="rounded-xl bg-slate-900/60 p-2">
                      <div className="text-slate-500">Targets</div>
                      <div className="mt-1 text-white">
                        {job.summaryMetrics?.targets ?? job.paramsSnapshot?.targets?.length ?? '—'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 p-2">
                      <div className="text-slate-500">Prompts</div>
                      <div className="mt-1 text-white">
                        {job.summaryMetrics?.promptsPerTarget ?? job.paramsSnapshot?.prompts?.length ?? '—'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 p-2">
                      <div className="text-slate-500">Created</div>
                      <div className="mt-1 text-white">{fmtDate(job.createdAt)}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
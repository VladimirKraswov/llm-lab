import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Job, api, PipelineConfig } from '../lib/api';
import { formatSize } from '../utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CopyButton } from './copy-button';
import { Download, ExternalLink, RefreshCw, Terminal, CheckCircle2, Clock3, Circle, Archive } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function stageConfig(pipeline: PipelineConfig | undefined, key: 'publish' | 'upload' | 'prepare_assets' | 'training' | 'merge' | 'evaluation') {
  if (!pipeline) return undefined;
  if (key in pipeline) return (pipeline as any)[key];
  if (key === 'publish') return (pipeline as any).publish_artifacts;
  if (key === 'upload') return (pipeline as any).upload_artifacts;
  return undefined;
}

function parseContainerImage(command?: string | null) {
  if (!command) return null;
  const clean = String(command).replace(/\s+/g, ' ').trim();
  const match = clean.match(/docker run(?: [^-][^ ]*| --[^\s]+(?: [^\s]+)?)* ([\w./:@-]+)(?:\s|$)/);
  return match?.[1] || null;
}

function maskJobConfigUrl(url?: string | null) {
  if (!url) return '—';
  try {
    const value = new URL(url);
    if (value.searchParams.has('token')) {
      value.searchParams.set('token', '***');
    }
    return value.toString();
  } catch {
    return String(url).replace(/token=[^&]+/i, 'token=***');
  }
}

function PipelineVisualizer({
  pipeline,
  currentStage,
  status,
}: {
  pipeline?: PipelineConfig;
  currentStage?: string | null;
  status: string;
}) {
  if (!pipeline) return null;

  const stages = [
    { id: 'prepare_assets', title: 'Prepare / Assets' },
    { id: 'training', title: 'Training' },
    { id: 'merge', title: 'Merge' },
    { id: 'evaluation', title: 'Evaluation' },
    { id: 'publish', title: 'Publish' },
    { id: 'upload', title: 'Upload / Reporting' },
  ];

  const currentIndex = stages.findIndex((stage) => stage.id === currentStage);

  return (
    <Card className="border-slate-800 bg-slate-900/60">
      <CardHeader className="py-3">
        <CardTitle className="text-xs uppercase tracking-wider text-slate-500">Pipeline execution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stages.map((stage, index) => {
          const cfg = stageConfig(pipeline, stage.id as any);
          const enabled = cfg?.enabled !== false;
          const isCurrent = currentStage === stage.id;
          const isPast =
            status === 'completed'
              ? enabled
              : currentIndex >= 0 && currentIndex > index && enabled;

          return (
            <div key={stage.id} className={`flex gap-3 ${!enabled ? 'opacity-40' : ''}`}>
              <div className="flex w-5 flex-col items-center">
                <div
                  className={`rounded-full p-1 ${
                    isCurrent
                      ? 'bg-blue-500/20 text-blue-300'
                      : isPast
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isPast ? <CheckCircle2 size={14} /> : isCurrent ? <Clock3 size={14} className="animate-pulse" /> : <Circle size={14} />}
                </div>
                {index < stages.length - 1 ? <div className={`mt-1 w-px flex-1 ${isPast ? 'bg-emerald-500/30' : 'bg-slate-800'}`} /> : null}
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-white">{stage.title}</div>
                  <span className="rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {index === 0 ? 'Pipeline start' : `Depends on: ${stages[index - 1].title}`}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function JobDetailsFineTune({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const pipeline = (job.paramsSnapshot?.pipeline || undefined) as PipelineConfig | undefined;
  const trainingSnapshot = job.paramsSnapshot?.qlora || job.qlora || {};
  const launchImage = parseContainerImage(job.launch?.exampleDockerRun);

  const syncMutation = useMutation({
    mutationFn: () => api.syncJobFromHF(job.id),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success('Synced from Hugging Face');
        queryClient.invalidateQueries({ queryKey: ['job', job.id] });
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
      } else {
        toast.error(res.message || 'No artifacts found');
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Sync failed');
    },
  });

  const launchEnvQuery = useQuery({
    queryKey: ['job-launch-env', job.id],
    queryFn: () => api.getJobLaunchEnv(job.id),
    enabled: job.mode === 'remote' && !!job.launch,
    staleTime: 60_000,
  });

  const launchComposeQuery = useQuery({
    queryKey: ['job-launch-compose', job.id],
    queryFn: () => api.getJobLaunchCompose(job.id),
    enabled: job.mode === 'remote' && !!job.launch,
    staleTime: 60_000,
  });

  const handleDownloadBundle = () => {
    api.downloadJobLaunchBundle(job.id);
  };

  const handleCopyAsync = async (label: string, loader: () => Promise<string>) => {
    try {
      const text = await loader();
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch (err: any) {
      toast.error(err.message || `Failed to copy ${label}`);
    }
  };

  const effectiveTrainingSummary = useMemo(() => {
    return [
      { label: 'Method', value: trainingSnapshot.method || (trainingSnapshot.useLora ? 'lora/qlora' : 'full') || '—' },
      { label: 'Max seq', value: trainingSnapshot.maxSeqLength || trainingSnapshot.max_seq_length || '—' },
      {
        label: 'Batch / grad accum',
        value: `${trainingSnapshot.perDeviceTrainBatchSize ?? trainingSnapshot.per_device_train_batch_size ?? '—'} / ${
          trainingSnapshot.gradientAccumulationSteps ?? trainingSnapshot.gradient_accumulation_steps ?? '—'
        }`,
      },
      { label: 'Epochs', value: trainingSnapshot.numTrainEpochs ?? trainingSnapshot.num_train_epochs ?? '—' },
      { label: 'Learning rate', value: trainingSnapshot.learningRate ?? trainingSnapshot.learning_rate ?? '—' },
      {
        label: 'LoRA',
        value: `${trainingSnapshot.loraR ?? trainingSnapshot.lora_r ?? '—'} / ${
          trainingSnapshot.loraAlpha ?? trainingSnapshot.lora_alpha ?? '—'
        } / ${trainingSnapshot.loraDropout ?? trainingSnapshot.lora_dropout ?? '—'}`,
      },
    ];
  }, [trainingSnapshot]);

  return (
    <div className="space-y-4">
      {job.mode === 'remote' && pipeline ? (
        <PipelineVisualizer pipeline={pipeline} currentStage={job.currentStage} status={job.status} />
      ) : null}

      <Card className="border-purple-500/20 bg-purple-500/5">
        <CardHeader>
          <CardTitle>Fine-tune job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Job ID</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-white">{job.id}</span>
              <CopyButton text={job.id} className="h-6" showLabel>
                Copy ID
              </CopyButton>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Dataset</div>
            <div className="mt-1 text-white">{job.datasetId || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Runtime preset</div>
            <div className="mt-1 text-white">{job.runtimePresetId || 'Legacy / none'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Base model</div>
            <div className="mt-1 break-all text-white">{job.baseModel || job.paramsSnapshot?.pipeline?.training?.logical_base_model || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Created</div>
            <div className="mt-1 text-white">{fmtDate(job.createdAt)}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Finished</div>
            <div className="mt-1 text-white">{fmtDate(job.finishedAt)}</div>
          </div>

          {(job.hfRepoIdLora || job.hfRepoIdMerged || job.hfRepoIdMetadata) ? (
            <div className="rounded-xl bg-slate-950/40 p-3 md:col-span-2">
              <div className="mb-2 text-xs text-slate-500">Hugging Face repositories</div>
              <div className="flex flex-wrap gap-2">
                {job.hfRepoIdLora ? (
                  <a
                    href={`https://huggingface.co/${job.hfRepoIdLora}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/20"
                  >
                    <ExternalLink size={12} />
                    LoRA: {job.hfRepoIdLora}
                  </a>
                ) : null}
                {job.hfRepoIdMerged ? (
                  <a
                    href={`https://huggingface.co/${job.hfRepoIdMerged}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20"
                  >
                    <ExternalLink size={12} />
                    Merged: {job.hfRepoIdMerged}
                  </a>
                ) : null}
                {job.hfRepoIdMetadata ? (
                  <a
                    href={`https://huggingface.co/${job.hfRepoIdMetadata}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-2 py-1 text-xs text-purple-400 hover:bg-purple-500/20"
                  >
                    <ExternalLink size={12} />
                    Metadata: {job.hfRepoIdMetadata}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {job.mode === 'remote' && job.launch ? (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal size={18} className="text-blue-400" />
              <CardTitle>Launch data</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleDownloadBundle} className="bg-blue-600 text-white hover:bg-blue-500 h-8">
                <Download size={14} className="mr-2" />
                Download bundle
              </Button>
              <CopyButton
                text={job.launch.exampleDockerRun}
                showLabel
                size="md"
                className="h-8 bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
              >
                Docker run
              </CopyButton>
              <Button
                size="sm"
                onClick={() => handleCopyAsync('docker-compose', () => api.getJobLaunchCompose(job.id))}
                className="h-8 bg-slate-800 text-white hover:bg-slate-700"
              >
                <Archive size={14} className="mr-2" />
                Copy compose
              </Button>
              <Button
                size="sm"
                onClick={() => handleCopyAsync('launch.env', () => api.getJobLaunchEnv(job.id))}
                className="h-8 bg-slate-800 text-white hover:bg-slate-700"
              >
                <Archive size={14} className="mr-2" />
                Copy env
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-slate-950/40 p-3">
                <div className="text-xs text-slate-500">Runtime preset</div>
                <div className="mt-1 text-white">{job.runtimePresetId || 'Legacy / none'}</div>
              </div>
              <div className="rounded-xl bg-slate-950/40 p-3">
                <div className="text-xs text-slate-500">Container image</div>
                <div className="mt-1 break-all font-mono text-xs text-slate-300">{launchImage || 'Parsed at runtime'}</div>
              </div>
              <div className="rounded-xl bg-slate-950/40 p-3">
                <div className="text-xs text-slate-500">Logical base model</div>
                <div className="mt-1 break-all text-white">{job.baseModel || job.paramsSnapshot?.pipeline?.training?.logical_base_model || '—'}</div>
              </div>
              <div className="rounded-xl bg-slate-950/40 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>JOB_CONFIG_URL</span>
                  <CopyButton text={job.launch.jobConfigUrl} />
                </div>
                <div className="mt-1 break-all font-mono text-[10px] text-blue-300">{maskJobConfigUrl(job.launch.jobConfigUrl)}</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs text-slate-500">launch.env preview</div>
                  {launchEnvQuery.data ? <CopyButton text={launchEnvQuery.data} /> : null}
                </div>
                <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">
                  {(launchEnvQuery.data || 'Loading launch.env…').replace(/token=[^&\n]+/gi, 'token=***')}
                </pre>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs text-slate-500">docker-compose preview</div>
                  {launchComposeQuery.data ? <CopyButton text={launchComposeQuery.data} /> : null}
                </div>
                <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">
                  {launchComposeQuery.data || 'Loading docker-compose…'}
                </pre>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs text-slate-500">docker run preview</div>
                <CopyButton text={job.launch.exampleDockerRun} />
              </div>
              <pre className="whitespace-pre-wrap text-[10px] text-slate-300">{job.launch.exampleDockerRun}</pre>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Training summary</CardTitle>
          {job.mode === 'remote' && (job.hfRepoIdLora || job.hfRepoIdMerged || job.hfRepoIdMetadata) ? (
            <Button
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="h-7 text-[10px] border-slate-700 bg-slate-800/50 hover:bg-slate-700"
            >
              <RefreshCw size={12} className={`mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing...' : 'Sync from HF'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 text-sm">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Rows used</div>
            <div className="mt-1 text-lg font-semibold text-white">{job.summaryMetrics?.rows ?? '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Final loss</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {typeof job.summaryMetrics?.final_loss === 'number' ? job.summaryMetrics.final_loss.toFixed(4) : '—'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Duration</div>
            <div className="mt-1 text-lg font-semibold text-white">{job.summaryMetrics?.duration_human || '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Precision</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {job.summaryMetrics?.bf16 ? 'BF16' : job.summaryMetrics?.fp16 ? 'FP16' : '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Effective training config</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {effectiveTrainingSummary.map((item) => (
              <div key={item.label} className="rounded-xl bg-slate-950/40 p-3">
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="mt-1 break-all text-white">{item.value}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Environment snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[340px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">
              {JSON.stringify(job.envSnapshot || {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dataset / model snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Dataset file</div>
              <div className="mt-1 break-all text-white">{job.datasetSnapshot?.path || '—'}</div>
              <div className="mt-2 text-xs text-slate-400">
                Size: {formatSize(job.datasetSnapshot?.size)} · Hash: {job.datasetSnapshot?.hash || '—'}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Model snapshot</div>
              <pre className="mt-2 max-h-[200px] overflow-auto text-xs text-slate-300">
                {JSON.stringify(job.modelSnapshot || {}, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Effective config / pipeline snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[400px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">
              {JSON.stringify(job.paramsSnapshot || job.qlora || {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

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

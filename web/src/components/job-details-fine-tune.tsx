import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Job, api, PipelineConfig } from '../lib/api';
import { formatSize } from '../utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CopyButton } from './copy-button';
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

function normalizePipeline(job: Job): PipelineConfig | null {
  return job.paramsSnapshot?.pipeline || job.paramsSnapshot?.effectivePipeline || null;
}

function stageOrder(pipeline: PipelineConfig | null) {
  if (!pipeline) return [] as Array<{ key: string; title: string; enabled: boolean }>;
  const items = [
    ['prepare_assets', 'Prepare / Assets'],
    ['training', 'Training'],
    ['save_lora', 'Save LoRA'],
    ['merge_model', 'Merge'],
    ['evaluation', 'Evaluation'],
    ['upload_huggingface', 'Upload / Hugging Face'],
    ['finalize', 'Finalize'],
    ['reporting', 'Reporting'],
    ['merge', 'Legacy merge'],
    ['publish', 'Legacy publish'],
    ['upload', 'Legacy upload'],
  ] as const;

  return items
    .map(([key, title]) => ({ key, title, enabled: (pipeline as any)?.[key]?.enabled !== false && Boolean((pipeline as any)?.[key]) }))
    .filter((item) => Boolean((pipeline as any)?.[item.key]));
}

function PipelineVisualizer({ job }: { job: Job }) {
  const pipeline = normalizePipeline(job);
  if (!pipeline) return null;

  const stages = stageOrder(pipeline);
  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardHeader className="py-3">
        <CardTitle className="text-xs uppercase tracking-wider text-slate-500">Pipeline execution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 py-4">
        {stages.map((stage, index) => {
          const isCurrent = job.currentStage === stage.key;
          const isCompleted = job.status === 'completed' || (job.currentStage ? stages.findIndex((item) => item.key === job.currentStage) > index : false);
          return (
            <div key={stage.key} className="flex items-start gap-3">
              <div className={isCurrent ? 'mt-1 h-2.5 w-2.5 rounded-full bg-blue-400' : isCompleted ? 'mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400' : stage.enabled ? 'mt-1 h-2.5 w-2.5 rounded-full bg-slate-600' : 'mt-1 h-2.5 w-2.5 rounded-full bg-slate-800'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-white">{stage.title}</div>
                  <div className={stage.enabled ? 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300' : 'rounded bg-slate-900 px-1.5 py-0.5 text-[10px] uppercase text-slate-600'}>
                    {stage.enabled ? 'enabled' : 'disabled'}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{JSON.stringify((pipeline as any)[stage.key] || {})}</div>
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

  const syncMutation = useMutation({
    mutationFn: () => api.syncJobFromHF(job.id),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success('Synced from Hugging Face');
        queryClient.invalidateQueries({ queryKey: ['job', job.id] });
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
      } else {
        toast.error(result.message || 'No artifacts found');
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Sync failed');
    },
  });

  const pipeline = normalizePipeline(job);
  const trainingStage = pipeline?.training || job.paramsSnapshot?.training || {};
  const evaluationStage = pipeline?.evaluation || {};
  const uploadStage = pipeline?.upload_huggingface || pipeline?.publish || {};

  return (
    <div className="space-y-4">
      {job.mode === 'remote' ? <PipelineVisualizer job={job} /> : null}

      <Card className="border-purple-500/20 bg-purple-500/5">
        <CardHeader>
          <CardTitle>Fine-tune job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Job ID</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-white">{job.id}</span>
              <CopyButton text={job.id} className="h-5 w-5 px-1 py-0.5" />
            </div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Dataset</div>
            <div className="mt-1 text-white">{job.datasetId || '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Logical base model</div>
            <div className="mt-1 break-all text-white">{job.baseModel || trainingStage.logical_base_model_id || '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Runtime preset</div>
            <div className="mt-1 text-white">{job.runtimePresetTitle || job.runtimePresetId || 'legacy / direct image'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Container image</div>
            <div className="mt-1 break-all font-mono text-[11px] text-white">{job.containerImage || trainingStage.trainer_image || '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Model local path</div>
            <div className="mt-1 font-mono text-[11px] text-white">{job.modelLocalPath || trainingStage.model_local_path || '—'}</div>
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
            <div className="md:col-span-2 rounded-xl bg-slate-950/40 p-3">
              <div className="mb-2 text-xs text-slate-500">Hugging Face repositories</div>
              <div className="flex flex-wrap gap-3">
                {job.hfRepoIdLora ? <a href={`https://huggingface.co/${job.hfRepoIdLora}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-blue-500/10 px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/20"><ExternalLink size={12} />LoRA: {job.hfRepoIdLora}</a> : null}
                {job.hfRepoIdMerged ? <a href={`https://huggingface.co/${job.hfRepoIdMerged}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20"><ExternalLink size={12} />Merged: {job.hfRepoIdMerged}</a> : null}
                {job.hfRepoIdMetadata ? <a href={`https://huggingface.co/${job.hfRepoIdMetadata}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-2 py-1 text-xs text-purple-400 hover:bg-purple-500/20"><ExternalLink size={12} />Metadata: {job.hfRepoIdMetadata}</a> : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Training summary</CardTitle>
          {(job.hfRepoIdLora || job.hfRepoIdMerged || job.hfRepoIdMetadata) ? (
            <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="h-7 bg-slate-800/50 text-[10px] hover:bg-slate-700">
              <RefreshCw size={12} className={`mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing…' : 'Sync from HF'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Rows used</div><div className="mt-1 text-lg font-semibold text-white">{job.summaryMetrics?.rows ?? '—'}</div></div>
          <div className="rounded-xl bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Final loss</div><div className="mt-1 text-lg font-semibold text-white">{typeof job.summaryMetrics?.final_loss === 'number' ? job.summaryMetrics.final_loss.toFixed(4) : '—'}</div></div>
          <div className="rounded-xl bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Duration</div><div className="mt-1 text-lg font-semibold text-white">{job.summaryMetrics?.duration_human || '—'}</div></div>
          <div className="rounded-xl bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Precision</div><div className="mt-1 text-lg font-semibold text-white">{job.summaryMetrics?.bf16 ? 'BF16' : job.summaryMetrics?.fp16 ? 'FP16' : '—'}</div></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Training / evaluation config</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Training stage</div>
              <pre className="mt-2 max-h-[240px] overflow-auto text-[11px] text-slate-300">{JSON.stringify(trainingStage || {}, null, 2)}</pre>
            </div>
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Evaluation stage</div>
              <pre className="mt-2 max-h-[240px] overflow-auto text-[11px] text-slate-300">{JSON.stringify(evaluationStage || {}, null, 2)}</pre>
            </div>
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Upload / publish stage</div>
              <pre className="mt-2 max-h-[200px] overflow-auto text-[11px] text-slate-300">{JSON.stringify(uploadStage || {}, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>HF-backed artifacts / snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Dataset snapshot</div>
              <div className="mt-1 break-all text-white">{job.datasetSnapshot?.path || '—'}</div>
              <div className="mt-2 text-xs text-slate-400">Size: {formatSize(job.datasetSnapshot?.size)} · Hash: {job.datasetSnapshot?.hash || '—'}</div>
            </div>
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Environment snapshot</div>
              <pre className="mt-2 max-h-[220px] overflow-auto text-[11px] text-slate-300">{JSON.stringify(job.envSnapshot || {}, null, 2)}</pre>
            </div>
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Model snapshot</div>
              <pre className="mt-2 max-h-[220px] overflow-auto text-[11px] text-slate-300">{JSON.stringify(job.modelSnapshot || {}, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Effective config / params snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[420px] overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] text-slate-300">{JSON.stringify(job.paramsSnapshot || job.qlora || {}, null, 2)}</pre>
        </CardContent>
      </Card>

      {job.error ? (
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader>
            <CardTitle>Job error</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-rose-500/20 bg-slate-950/60 p-3 text-sm text-rose-200">{job.error}</div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

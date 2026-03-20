import { Job, api } from '../lib/api';
import { formatSize } from '../utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CopyButton } from './copy-button';
import { Terminal, Download, Archive } from 'lucide-react';
import { Button } from './ui/button';

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export function JobDetailsFineTune({ job }: { job: Job }) {
  const handleDownloadBundle = () => {
    api.downloadJobLaunchBundle(job.id);
  };

  const handleCopyCompose = async () => {
    const text = await api.getJobLaunchCompose(job.id);
    navigator.clipboard.writeText(text);
  };

  const handleCopyEnv = async () => {
    const text = await api.getJobLaunchEnv(job.id);
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      <Card className="border-purple-500/20 bg-purple-500/5">
        <CardHeader>
          <CardTitle>Fine-tune Job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Job ID</div>
            <div className="mt-1 flex items-center gap-2">
               <span className="text-white font-mono">{job.id}</span>
               <CopyButton text={job.id} className="h-5 w-5 px-1 py-0.5" />
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Dataset</div>
            <div className="mt-1 text-white">{job.datasetId || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Base model</div>
            <div className="mt-1 break-all text-white">{job.baseModel || '—'}</div>
          </div>

          {job.runtimePresetId && (
            <div className="rounded-xl bg-slate-950/40 p-3">
              <div className="text-xs text-slate-500">Runtime Preset</div>
              <div className="mt-1 text-blue-400 font-medium">{job.runtimePresetId}</div>
            </div>
          )}

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Created</div>
            <div className="mt-1 text-white">{fmtDate(job.createdAt)}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Finished</div>
            <div className="mt-1 text-white">{fmtDate(job.finishedAt)}</div>
          </div>
        </CardContent>
      </Card>

      {job.mode === 'remote' && job.launch && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal size={18} className="text-blue-400" />
              <CardTitle>Launch Trainer</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadBundle}
                className="bg-blue-600 text-white border-blue-500 hover:bg-blue-500 hover:text-white h-8"
              >
                <Download size={14} className="mr-2" />
                Download Bundle
              </Button>
              <CopyButton
                text={job.launch.exampleDockerRun}
                showLabel
                size="md"
                className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700 h-8"
              >
                Copy docker run
              </CopyButton>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-slate-950/40 p-3">
                <div className="text-xs text-slate-500 flex items-center justify-between">
                  <span>jobConfigUrl</span>
                  <CopyButton text={job.launch.jobConfigUrl} />
                </div>
                <div className="mt-1 text-[10px] font-mono text-blue-300 truncate" title={job.launch.jobConfigUrl}>
                  {job.launch.jobConfigUrl}
                </div>
              </div>

              <div className="rounded-xl bg-slate-950/40 p-3">
                <div className="text-xs text-slate-500 flex items-center justify-between">
                   <span>Launch Files</span>
                </div>
                <div className="mt-2 flex gap-2">
                   <Button variant="ghost" size="xs" onClick={handleCopyCompose} className="text-[10px] text-blue-400 hover:text-blue-300 p-0 h-auto">
                     <Archive size={10} className="mr-1" /> Copy Compose
                   </Button>
                   <Button variant="ghost" size="xs" onClick={handleCopyEnv} className="text-[10px] text-blue-400 hover:text-blue-300 p-0 h-auto">
                     <Archive size={10} className="mr-1" /> Copy .env
                   </Button>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
              <div className="text-xs text-slate-500 mb-2">Docker command (Quick run)</div>
              <pre className="text-[10px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                {job.launch.exampleDockerRun}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Training summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 text-sm">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Rows used</div>
            <div className="mt-1 text-lg font-semibold text-white">{job.summaryMetrics?.rows ?? '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Final loss</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {typeof job.summaryMetrics?.final_loss === 'number'
                ? job.summaryMetrics.final_loss.toFixed(4)
                : '—'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Duration</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {job.summaryMetrics?.duration_human || '—'}
            </div>
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
            <CardTitle>Environment snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[340px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">
              {JSON.stringify(job.envSnapshot || {}, null, 2)}
            </pre>
          </CardContent>
        </Card>

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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>QLoRA params</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[320px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">
            {JSON.stringify(job.qlora || job.paramsSnapshot?.qlora || {}, null, 2)}
          </pre>
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
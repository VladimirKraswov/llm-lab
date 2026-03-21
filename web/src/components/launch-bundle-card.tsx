import { useMemo, useState } from 'react';
import { Archive, Copy, Download, Eye, EyeOff, FileCode2, KeyRound, Package, TerminalSquare } from 'lucide-react';
import { api, type Job } from '../lib/api';
import { CopyButton } from './copy-button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';

function maskSecretUrl(value?: string | null) {
  if (!value) return '—';
  try {
    const url = new URL(value);
    const token = url.searchParams.get('token');
    if (!token) return value;
    url.searchParams.set('token', '••••••••');
    return url.toString();
  } catch {
    return value;
  }
}

function extractContainerImage(job: Job) {
  return (
    job.containerImage ||
    job.launch?.trainerImage ||
    job.paramsSnapshot?.containerImage ||
    job.paramsSnapshot?.runtime?.containerImage ||
    job.paramsSnapshot?.runtimePreset?.trainerImage ||
    '—'
  );
}

function extractModelLocalPath(job: Job) {
  return (
    job.modelLocalPath ||
    job.paramsSnapshot?.modelLocalPath ||
    job.paramsSnapshot?.runtime?.modelLocalPath ||
    job.paramsSnapshot?.runtimePreset?.modelLocalPath ||
    '—'
  );
}

function extractLogicalBaseModel(job: Job) {
  return (
    job.baseModel ||
    job.paramsSnapshot?.baseModel ||
    job.paramsSnapshot?.logicalBaseModelId ||
    job.paramsSnapshot?.runtimePreset?.logicalBaseModelId ||
    '—'
  );
}

function extractPresetTitle(job: Job) {
  return (
    job.runtimePresetTitle ||
    job.paramsSnapshot?.runtimePreset?.title ||
    job.runtimePresetId ||
    'Legacy / direct image'
  );
}

export function LaunchBundleCard({ job }: { job: Job }) {
  const [showSecret, setShowSecret] = useState(false);
  const [composeText, setComposeText] = useState<string | null>(null);
  const [envText, setEnvText] = useState<string | null>(null);
  const [loadingCompose, setLoadingCompose] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(false);

  const launch = job.launch;
  const visibleJobConfigUrl = showSecret ? launch?.jobConfigUrl || '' : maskSecretUrl(launch?.jobConfigUrl);

  const details = useMemo(
    () => [
      { label: 'Runtime preset', value: extractPresetTitle(job) },
      { label: 'Container image', value: extractContainerImage(job) },
      { label: 'Logical base model', value: extractLogicalBaseModel(job) },
      { label: 'Model local path', value: extractModelLocalPath(job) },
    ],
    [job],
  );

  if (!launch && !job.containerImage && !job.jobConfigUrl) {
    return null;
  }

  const fetchCompose = async () => {
    setLoadingCompose(true);
    try {
      const text = await api.getJobLaunchCompose(job.id);
      setComposeText(text);
    } finally {
      setLoadingCompose(false);
    }
  };

  const fetchEnv = async () => {
    setLoadingEnv(true);
    try {
      const text = await api.getJobLaunchEnv(job.id);
      setEnvText(text);
    } finally {
      setLoadingEnv(false);
    }
  };

  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare size={16} className="text-blue-400" />
            Launch bundle
          </CardTitle>
          <div className="mt-1 text-[11px] text-slate-500">Remote trainer launch data for any GPU server.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => api.downloadJobLaunchBundle(job.id)}>
            <Download size={14} className="mr-1.5" />
            Bundle
          </Button>
          {launch?.exampleDockerRun ? (
            <CopyButton text={launch.exampleDockerRun} showLabel size="md">
              docker run
            </CopyButton>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {details.map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</div>
              <div className="mt-1 break-all text-sm text-white">{item.value || '—'}</div>
            </div>
          ))}
        </div>

        {(launch?.jobConfigUrl || job.jobConfigUrl) && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                <KeyRound size={12} />
                JOB_CONFIG_URL
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSecret((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/50 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
                >
                  {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                  {showSecret ? 'Hide token' : 'Reveal token'}
                </button>
                <CopyButton text={launch?.jobConfigUrl || job.jobConfigUrl || ''} />
              </div>
            </div>
            <div className="break-all font-mono text-[11px] text-blue-300">{visibleJobConfigUrl}</div>
            <div className="mt-2 text-[10px] text-slate-500">
              URL contains auth token. It is shown masked by default, but copy always uses the full value.
            </div>
          </div>
        )}

        {launch?.exampleDockerRun ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-slate-500">
              <div className="flex items-center gap-2">
                <Package size={12} />
                docker run
              </div>
              <CopyButton text={launch.exampleDockerRun} />
            </div>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">{launch.exampleDockerRun}</pre>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                <FileCode2 size={12} />
                docker-compose
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={fetchCompose} disabled={loadingCompose}>
                  {loadingCompose ? 'Loading…' : 'Preview'}
                </Button>
                {composeText ? <CopyButton text={composeText} /> : null}
              </div>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">
              {composeText || 'Load compose preview on demand to avoid exposing launch data by default.'}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                <Archive size={12} />
                .env / launch data
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={fetchEnv} disabled={loadingEnv}>
                  {loadingEnv ? 'Loading…' : 'Preview'}
                </Button>
                {envText ? <CopyButton text={envText} /> : null}
              </div>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">
              {envText || 'Load env preview on demand to avoid exposing tokens by default.'}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

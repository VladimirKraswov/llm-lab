import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

export default function SettingsPage() {
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [baseModel, setBaseModel] = useState('');
  const [inferenceModel, setInferenceModel] = useState('');
  const [inferenceProvider, setInferenceProvider] = useState('auto');
  const [port, setPort] = useState('8000');
  const [maxSeqLength, setMaxSeqLength] = useState('4096');
  const [maxNumSeqs, setMaxNumSeqs] = useState('256');
  const [swapSpace, setSwapSpace] = useState('4');
  const [quantization, setQuantization] = useState<string>('');
  const [dtype, setDtype] = useState('auto');
  const [trustRemoteCode, setTrustRemoteCode] = useState(true);
  const [enforceEager, setEnforceEager] = useState(false);
  const [kvCacheDtype, setKvCacheDtype] = useState('auto');

  const [wandbEnabled, setWandbEnabled] = useState(false);
  const [wandbMode, setWandbMode] = useState<'online' | 'offline' | 'disabled'>('online');
  const [wandbApiKey, setWandbApiKey] = useState('');
  const [wandbProject, setWandbProject] = useState('llm-lab');
  const [wandbEntity, setWandbEntity] = useState('');

  const providersQuery = useQuery({
    queryKey: ['runtime-providers'],
    queryFn: api.getRuntimeProviders,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setBaseModel(settingsQuery.data.baseModel);
      setInferenceModel(settingsQuery.data.inference.model);
      setInferenceProvider(settingsQuery.data.inference.provider || 'auto');
      setPort(String(settingsQuery.data.inference.port));
      setMaxSeqLength(String(settingsQuery.data.qlora.maxSeqLength));
      setQuantization(settingsQuery.data.inference.quantization || '');
      setMaxNumSeqs(String(settingsQuery.data.inference.maxNumSeqs || '256'));
      setSwapSpace(String(settingsQuery.data.inference.swapSpace || '4'));
      setDtype(settingsQuery.data.inference.dtype || 'auto');
      setTrustRemoteCode(!!settingsQuery.data.inference.trustRemoteCode);
      setEnforceEager(!!settingsQuery.data.inference.enforceEager);
      setKvCacheDtype(settingsQuery.data.inference.kvCacheDtype || 'auto');

      const w = (settingsQuery.data as any).wandb;
      if (w) {
        setWandbEnabled(!!w.enabled);
        setWandbMode(w.mode || 'online');
        setWandbApiKey(w.apiKey || '');
        setWandbProject(w.project || 'llm-lab');
        setWandbEntity(w.entity || '');
      }
    }
  }, [settingsQuery.data]);

  const mutation = useMutation({ mutationFn: api.updateSettings });

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Дефолтные параметры модели, inference и QLoRA." />
      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-slate-400">Base model</label>
            <Input value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Inference model</label>
              <Input value={inferenceModel} onChange={(e) => setInferenceModel(e.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Inference provider</label>
              <select
                value={inferenceProvider}
                onChange={(e) => setInferenceProvider(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {providersQuery.data?.available.map(p => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label} {!p.available ? '(Unavailable)' : ''}
                  </option>
                ))}
              </select>
              {providersQuery.data?.available.find(p => p.id === inferenceProvider)?.reason && (
                <p className="mt-1 text-[10px] text-rose-400 leading-tight">
                  {providersQuery.data?.available.find(p => p.id === inferenceProvider)?.reason}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Inference port</label>
              <Input value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Max seq length</label>
              <Input value={maxSeqLength} onChange={(e) => setMaxSeqLength(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Quantization</label>
              <select
                value={quantization}
                onChange={(e) => setQuantization(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None (auto)</option>
                <option value="awq">AWQ</option>
                <option value="gptq">GPTQ</option>
                <option value="squeezellm">SqueezeLLM</option>
                <option value="marlin">Marlin</option>
                <option value="bitsandbytes">BitsAndBytes (4-bit)</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">DType</label>
              <select
                value={dtype}
                onChange={(e) => setDtype(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="auto">Auto</option>
                <option value="half">Half (FP16)</option>
                <option value="float16">Float16</option>
                <option value="bfloat16">BFloat16</option>
                <option value="float">Float (FP32)</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Max parallel seqs</label>
              <Input value={maxNumSeqs} onChange={(e) => setMaxNumSeqs(e.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Swap space (GB)</label>
              <Input value={swapSpace} onChange={(e) => setSwapSpace(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-3">
              <input
                id="trust-remote-code"
                type="checkbox"
                checked={trustRemoteCode}
                onChange={(e) => setTrustRemoteCode(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="trust-remote-code" className="text-sm font-medium text-white cursor-pointer">
                Trust Remote Code
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="enforce-eager"
                type="checkbox"
                checked={enforceEager}
                onChange={(e) => setEnforceEager(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="enforce-eager" className="text-sm font-medium text-white cursor-pointer">
                Enforce Eager Mode
              </label>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">KV Cache DType</label>
            <select
              value={kvCacheDtype}
              onChange={(e) => setKvCacheDtype(e.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="auto">Auto</option>
              <option value="fp8">FP8 (if supported)</option>
            </select>
          </div>
          <Button onClick={() => mutation.mutate({
            baseModel,
            qlora: { maxSeqLength: Number(maxSeqLength) },
            inference: {
              model: inferenceModel,
              provider: inferenceProvider,
              port: Number(port),
              quantization: quantization || null,
              maxNumSeqs: Number(maxNumSeqs),
              swapSpace: Number(swapSpace),
              dtype,
              trustRemoteCode,
              enforceEager,
              kvCacheDtype
            },
            wandb: {
              enabled: wandbEnabled,
              mode: wandbMode,
              apiKey: wandbApiKey,
              project: wandbProject,
              entity: wandbEntity,
            }
          })} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save settings'}
          </Button>
          {mutation.data ? <p className="text-sm text-emerald-300">Saved.</p> : null}
          {mutation.error ? <p className="text-sm text-rose-300">{(mutation.error as Error).message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weights & Biases (WandB)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              id="wandb-enabled"
              type="checkbox"
              checked={wandbEnabled}
              onChange={(e) => setWandbEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="wandb-enabled" className="text-sm font-medium text-white cursor-pointer">
              Enable WandB Logging
            </label>
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-400">W&B Mode</label>
            <select
              value={wandbMode}
              onChange={(e) => setWandbMode(e.target.value as any)}
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="online">Online (sync to wandb.ai)</option>
              <option value="offline">Offline (local logs only)</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">API Key</label>
              <Input
                type="password"
                value={wandbApiKey}
                onChange={(e) => setWandbApiKey(e.target.value)}
                placeholder="Enter your WandB API key"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Project Name</label>
              <Input
                value={wandbProject}
                onChange={(e) => setWandbProject(e.target.value)}
                placeholder="llm-lab"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-400">Entity (Optional)</label>
            <Input
              value={wandbEntity}
              onChange={(e) => setWandbEntity(e.target.value)}
              placeholder="Team or username"
            />
          </div>

          <div className="pt-2">
            <Button
              onClick={() => mutation.mutate({
                wandb: {
                  enabled: wandbEnabled,
                  mode: wandbMode,
                  apiKey: wandbApiKey,
                  project: wandbProject,
                  entity: wandbEntity,
                }
              })}
              disabled={mutation.isPending}
              className="bg-emerald-700 hover:bg-emerald-600"
            >
              {mutation.isPending ? 'Saving…' : 'Save WandB settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

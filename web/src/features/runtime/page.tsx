import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { StatusBadge } from '../../components/status-badge';
import { fmtDate } from '../../lib/utils';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

export default function RuntimePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const runtimeQuery = useQuery({ queryKey: ['runtime'], queryFn: api.getRuntime, refetchInterval: 5000 });
  const healthQuery = useQuery({ queryKey: ['runtime-health'], queryFn: api.getRuntimeHealth, refetchInterval: 5000 });
  const logsQuery = useQuery({ queryKey: ['runtime-logs'], queryFn: () => api.getRuntimeLogs(400), refetchInterval: 3000 });
  const providersQuery = useQuery({ queryKey: ['runtime-providers'], queryFn: api.getRuntimeProviders, refetchInterval: 10000 });

  const [model, setModel] = useState('');
  const [port, setPort] = useState('8000');
  const [maxModelLen, setMaxModelLen] = useState('8192');
  const [gpuMemoryUtilization, setGpuMemoryUtilization] = useState('0.9');
  const [tensorParallelSize, setTensorParallelSize] = useState('1');
  const [maxNumSeqs, setMaxNumSeqs] = useState('256');
  const [swapSpace, setSwapSpace] = useState('4');
  const [quantization, setQuantization] = useState<string>('');
  const [dtype, setDtype] = useState('auto');
  const [trustRemoteCode, setTrustRemoteCode] = useState(true);
  const [enforceEager, setEnforceEager] = useState(false);
  const [kvCacheDtype, setKvCacheDtype] = useState('auto');
  const [provider, setProvider] = useState('auto');

  useEffect(() => {
    if (settingsQuery.data) {
      setModel(settingsQuery.data.inference.model);
      setPort(String(settingsQuery.data.inference.port));
      setMaxModelLen(String(settingsQuery.data.inference.maxModelLen));
      setGpuMemoryUtilization(String(settingsQuery.data.inference.gpuMemoryUtilization));
      setTensorParallelSize(String(settingsQuery.data.inference.tensorParallelSize));
      setQuantization(settingsQuery.data.inference.quantization || '');
      setMaxNumSeqs(String(settingsQuery.data.inference.maxNumSeqs || '256'));
      setSwapSpace(String(settingsQuery.data.inference.swapSpace || '4'));
      setDtype(settingsQuery.data.inference.dtype || 'auto');
      setTrustRemoteCode(!!settingsQuery.data.inference.trustRemoteCode);
      setEnforceEager(!!settingsQuery.data.inference.enforceEager);
      setKvCacheDtype(settingsQuery.data.inference.kvCacheDtype || 'auto');
      setProvider(settingsQuery.data.inference.provider || 'auto');
    }
  }, [settingsQuery.data]);

  const startMutation = useMutation({
    mutationFn: api.startVllm,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime'] });
      await queryClient.invalidateQueries({ queryKey: ['runtime-health'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: api.stopVllm,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime'] });
      await queryClient.invalidateQueries({ queryKey: ['runtime-health'] });
    },
  });

  const deactivateLoraMutation = useMutation({
    mutationFn: api.deactivateLora,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime'] });
      await queryClient.invalidateQueries({ queryKey: ['runtime-health'] });
    },
  });

  const selectedProviderInfo = providersQuery.data?.available.find(p => p.id === provider);

  return (
    <div>
      <PageHeader title="Runtime" description="Запуск vLLM / Transformers и текущая активная модель." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Inference configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {providersQuery.data?.available.map(p => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.label} {!p.available ? '(Unavailable)' : ''}
                    </option>
                  ))}
                </select>
                {selectedProviderInfo && !selectedProviderInfo.available && (
                   <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                     <AlertCircle size={12} /> {selectedProviderInfo.reason}
                   </p>
                )}
                {selectedProviderInfo && selectedProviderInfo.available && (
                   <p className="mt-1 text-xs text-slate-500">
                     {selectedProviderInfo.description}
                   </p>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Model path or repo</label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Port</label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Tensor parallel (vLLM)</label>
                <Input value={tensorParallelSize} onChange={(e) => setTensorParallelSize(e.target.value)} disabled={provider === 'transformers'} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Max model len</label>
                <Input value={maxModelLen} onChange={(e) => setMaxModelLen(e.target.value)} />
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

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-slate-400">GPU utilization</label>
                <Input value={gpuMemoryUtilization} onChange={(e) => setGpuMemoryUtilization(e.target.value)} disabled={provider === 'transformers'} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Parallel seqs</label>
                <Input value={maxNumSeqs} onChange={(e) => setMaxNumSeqs(e.target.value)} disabled={provider === 'transformers'} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Swap space (GB)</label>
                <Input value={swapSpace} onChange={(e) => setSwapSpace(e.target.value)} disabled={provider === 'transformers'} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3">
                <input
                  id="trust-remote-code-manual"
                  type="checkbox"
                  checked={trustRemoteCode}
                  onChange={(e) => setTrustRemoteCode(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="trust-remote-code-manual" className="text-sm font-medium text-white cursor-pointer">
                  Trust Remote Code
                </label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="enforce-eager-manual"
                  type="checkbox"
                  checked={enforceEager}
                  onChange={(e) => setEnforceEager(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
                  disabled={provider === 'transformers'}
                />
                <label htmlFor="enforce-eager-manual" className={`text-sm font-medium ${provider === 'transformers' ? 'text-slate-600' : 'text-white'} cursor-pointer`}>
                  Enforce Eager Mode (vLLM)
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() =>
                  startMutation.mutate({
                    model,
                    port: Number(port),
                    maxModelLen: Number(maxModelLen),
                    gpuMemoryUtilization: Number(gpuMemoryUtilization),
                    tensorParallelSize: Number(tensorParallelSize),
                    quantization: quantization || null,
                    maxNumSeqs: Number(maxNumSeqs),
                    swapSpace: Number(swapSpace),
                    dtype,
                    trustRemoteCode,
                    enforceEager,
                    kvCacheDtype,
                    provider,
                  })
                }
                disabled={startMutation.isPending || (selectedProviderInfo && !selectedProviderInfo.available)}
              >
                {startMutation.isPending ? 'Starting...' : 'Start Runtime'}
              </Button>

              <Button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending || !runtimeQuery.data?.vllm.pid}
                className="bg-rose-500 text-white hover:bg-rose-400 disabled:bg-slate-800"
              >
                Stop
              </Button>

              <Button
                onClick={() => deactivateLoraMutation.mutate()}
                disabled={deactivateLoraMutation.isPending || !runtimeQuery.data?.vllm.activeLoraId}
                className="bg-slate-800 text-white hover:bg-slate-700"
              >
                Switch to base model
              </Button>
            </div>

            {startMutation.error ? <p className="text-sm text-rose-400 bg-rose-950/30 p-3 rounded-lg border border-rose-900/50">{(startMutation.error as Error).message}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runtime status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Health</span>
              <StatusBadge
                value={
                  healthQuery.data?.ok
                    ? 'healthy'
                    : (runtimeQuery.data?.vllm.pid ? 'starting' : 'failed')
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Provider</span>
              <span className="text-white capitalize font-medium">{runtimeQuery.data?.vllm.providerResolved || '—'}</span>
            </div>

            {runtimeQuery.data?.vllm.compatibilityRisk && (
              <div className={`p-2 rounded border text-xs ${runtimeQuery.data.vllm.compatibilityRisk === 'high' ? 'bg-rose-950/20 border-rose-900/50 text-rose-300' : 'bg-amber-950/20 border-amber-900/50 text-amber-300'}`}>
                <div className="font-bold flex items-center gap-1 mb-1">
                  <AlertCircle size={14} />
                  Compatibility {runtimeQuery.data.vllm.compatibilityRisk === 'high' ? 'Risk' : 'Warning'}
                </div>
                {runtimeQuery.data.vllm.compatibilityWarning}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-slate-400">PID</span>
              <span className="text-white font-mono">{runtimeQuery.data?.vllm.pid || '—'}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Active model</span>
              <span className="text-right text-white font-medium truncate max-w-[180px]" title={runtimeQuery.data?.vllm.activeModelName || ''}>
                {runtimeQuery.data?.vllm.activeModelName || '—'}
              </span>
            </div>

            {runtimeQuery.data?.vllm.activeLoraName && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Active LoRA</span>
                <span className="text-right text-white font-medium truncate max-w-[180px] text-blue-400">
                  {runtimeQuery.data?.vllm.activeLoraName}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Port</span>
              <span className="text-white">{runtimeQuery.data?.vllm.port || '—'}</span>
            </div>

            {runtimeQuery.data?.vllm?.probe && (
              <div className={`mt-2 p-3 rounded-xl border ${runtimeQuery.data.vllm.probe.ok ? 'bg-emerald-950/20 border-emerald-900/40' : 'bg-rose-950/20 border-rose-900/40'}`}>
                <div className="flex items-center justify-between mb-1">
                   <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Model Probe</span>
                   {runtimeQuery.data.vllm.probe.ok ? <CheckCircle2 size={14} className="text-emerald-500" /> : <AlertCircle size={14} className="text-rose-500" />}
                </div>
                <div className="text-sm text-white">
                  {runtimeQuery.data.vllm.probe.status === 'checking' ? 'In progress...' : (runtimeQuery.data.vllm.probe.ok ? 'Generation verified' : 'Probe failed')}
                </div>
                {runtimeQuery.data.vllm.probe.error && (
                  <div className="mt-1 text-[11px] text-rose-400 leading-tight">
                    {runtimeQuery.data.vllm.probe.error}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 text-xs font-medium text-slate-400 flex items-center gap-1">
              <Info size={12} /> Process Logs
            </div>
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-[10px] font-mono leading-tight text-slate-400 border border-slate-900">
              {logsQuery.data?.content || 'No logs available'}
            </pre>

            {healthQuery.data?.ok && (
              <Button
                onClick={() => navigate('/app/playground')}
                className="w-full bg-blue-600 hover:bg-blue-500 mt-2"
              >
                Open Playground
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

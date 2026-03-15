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

export default function RuntimePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const runtimeQuery = useQuery({ queryKey: ['runtime'], queryFn: api.getRuntime, refetchInterval: 5000 });
  const healthQuery = useQuery({ queryKey: ['runtime-health'], queryFn: api.getRuntimeHealth, refetchInterval: 5000 });
  const logsQuery = useQuery({ queryKey: ['runtime-logs'], queryFn: () => api.getRuntimeLogs(400), refetchInterval: 3000 });

  const [model, setModel] = useState('');
  const [port, setPort] = useState('8000');
  const [maxModelLen, setMaxModelLen] = useState('8192');
  const [gpuMemoryUtilization, setGpuMemoryUtilization] = useState('0.9');
  const [tensorParallelSize, setTensorParallelSize] = useState('1');
  const [quantization, setQuantization] = useState<string>('');
  const [dtype, setDtype] = useState('auto');
  const [trustRemoteCode, setTrustRemoteCode] = useState(true);
  const [enforceEager, setEnforceEager] = useState(false);
  const [kvCacheDtype, setKvCacheDtype] = useState('auto');

  useEffect(() => {
    if (settingsQuery.data) {
      setModel(settingsQuery.data.inference.model);
      setPort(String(settingsQuery.data.inference.port));
      setMaxModelLen(String(settingsQuery.data.inference.maxModelLen));
      setGpuMemoryUtilization(String(settingsQuery.data.inference.gpuMemoryUtilization));
      setTensorParallelSize(String(settingsQuery.data.inference.tensorParallelSize));
      setQuantization(settingsQuery.data.inference.quantization || '');
      setDtype(settingsQuery.data.inference.dtype || 'auto');
      setTrustRemoteCode(!!settingsQuery.data.inference.trustRemoteCode);
      setEnforceEager(!!settingsQuery.data.inference.enforceEager);
      setKvCacheDtype(settingsQuery.data.inference.kvCacheDtype || 'auto');
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

  return (
    <div>
      <PageHeader title="Runtime" description="Запуск vLLM и текущая активная модель / LoRA." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Manual vLLM configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Model path or repo</label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Port</label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Tensor parallel</label>
                <Input value={tensorParallelSize} onChange={(e) => setTensorParallelSize(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Max model len</label>
                <Input value={maxModelLen} onChange={(e) => setMaxModelLen(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">GPU memory utilization</label>
                <Input value={gpuMemoryUtilization} onChange={(e) => setGpuMemoryUtilization(e.target.value)} />
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
                />
                <label htmlFor="enforce-eager-manual" className="text-sm font-medium text-white cursor-pointer">
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
                    dtype,
                    trustRemoteCode,
                    enforceEager,
                    kvCacheDtype,
                  })
                }
                disabled={startMutation.isPending}
              >
                Start
              </Button>

              <Button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="bg-rose-500 text-white hover:bg-rose-400"
              >
                Stop
              </Button>

              <Button
                onClick={() => deactivateLoraMutation.mutate()}
                disabled={deactivateLoraMutation.isPending}
                className="bg-slate-800 text-white hover:bg-slate-700"
              >
                Switch to base model
              </Button>
            </div>

            {startMutation.error ? <p className="text-sm text-rose-300">{(startMutation.error as Error).message}</p> : null}
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
              <span className="text-slate-400">PID</span>
              <span className="text-white">{runtimeQuery.data?.vllm.pid || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Serving path</span>
              <span className="text-right text-white">{runtimeQuery.data?.vllm.model || 'Not running'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Base model</span>
              <span className="text-right text-white">{runtimeQuery.data?.vllm.baseModel || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Active model</span>
              <span className="text-right text-white">{runtimeQuery.data?.vllm.activeModelName || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Active LoRA</span>
              <span className="text-right text-white">{runtimeQuery.data?.vllm.activeLoraName || 'None'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Port</span>
              <span className="text-white">{runtimeQuery.data?.vllm.port || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Started</span>
              <span className="text-white">{fmtDate(runtimeQuery.data?.vllm.startedAt)}</span>
            </div>
            <div className="mt-2 text-xs font-medium text-slate-400">Health output</div>
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-[10px] leading-tight text-slate-300">
              {healthQuery.data?.raw || 'No health output'}
            </pre>

            <div className="mt-2 text-xs font-medium text-slate-400">vLLM process logs</div>
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-[10px] leading-tight text-slate-300">
              {logsQuery.data?.content || 'No logs yet'}
            </pre>

            {healthQuery.data?.ok && (
              <Button
                onClick={() => navigate('/app/playground')}
                className="w-full bg-blue-600 hover:bg-blue-500 mt-2"
              >
                Go to Playground
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
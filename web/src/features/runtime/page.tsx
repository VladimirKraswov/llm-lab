import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { StatusBadge } from '../../components/status-badge';
import { fmtDate } from '../../lib/utils';

export default function RuntimePage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const runtimeQuery = useQuery({ queryKey: ['runtime'], queryFn: api.getRuntime, refetchInterval: 5000 });
  const healthQuery = useQuery({ queryKey: ['runtime-health'], queryFn: api.getRuntimeHealth, refetchInterval: 5000 });

  const [model, setModel] = useState('');
  const [port, setPort] = useState('8000');
  const [maxModelLen, setMaxModelLen] = useState('8192');
  const [gpuMemoryUtilization, setGpuMemoryUtilization] = useState('0.9');
  const [tensorParallelSize, setTensorParallelSize] = useState('1');

  useEffect(() => {
    if (settingsQuery.data) {
      setModel(settingsQuery.data.inference.model);
      setPort(String(settingsQuery.data.inference.port));
      setMaxModelLen(String(settingsQuery.data.inference.maxModelLen));
      setGpuMemoryUtilization(String(settingsQuery.data.inference.gpuMemoryUtilization));
      setTensorParallelSize(String(settingsQuery.data.inference.tensorParallelSize));
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

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() =>
                  startMutation.mutate({
                    model,
                    port: Number(port),
                    maxModelLen: Number(maxModelLen),
                    gpuMemoryUtilization: Number(gpuMemoryUtilization),
                    tensorParallelSize: Number(tensorParallelSize),
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
              <StatusBadge value={healthQuery.data?.ok ? 'healthy' : 'failed'} />
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
            <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
              {healthQuery.data?.raw || 'No health output'}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
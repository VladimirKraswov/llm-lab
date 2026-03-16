import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api, apiBase } from '../../lib/api';
import { fmtDate } from '../../lib/utils';
import { StatusBadge } from '../../components/status-badge';
import { QuantizeModelModal } from './quantize-modal';

export default function ModelsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [repoId, setRepoId] = useState('Qwen/Qwen2.5-7B-Instruct');
  const [name, setName] = useState('Qwen 2.5 7B Instruct');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isQuantizeModalOpen, setIsQuantizeModalOpen] = useState(false);

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: api.getModels,
    refetchInterval: 5000,
  });

  const statsQuery = useQuery({
    queryKey: ['monitor-stats'],
    queryFn: api.getMonitorStats,
    refetchInterval: 10000,
  });

  const lorasQuery = useQuery({
    queryKey: ['loras'],
    queryFn: api.getLoras,
    refetchInterval: 5000,
  });

  const downloadMutation = useMutation({
    mutationFn: api.downloadModel,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const quantizeMutation = useMutation({
    mutationFn: api.quantizeModel,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.activateModel(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['runtime'] });
      await qc.invalidateQueries({ queryKey: ['runtime-health'] });
      navigate('/app/runtime');
    },
  });

  const activateLoraMutation = useMutation({
    mutationFn: (id: string) => api.activateLora(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['runtime'] });
      await qc.invalidateQueries({ queryKey: ['runtime-health'] });
      navigate('/app/runtime');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteModel,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const filteredLoras = useMemo(() => {
    if (!selectedModelId) return [];
    const model = modelsQuery.data?.find(m => m.id === selectedModelId);
    if (!model) return [];
    return (lorasQuery.data || []).filter(l => l.baseModelId === model.id || l.baseModelRef === model.repoId);
  }, [selectedModelId, modelsQuery.data, lorasQuery.data]);

  const maxVram = useMemo(() => {
    const gpus = statsQuery.data?.gpus || [];
    if (!gpus.length) return 0;
    return Math.max(...gpus.map(g => g.vram));
  }, [statsQuery.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models Library"
        description="Библиотека моделей и их LoRA адаптеров. Выбирай модель и используй её с нужной LoRA."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add new base model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Hugging Face repo id</label>
              <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="Qwen/Qwen2.5-7B-Instruct" />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Display name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Qwen 2.5 7B Instruct" />
            </div>
          </div>
          <Button
            onClick={() => downloadMutation.mutate({ repoId, name })}
            disabled={!repoId.trim() || downloadMutation.isPending}
          >
            {downloadMutation.isPending ? 'Starting download…' : 'Download base model'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Base Models</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-3">
            {modelsQuery.isLoading ? (
              <div className="text-sm text-slate-500">Loading models…</div>
            ) : !Array.isArray(modelsQuery.data) || !modelsQuery.data.length ? (
              <div className="text-sm text-slate-500">No models yet.</div>
            ) : (
              modelsQuery.data.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedModelId(item.id)}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${
                    selectedModelId === item.id
                      ? (item.size && maxVram && item.size > maxVram * 1024 * 1024 * 1024)
                        ? 'border-rose-500 bg-rose-500/10'
                        : 'border-blue-500 bg-blue-500/10'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-400 truncate">{item.repoId}</div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                        {item.sizeHuman && (
                          <div className="text-slate-400">
                            Size: <span className="text-slate-200">{item.sizeHuman}</span>
                          </div>
                        )}
                        {item.quantization && (
                          <div className="text-slate-400">
                            Quant: <span className="text-slate-200">{item.quantization}</span>
                          </div>
                        )}
                        {item.vramEstimate && (
                          <div className={
                            (item.size && maxVram && item.size > maxVram * 1024 * 1024 * 1024)
                              ? "text-rose-400 font-bold"
                              : "text-slate-400"
                          }>
                            VRAM: <span className={
                              (item.size && maxVram && item.size > maxVram * 1024 * 1024 * 1024)
                                ? "text-rose-300"
                                : "text-slate-200"
                            }>~{item.vramEstimate}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <StatusBadge value={item.status === 'ready' ? 'ready' : item.status} />
                  </div>

                  {selectedModelId === item.id && (
                    <div className="mt-4 flex gap-2">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          activateMutation.mutate({ id: item.id });
                        }}
                        disabled={item.status !== 'ready' || activateMutation.isPending}
                        className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-500"
                      >
                        Use in runtime
                      </Button>
                      <a
                        href={`${apiBase}/models/${item.id}/download`}
                        className="inline-flex h-8 items-center justify-center rounded-xl bg-slate-800 px-3 text-xs font-medium text-white hover:bg-slate-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Download
                      </a>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(item.id);
                        }}
                        disabled={deleteMutation.isPending}
                        className="h-8 px-3 text-xs bg-rose-700 hover:bg-rose-600"
                      >
                        Delete
                      </Button>

                      {item.status === 'ready' && !item.quantization && (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedModelId(item.id);
                            setIsQuantizeModalOpen(true);
                          }}
                          disabled={quantizeMutation.isPending}
                          className="h-8 px-3 text-xs bg-amber-700 hover:bg-amber-600"
                        >
                          AWQ
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>LoRA Adapters</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-3">
            {!selectedModelId ? (
              <div className="text-sm text-slate-500">Select a base model to see its LoRAs.</div>
            ) : !filteredLoras.length ? (
              <div className="text-sm text-slate-500">No LoRAs found for this model.</div>
            ) : (
              filteredLoras.map((lora) => (
                <div
                  key={lora.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{lora.name}</div>
                      <div className="mt-1 text-xs text-slate-500">Created {fmtDate(lora.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Merge status</div>
                      <div className="text-xs font-medium text-white">{lora.mergeStatus}</div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Button
                      onClick={() => activateLoraMutation.mutate(lora.id)}
                      disabled={activateLoraMutation.isPending}
                      className="h-8 w-full px-3 text-xs bg-emerald-600 hover:bg-emerald-500"
                    >
                      {activateLoraMutation.isPending ? 'Activating…' : 'Use with this LoRA'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {isQuantizeModalOpen && selectedModelId && (
        <QuantizeModelModal
          modelId={selectedModelId}
          modelName={modelsQuery.data?.find(m => m.id === selectedModelId)?.name || ''}
          onClose={() => setIsQuantizeModalOpen(false)}
          onQuantize={(params) => {
            quantizeMutation.mutate(params);
            setIsQuantizeModalOpen(false);
          }}
          isPending={quantizeMutation.isPending}
        />
      )}
    </div>
  );
}
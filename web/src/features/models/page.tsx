import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Wand2 } from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api, apiBase } from '../../lib/api';
import { fmtDate } from '../../lib/utils';
import { StatusBadge } from '../../components/status-badge';
import { QuantizeModelModal } from './quantize-modal';

function hasRealQuantization(value?: string | null) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== 'none' && normalized !== 'null' && normalized !== 'false';
}

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
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ['models'] });
      await qc.invalidateQueries({ queryKey: ['jobs'] });

      if (data.jobId) {
        navigate(`/app/jobs?selected=${encodeURIComponent(data.jobId)}`);
      }
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
    const model = modelsQuery.data?.find((m) => m.id === selectedModelId);
    if (!model) return [];
    return (lorasQuery.data || []).filter(
      (l) => l.baseModelId === model.id || l.baseModelRef === model.repoId,
    );
  }, [selectedModelId, modelsQuery.data, lorasQuery.data]);

  const maxVram = useMemo(() => {
    const gpus = statsQuery.data?.gpus || [];
    if (!gpus.length) return 0;
    return Math.max(...gpus.map((g) => g.vram));
  }, [statsQuery.data]);

  const selectedModel = useMemo(
    () => modelsQuery.data?.find((m) => m.id === selectedModelId) || null,
    [modelsQuery.data, selectedModelId],
  );

  const hasActiveBuild = quantizeMutation.isPending;

  const runQuickAwq = (modelId: string, modelName: string) => {
    quantizeMutation.mutate({
      modelId,
      method: 'awq',
      name: `${modelName} AWQ`,
      bits: 4,
      groupSize: 128,
      numSamples: 128,
      maxSeqLen: 2048,
      sym: true,
      runner: 'quant_env',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models Library"
        description="Библиотека моделей, быстрый запуск AWQ и выбор LoRA под каждую базовую модель."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add new base model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Hugging Face repo id</label>
              <Input
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                placeholder="Qwen/Qwen2.5-7B-Instruct"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Display name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Qwen 2.5 7B Instruct"
              />
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

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-white">
              <Wand2 size={16} className="text-amber-300" />
              <span className="font-medium">AWQ conversion</span>
            </div>
            <div className="mt-1 text-sm text-slate-300">
              Quick AWQ запускает рекомендуемые параметры сразу через isolated quant_env. Кнопка AWQ… открывает расширенную настройку.
            </div>
          </div>

          <div className="text-xs text-slate-400">
            Recommended default: 4-bit · group 128 · 128 samples · seq 2048
          </div>
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
              modelsQuery.data.map((item) => {
                const tooLarge =
                  !!(item.size && maxVram && item.size > maxVram * 1024 * 1024 * 1024);
                const isQuantized = hasRealQuantization(item.quantization);
                const capability = item.quantizationCapability;
                const canAwq =
                  item.status === 'ready' &&
                  !isQuantized &&
                  capability?.supported &&
                  capability.methods.includes('awq');

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedModelId(item.id)}
                    className={`cursor-pointer rounded-2xl border p-4 transition ${
                      selectedModelId === item.id
                        ? tooLarge
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
                          {item.quantization && String(item.quantization).toLowerCase() !== 'none' && (
                            <div className="text-slate-400">
                              Quant: <span className="text-slate-200">{item.quantization}</span>
                            </div>
                          )}
                          {item.vramEstimate && (
                            <div className={tooLarge ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                              VRAM:{' '}
                              <span className={tooLarge ? 'text-rose-300' : 'text-slate-200'}>
                                ~{item.vramEstimate}
                              </span>
                            </div>
                          )}
                          {item.runner && (
                            <div className="text-slate-400">
                              Runner: <span className="text-slate-200">{item.runner}</span>
                            </div>
                          )}
                        </div>

                        {capability?.reason ? (
                          <div className="mt-2 text-[11px] text-slate-500">
                            {capability.reason}
                          </div>
                        ) : null}

                        {capability?.experimental ? (
                          <div className="mt-1 text-[11px] text-amber-300">
                            Experimental quantization path
                          </div>
                        ) : null}
                      </div>
                      <StatusBadge value={item.status === 'ready' ? 'ready' : item.status} />
                    </div>

                    {selectedModelId === item.id ? (
                      <div className="mt-4 flex flex-wrap gap-2">
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

                        {canAwq ? (
                          <>
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                runQuickAwq(item.id, item.name);
                              }}
                              disabled={hasActiveBuild}
                              className="h-8 px-3 text-xs bg-amber-600 hover:bg-amber-500"
                            >
                              Quick AWQ
                            </Button>

                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedModelId(item.id);
                                setIsQuantizeModalOpen(true);
                              }}
                              disabled={hasActiveBuild}
                              className="h-8 px-3 text-xs bg-slate-800 hover:bg-slate-700"
                            >
                              AWQ…
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
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
                      <div className="mt-1 text-xs text-slate-500">
                        Created {fmtDate(lora.createdAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        Merge status
                      </div>
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

      {isQuantizeModalOpen && selectedModel ? (
        <QuantizeModelModal
          modelId={selectedModel.id}
          modelName={selectedModel.name}
          defaultRunner={(selectedModel.quantizationCapability?.runner as 'ml_env' | 'quant_env' | undefined) || 'quant_env'}
          onClose={() => setIsQuantizeModalOpen(false)}
          onQuantize={(params) => {
            quantizeMutation.mutate(params);
            setIsQuantizeModalOpen(false);
          }}
          isPending={quantizeMutation.isPending}
        />
      ) : null}
    </div>
  );
}
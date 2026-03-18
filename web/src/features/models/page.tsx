import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Wand2, Download, Trash2, Zap, Settings2 } from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api, apiBase } from '../../lib/api';
import { fmtDate } from '../../lib/utils';
import { StatusBadge } from '../../components/status-badge';
import { QuantizeModelModal } from './quantize-modal';
import { TruncatedText } from '../../components/ui/truncated-text';

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

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 30_000,
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
    onSuccess: async (data: any) => {
      await qc.invalidateQueries({ queryKey: ['models'] });
      await qc.invalidateQueries({ queryKey: ['jobs'] });

      if (data?.jobId) {
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

  const awqDefaults = (settingsQuery.data as any)?.quantization?.awq;

  const runQuickAwq = (modelId: string, modelName: string) => {
    quantizeMutation.mutate({
      modelId,
      method: 'awq',
      name: `${modelName} AWQ`,
      bits: awqDefaults?.bits ?? 4,
      groupSize: awqDefaults?.groupSize ?? 128,
      numSamples: awqDefaults?.numSamples ?? 32,
      maxSeqLen: awqDefaults?.maxSeqLen ?? 1024,
      sym: awqDefaults?.sym ?? false,
      dtype: awqDefaults?.dtype ?? 'float16',
      calibrationMode: awqDefaults?.calibrationMode ?? 'text_only',
      trustRemoteCode: awqDefaults?.trustRemoteCode ?? true,
      runner: 'quant_env',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models Library"
        description="Библиотека моделей, быстрый запуск AWQ и выбор LoRA под каждую базовую модель."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Add new base model</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Hugging Face repo id</label>
                  <Input
                    size="sm"
                    className="h-8 text-xs"
                    value={repoId}
                    onChange={(e) => setRepoId(e.target.value)}
                    placeholder="Qwen/Qwen2.5-7B-Instruct"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Display name</label>
                  <Input
                    size="sm"
                    className="h-8 text-xs"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Qwen 2.5 7B Instruct"
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => downloadMutation.mutate({ repoId, name })}
                disabled={!repoId.trim() || downloadMutation.isPending}
              >
                {downloadMutation.isPending ? 'Starting download…' : 'Download base model'}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-white">
                  <Wand2 size={14} className="text-amber-300" />
                  <span className="text-xs font-semibold uppercase tracking-tight">AWQ conversion</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                  Quick AWQ uses defaults from Settings. AWQ... for advanced setup.
                </div>
              </div>

              <div className="text-[10px] font-mono text-amber-500/70 whitespace-nowrap bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {awqDefaults?.dtype || 'float16'} · {awqDefaults?.bits ?? 4}b · g{awqDefaults?.groupSize ?? 128}
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Base Models</CardTitle>
              <div className="text-[10px] text-slate-500">{modelsQuery.data?.length || 0} items</div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[calc(100vh-420px)] min-h-[400px] overflow-y-auto p-4 space-y-2 scrollbar-thin">
                {modelsQuery.isLoading ? (
                  <div className="text-xs text-slate-500">Loading models…</div>
                ) : !Array.isArray(modelsQuery.data) || !modelsQuery.data.length ? (
                  <div className="text-xs text-slate-500">No models yet.</div>
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
                    className={`cursor-pointer rounded-xl border p-3 transition-all ${
                      selectedModelId === item.id
                        ? tooLarge
                          ? 'border-rose-500 bg-rose-500/10'
                          : 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/5'
                        : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <TruncatedText text={item.name} className="font-bold text-white text-sm" />
                        <TruncatedText text={item.repoId} className="mt-0.5 text-[10px] text-slate-500 font-mono" />

                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
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
                            <div className={tooLarge ? 'font-bold text-rose-400' : 'text-slate-400'}>
                              VRAM:{' '}
                              <span className={tooLarge ? 'text-rose-300' : 'text-slate-200 font-bold'}>
                                ~{item.vramEstimate}
                              </span>
                            </div>
                          )}
                        </div>

                        {capability?.reason ? (
                          <div className="mt-1.5 text-[10px] text-slate-500 leading-tight italic">{capability.reason}</div>
                        ) : null}
                      </div>
                      <StatusBadge value={item.status === 'ready' ? 'ready' : item.status} />
                    </div>

                    {selectedModelId === item.id ? (
                      <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-slate-800/50">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            activateMutation.mutate({ id: item.id });
                          }}
                          disabled={item.status !== 'ready' || activateMutation.isPending}
                          className="h-7 bg-blue-600 px-2 text-[10px] hover:bg-blue-500"
                        >
                          <Zap size={12} className="mr-1" /> Use in runtime
                        </Button>

                        <a
                          href={`${apiBase}/models/${item.id}/download`}
                          className="inline-flex h-7 items-center justify-center rounded-lg bg-slate-800 px-2 text-[10px] font-medium text-white hover:bg-slate-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={12} className="mr-1" /> Download
                        </a>

                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(item.id);
                          }}
                          disabled={deleteMutation.isPending}
                          className="h-7 bg-rose-700/80 px-2 text-[10px] hover:bg-rose-600"
                        >
                          <Trash2 size={12} className="mr-1" /> Delete
                        </Button>

                        {canAwq ? (
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                runQuickAwq(item.id, item.name);
                              }}
                              disabled={hasActiveBuild}
                              className="h-7 bg-amber-600 px-2 text-[10px] hover:bg-amber-500"
                            >
                              Quick AWQ
                            </Button>

                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedModelId(item.id);
                                setIsQuantizeModalOpen(true);
                              }}
                              disabled={hasActiveBuild}
                              className="h-7 bg-slate-800 px-2 text-[10px] hover:bg-slate-700"
                            >
                              <Settings2 size={12} />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>

    <Card className="flex flex-col h-full overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>LoRA Adapters</CardTitle>
        <div className="text-[10px] text-slate-500">{filteredLoras.length} items</div>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <div className="h-full overflow-y-auto p-4 space-y-2 scrollbar-thin bg-slate-950/20">
          {!selectedModelId ? (
            <div className="text-xs text-slate-500 text-center py-8">Select a base model to see its LoRAs.</div>
          ) : !filteredLoras.length ? (
            <div className="text-xs text-slate-500 text-center py-8">No LoRAs found for this model.</div>
          ) : (
            filteredLoras.map((lora) => (
              <div
                key={lora.id}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <TruncatedText text={lora.name} className="font-bold text-white text-sm" />
                    <div className="mt-1 text-[10px] text-slate-500">
                      Added {fmtDate(lora.createdAt)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Merge</div>
                    <div className="text-[10px] font-medium text-blue-400">{lora.mergeStatus}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <Button
                    size="sm"
                    onClick={() => activateLoraMutation.mutate(lora.id)}
                    disabled={activateLoraMutation.isPending}
                    className="h-7 w-full bg-emerald-600 px-2 text-[10px] hover:bg-emerald-500"
                  >
                    {activateLoraMutation.isPending ? 'Activating…' : 'Use with this LoRA'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  </div>

      {isQuantizeModalOpen && selectedModel ? (
        <QuantizeModelModal
          modelId={selectedModel.id}
          modelName={selectedModel.name}
          defaultRunner={
            (selectedModel.quantizationCapability?.runner as 'ml_env' | 'quant_env' | undefined) ||
            'quant_env'
          }
          onClose={() => setIsQuantizeModalOpen(false)}
          onQuantize={(params) => {
            quantizeMutation.mutate(params as any);
            setIsQuantizeModalOpen(false);
          }}
          isPending={quantizeMutation.isPending}
        />
      ) : null}
    </div>
  );
}
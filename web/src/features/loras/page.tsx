import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  api,
  apiBase,
  type BaseModelSource,
  type LoraItem,
  type MergeBuildOptions,
} from '../../lib/api';
import { fmtDate } from '../../lib/utils';

function defaultMergeForm(
  lora: LoraItem | null,
  defaults?: Partial<MergeBuildOptions>,
): MergeBuildOptions {
  return {
    deviceStrategy: lora?.mergeOptions?.deviceStrategy || defaults?.deviceStrategy || 'cpu',
    cudaDevice: lora?.mergeOptions?.cudaDevice ?? defaults?.cudaDevice ?? 0,
    dtype: lora?.mergeOptions?.dtype || defaults?.dtype || 'float16',
    lowCpuMemUsage: lora?.mergeOptions?.lowCpuMemUsage ?? defaults?.lowCpuMemUsage ?? true,
    safeSerialization: lora?.mergeOptions?.safeSerialization ?? defaults?.safeSerialization ?? true,
    overwriteOutput: lora?.mergeOptions?.overwriteOutput ?? defaults?.overwriteOutput ?? false,
    maxShardSize: lora?.mergeOptions?.maxShardSize || defaults?.maxShardSize || '5GB',
    offloadFolderName: lora?.mergeOptions?.offloadFolderName || defaults?.offloadFolderName || '_offload',
    clearGpuBeforeMerge: lora?.mergeOptions?.clearGpuBeforeMerge ?? defaults?.clearGpuBeforeMerge ?? false,
    trustRemoteCode: lora?.mergeOptions?.trustRemoteCode ?? defaults?.trustRemoteCode ?? false,
    registerAsModel: lora?.mergeOptions?.registerAsModel ?? defaults?.registerAsModel ?? true,
    customOutputName: lora?.mergeOptions?.customOutputName || '',
    baseModelSource: lora?.mergeOptions?.baseModelSource || defaults?.baseModelSource || 'auto',
    baseModelOverride: lora?.mergeOptions?.baseModelOverride || defaults?.baseModelOverride || '',
  };
}

export default function LorasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [mergeOpenId, setMergeOpenId] = useState<string | null>(null);
  const [logsOpenId, setLogsOpenId] = useState<string | null>(null);
  const [mergeForm, setMergeForm] = useState<MergeBuildOptions>(defaultMergeForm(null));

  const lorasQuery = useQuery({
    queryKey: ['loras'],
    queryFn: api.getLoras,
    refetchInterval: 5000,
  });

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: api.getModels,
    staleTime: 60_000,
  });

  const mergeOptionsQuery = useQuery({
    queryKey: ['loras', 'merge-options'],
    queryFn: api.getLoraMergeOptions,
    staleTime: 60_000,
  });

  const mergeLogsQuery = useQuery({
    queryKey: ['lora-merge-logs', logsOpenId],
    queryFn: () => api.getLoraMergeLogs(logsOpenId as string, 400),
    enabled: !!logsOpenId,
    refetchInterval: logsOpenId ? 3000 : false,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameLora(id, { name }),
    onSuccess: async () => {
      setEditingId(null);
      setEditingName('');
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.activateLora(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['runtime'] });
      await qc.invalidateQueries({ queryKey: ['runtime-health'] });
      navigate('/app/runtime');
    },
  });

  const buildMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<MergeBuildOptions> }) =>
      api.buildMergedLora(id, payload),
    onSuccess: async () => {
      setMergeOpenId(null);
      await qc.invalidateQueries({ queryKey: ['loras'] });
      await qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const cancelMergeMutation = useMutation({
    mutationFn: (id: string) => api.cancelMergedLora(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const packageMutation = useMutation({
    mutationFn: api.packageLora,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteLora,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const items = useMemo(() => lorasQuery.data || [], [lorasQuery.data]);
  const models = useMemo(
    () => (modelsQuery.data || []).filter((m) => m.status === 'ready'),
    [modelsQuery.data],
  );

  useEffect(() => {
    if (!mergeOpenId) return;
    const lora = items.find((x) => x.id === mergeOpenId) || null;
    const next = defaultMergeForm(lora, mergeOptionsQuery.data?.defaultOptions);

    if (!next.baseModelOverride && lora?.trainingBaseModelPath) {
      next.baseModelOverride = lora.trainingBaseModelPath;
    }

    setMergeForm(next);
  }, [mergeOpenId, items, mergeOptionsQuery.data]);

  const activeMergeItem = mergeOpenId ? items.find((x) => x.id === mergeOpenId) || null : null;
  const resolvedAutoBaseModel =
    activeMergeItem?.trainingBaseModelPath ||
    activeMergeItem?.baseModelRef ||
    '';

  const buildPayload: MergeBuildOptions = {
    ...mergeForm,
    baseModelSource: (mergeForm.baseModelSource || 'auto') as BaseModelSource,
    baseModelOverride:
      (mergeForm.baseModelSource || 'auto') === 'manual'
        ? (mergeForm.baseModelOverride || '').trim()
        : '',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="LoRAs"
        description="Список адаптеров, build merged-модели с настройками, выбором base model, активация на инференс и упаковка."
      />

      <Card>
        <CardHeader>
          <CardTitle>Stored LoRAs</CardTitle>
        </CardHeader>
        <CardContent>
          {!items.length ? (
            <div className="text-sm text-slate-500">
              No LoRAs yet. После completed training они создаются автоматически.
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => {
                const isBuilding = item.mergeStatus === 'building';
                return (
                  <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        {editingId === item.id ? (
                          <div className="flex max-w-xl gap-2">
                            <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                            <Button onClick={() => renameMutation.mutate({ id: item.id, name: editingName })}>
                              Save
                            </Button>
                          </div>
                        ) : (
                          <div className="text-base font-semibold text-white">{item.name}</div>
                        )}

                        <div className="mt-1 text-sm text-slate-400">Base model: {item.baseModelName}</div>
                        <div className="mt-1 text-sm text-slate-400">Job: {item.jobId}</div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                          {item.sizeHuman && (
                            <div className="text-slate-400">
                              Adapter size: <span className="text-slate-200">{item.sizeHuman}</span>
                            </div>
                          )}
                          {item.mergedSizeHuman && (
                            <div className="text-slate-400">
                              Merged size: <span className="text-slate-200">{item.mergedSizeHuman}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">Adapter: {item.adapterPath}</div>
                        <div className="mt-1 text-xs text-slate-500">Merged: {item.mergedPath || 'not built'}</div>
                        <div className="mt-1 text-xs text-slate-500">Package: {item.packagePath || 'not built'}</div>
                        <div className="mt-1 text-xs text-slate-500">Created: {fmtDate(item.createdAt)}</div>

                        {item.trainingBaseModelPath ? (
                          <div className="mt-1 text-xs text-slate-500">
                            Training base: {item.trainingBaseModelPath}
                          </div>
                        ) : null}

                        {item.mergeOptions ? (
                          <div className="mt-2 text-xs text-slate-400">
                            Last merge: {item.mergeOptions.deviceStrategy} / {item.mergeOptions.dtype || 'auto'} /{' '}
                            {item.mergeOptions.baseModelSource === 'manual' ? 'manual base' : 'auto base'}
                          </div>
                        ) : null}

                        {item.error ? <div className="mt-2 text-sm text-rose-300">{item.error}</div> : null}
                      </div>

                      <div className="text-right text-sm md:w-64">
                        <div className="text-slate-400">
                          Merge: <span className="text-white">{item.mergeStatus}</span>
                        </div>
                        {isBuilding && (
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{ width: `${item.mergeProgress || 0}%` }}
                            />
                          </div>
                        )}
                        <div className="mt-2 text-slate-400">
                          Package: <span className="text-white">{item.packageStatus}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        className="bg-slate-800 hover:bg-slate-700"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditingName(item.name);
                        }}
                      >
                        Rename
                      </Button>

                      <Button
                        className="bg-slate-800 hover:bg-slate-700"
                        onClick={() => setMergeOpenId(item.id)}
                      >
                        Merge settings
                      </Button>

                      <Button
                        className="bg-slate-800 hover:bg-slate-700"
                        onClick={() => setLogsOpenId(item.id)}
                      >
                        Merge logs
                      </Button>

                      {isBuilding ? (
                        <Button
                          className="bg-amber-700 text-white hover:bg-amber-600"
                          onClick={() => cancelMergeMutation.mutate(item.id)}
                          disabled={cancelMergeMutation.isPending}
                        >
                          Cancel merge
                        </Button>
                      ) : (
                        <Button
                          className="bg-slate-800 hover:bg-slate-700"
                          onClick={() =>
                            buildMutation.mutate({
                              id: item.id,
                              payload: item.mergeOptions || {
                                ...mergeOptionsQuery.data?.defaultOptions,
                                baseModelSource: 'auto',
                                baseModelOverride: '',
                              },
                            })
                          }
                          disabled={buildMutation.isPending}
                        >
                          Quick build
                        </Button>
                      )}

                      <Button
                        onClick={() => activateMutation.mutate(item.id)}
                        disabled={activateMutation.isPending}
                      >
                        Use in runtime
                      </Button>

                      <Button
                        className="bg-emerald-700 text-white hover:bg-emerald-600"
                        onClick={() => packageMutation.mutate(item.id)}
                        disabled={packageMutation.isPending}
                      >
                        Package
                      </Button>

                      {item.packagePath ? (
                        <a
                          href={`${apiBase}/loras/${item.id}/package/download`}
                          className="inline-flex items-center justify-center rounded-xl bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600"
                        >
                          Download package
                        </a>
                      ) : null}

                      <Button
                        className="bg-rose-700 text-white hover:bg-rose-600"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {mergeOpenId && activeMergeItem ? (
        <Card>
          <CardHeader>
            <CardTitle>Merge settings: {activeMergeItem.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <div className="text-sm text-slate-300">Base model source</div>
                <select
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={mergeForm.baseModelSource || 'auto'}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      baseModelSource: e.target.value as BaseModelSource,
                    }))
                  }
                >
                  <option value="auto">auto (from LoRA training config)</option>
                  <option value="manual">manual</option>
                </select>
              </label>

              <label className="space-y-2">
                <div className="text-sm text-slate-300">Device strategy</div>
                <select
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={mergeForm.deviceStrategy}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      deviceStrategy: e.target.value as MergeBuildOptions['deviceStrategy'],
                    }))
                  }
                >
                  {(mergeOptionsQuery.data?.deviceStrategies || ['cpu', 'cuda', 'auto']).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <div className="text-sm text-slate-300">Dtype</div>
                <select
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={mergeForm.dtype}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      dtype: e.target.value as MergeBuildOptions['dtype'],
                    }))
                  }
                >
                  {(mergeOptionsQuery.data?.dtypes || ['auto', 'float16', 'bfloat16', 'float32']).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <div className="text-sm text-slate-300">CUDA device</div>
                <select
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  value={String(mergeForm.cudaDevice ?? 0)}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      cudaDevice: Number(e.target.value),
                    }))
                  }
                  disabled={mergeForm.deviceStrategy === 'cpu'}
                >
                  {(mergeOptionsQuery.data?.gpus || []).length ? (
                    mergeOptionsQuery.data!.gpus.map((gpu, idx) => (
                      <option key={idx} value={idx}>
                        GPU {idx}: {gpu.model} ({gpu.vram} MB)
                      </option>
                    ))
                  ) : (
                    <option value="0">GPU 0</option>
                  )}
                </select>
              </label>

              <label className="space-y-2">
                <div className="text-sm text-slate-300">Max shard size</div>
                <Input
                  value={mergeForm.maxShardSize || '5GB'}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      maxShardSize: e.target.value,
                    }))
                  }
                  placeholder="5GB"
                />
              </label>

              <label className="space-y-2">
                <div className="text-sm text-slate-300">Offload folder name</div>
                <Input
                  value={mergeForm.offloadFolderName || '_offload'}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      offloadFolderName: e.target.value,
                    }))
                  }
                  placeholder="_offload"
                />
              </label>

              <label className="space-y-2">
                <div className="text-sm text-slate-300">Custom output name</div>
                <Input
                  value={mergeForm.customOutputName || ''}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      customOutputName: e.target.value,
                    }))
                  }
                  placeholder="optional-custom-name"
                />
              </label>
            </div>

            {(mergeForm.baseModelSource || 'auto') === 'auto' ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="text-sm font-medium text-white">Resolved base model</div>
                <div className="mt-2 break-all text-sm text-slate-300">
                  {resolvedAutoBaseModel || 'Not found in adapter_config.json'}
                </div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-sm text-slate-300">Select base model from library</div>
                  <select
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                    value={mergeForm.baseModelOverride || ''}
                    onChange={(e) =>
                      setMergeForm((prev) => ({
                        ...prev,
                        baseModelOverride: e.target.value,
                      }))
                    }
                  >
                    <option value="">-- select model --</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.path}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <div className="text-sm text-slate-300">Manual base model path / repo</div>
                  <Input
                    value={mergeForm.baseModelOverride || ''}
                    onChange={(e) =>
                      setMergeForm((prev) => ({
                        ...prev,
                        baseModelOverride: e.target.value,
                      }))
                    }
                    placeholder="Qwen/Qwen3-32B or /path/to/model"
                  />
                </label>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!mergeForm.lowCpuMemUsage}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      lowCpuMemUsage: e.target.checked,
                    }))
                  }
                />
                lowCpuMemUsage
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!mergeForm.safeSerialization}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      safeSerialization: e.target.checked,
                    }))
                  }
                />
                safeSerialization
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!mergeForm.overwriteOutput}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      overwriteOutput: e.target.checked,
                    }))
                  }
                />
                overwriteOutput
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!mergeForm.clearGpuBeforeMerge}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      clearGpuBeforeMerge: e.target.checked,
                    }))
                  }
                />
                clearGpuBeforeMerge
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!mergeForm.registerAsModel}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      registerAsModel: e.target.checked,
                    }))
                  }
                />
                registerAsModel
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!mergeForm.trustRemoteCode}
                  onChange={(e) =>
                    setMergeForm((prev) => ({
                      ...prev,
                      trustRemoteCode: e.target.checked,
                    }))
                  }
                />
                trustRemoteCode
              </label>
            </div>

            <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
              Для больших моделей safest path — <span className="font-semibold">CPU + float16</span>.
              Модель по умолчанию берётся из <code>adapter_config.json</code>, но её можно заменить вручную.
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  buildMutation.mutate({
                    id: activeMergeItem.id,
                    payload: buildPayload,
                  })
                }
                disabled={
                  buildMutation.isPending ||
                  ((mergeForm.baseModelSource || 'auto') === 'manual' &&
                    !String(mergeForm.baseModelOverride || '').trim())
                }
              >
                Start merge
              </Button>

              <Button
                className="bg-slate-800 hover:bg-slate-700"
                onClick={() => {
                  const next = defaultMergeForm(activeMergeItem, mergeOptionsQuery.data?.defaultOptions);
                  if (!next.baseModelOverride && activeMergeItem?.trainingBaseModelPath) {
                    next.baseModelOverride = activeMergeItem.trainingBaseModelPath;
                  }
                  setMergeForm(next);
                }}
              >
                Reset
              </Button>

              <Button
                className="bg-slate-800 hover:bg-slate-700"
                onClick={() => setMergeOpenId(null)}
              >
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {logsOpenId ? (
        <Card>
          <CardHeader>
            <CardTitle>Merge logs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-xs text-slate-500">
              {mergeLogsQuery.data?.logFile || 'No merge log file yet'}
            </div>

            <pre className="max-h-[500px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200">
              {mergeLogsQuery.data?.content || 'No logs yet'}
            </pre>

            <div className="flex gap-2">
              <Button
                className="bg-slate-800 hover:bg-slate-700"
                onClick={() => mergeLogsQuery.refetch()}
              >
                Refresh
              </Button>
              <Button
                className="bg-slate-800 hover:bg-slate-700"
                onClick={() => setLogsOpenId(null)}
              >
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
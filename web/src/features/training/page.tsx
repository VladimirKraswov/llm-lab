import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';

export default function TrainingPage() {
  const navigate = useNavigate();

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.getDatasets });
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: api.getModels });
  const lorasQuery = useQuery({ queryKey: ['loras'], queryFn: api.getLoras });
  const workersQuery = useQuery({ queryKey: ['workers'], queryFn: api.getWorkers });

  const [datasetId, setDatasetId] = useState('');
  const [name, setName] = useState('');
  const [modelId, setModelId] = useState('');
  const [epochs, setEpochs] = useState('3');
  const [lr, setLr] = useState('0.0002');
  const [batchSize, setBatchSize] = useState('1');
  const [gradAcc, setGradAcc] = useState('8');
  const [maxSeqLength, setMaxSeqLength] = useState('4096');
  const [loraR, setLoraR] = useState('16');
  const [loraAlpha, setLoraAlpha] = useState('16');
  const [loraDropout, setLoraDropout] = useState('0');
  const [trainingType, setTrainingType] = useState<'standard' | 'lora' | 'qlora'>('qlora');
  const [targetModules, setTargetModules] = useState('q_proj, v_proj, k_proj, o_proj, gate_proj, up_proj, down_proj');
  const [loadIn4bit, setLoadIn4bit] = useState(true);

  // Remote specific
  const [isRemote, setIsRemote] = useState(false);
  const [workerId, setWorkerId] = useState('any');
  const [runtimePresetId, setRuntimePresetId] = useState('');
  const [hfPushEnabled, setHfPushEnabled] = useState(true);
  const [hfRepoLora, setHfRepoLora] = useState('');
  const [hfRepoMerged, setHfRepoMerged] = useState('');

  const presetsQuery = useQuery({
    queryKey: ['runtime-presets'],
    queryFn: api.getRuntimePresets,
    enabled: isRemote
  });

  useEffect(() => {
    if (settingsQuery.data?.qlora) {
      setEpochs(String(settingsQuery.data.qlora.numTrainEpochs));
      setLr(String(settingsQuery.data.qlora.learningRate));
      setBatchSize(String(settingsQuery.data.qlora.perDeviceTrainBatchSize));
      setGradAcc(String(settingsQuery.data.qlora.gradientAccumulationSteps));
      setMaxSeqLength(String(settingsQuery.data.qlora.maxSeqLength));
      setLoraR(String(settingsQuery.data.qlora.loraR));
      setLoraAlpha(String(settingsQuery.data.qlora.loraAlpha));
      setLoraDropout(String(settingsQuery.data.qlora.loraDropout));
      setTargetModules((settingsQuery.data.qlora.targetModules || []).join(', '));
      setLoadIn4bit(!!settingsQuery.data.qlora.loadIn4bit);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    if (isRemote && presetsQuery.data && !runtimePresetId) {
      setRuntimePresetId(presetsQuery.data[0]?.id || '');
    }
  }, [isRemote, presetsQuery.data, runtimePresetId]);

  useEffect(() => {
    const data = datasetsQuery.data;
    if (Array.isArray(data) && !datasetId && data[0]?.id) {
      setDatasetId(data[0].id);
    }
  }, [datasetsQuery.data, datasetId]);

  useEffect(() => {
    const data = modelsQuery.data;
    if (Array.isArray(data)) {
      const firstReadyModel = data.find((m) => m.status === 'ready');
      if (!modelId && firstReadyModel?.id) setModelId(firstReadyModel.id);
    }
  }, [modelsQuery.data, modelId]);

  const filteredLoras = useMemo(() => {
    const data = lorasQuery.data;
    if (Array.isArray(data)) {
      return data.filter((x) => x.baseModelId === modelId);
    }
    return [];
  }, [lorasQuery.data, modelId]);

  const selectedModel = useMemo(() => {
    const data = modelsQuery.data;
    if (Array.isArray(data)) {
      return data.find((x) => x.id === modelId) || null;
    }
    return null;
  }, [modelsQuery.data, modelId]);

  const selectedPreset = useMemo(() => {
    return presetsQuery.data?.find(p => p.id === runtimePresetId) || null;
  }, [presetsQuery.data, runtimePresetId]);

  const startMutation = useMutation({
    mutationFn: (payload: any) => isRemote ? api.startRemoteTrain(payload) : api.startFineTune(payload),
    onSuccess: (data: any) => {
      const id = isRemote ? data.id : data.jobId;
      navigate(`/app/jobs?selected=${id}`);
    },
  });

  const handleStart = () => {
    const qloraParams = {
      numTrainEpochs: Number(epochs),
      learningRate: Number(lr),
      perDeviceTrainBatchSize: Number(batchSize),
      gradientAccumulationSteps: Number(gradAcc),
      maxSeqLength: Number(maxSeqLength),
      useLora: trainingType !== 'standard',
      loadIn4bit: loadIn4bit,
      loraR: Number(loraR),
      loraAlpha: Number(loraAlpha),
      loraDropout: Number(loraDropout),
      targetModules: targetModules.split(',').map(s => s.trim()).filter(Boolean),
    };

    if (isRemote) {
      startMutation.mutate({
        datasetId,
        name,
        qlora: qloraParams,
        workerId: workerId === 'any' ? undefined : workerId,
        runtimePresetId,
        hfPublish: {
          enabled: hfPushEnabled,
          push_lora: true,
          push_merged: true,
          repo_id_lora: hfRepoLora,
          repo_id_merged: hfRepoMerged,
        }
      });
    } else {
      startMutation.mutate({
        datasetId,
        name,
        modelId,
        qlora: qloraParams,
      });
    }
  };

  return (
    <div>
      <PageHeader title="Training" description="Выбери базовую модель, датасет и настройки обучения. Поддерживается локальное и удаленное обучение на GPU воркерах." />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>New training job</CardTitle>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${!isRemote ? 'text-blue-400 font-bold' : 'text-slate-500'}`}>LOCAL</span>
              <button
                onClick={() => setIsRemote(!isRemote)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isRemote ? 'bg-blue-600' : 'bg-slate-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isRemote ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className={`text-xs ${isRemote ? 'text-blue-400 font-bold' : 'text-slate-500'}`}>REMOTE</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {!isRemote ? (
                <div>
                  <label className="mb-2 block text-sm text-slate-400">Base model</label>
                  <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                    <option value="">Select model</option>
                    {Array.isArray(modelsQuery.data) && modelsQuery.data.map((m) => (
                      <option key={m.id} value={m.id} disabled={m.status !== 'ready'}>
                        {m.name} {m.status !== 'ready' ? `(${m.status})` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-sm text-slate-400">Runtime Preset</label>
                  <Select value={runtimePresetId} onChange={(e) => setRuntimePresetId(e.target.value)}>
                    <option value="">Select preset</option>
                    {presetsQuery.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm text-slate-400">Dataset</label>
                <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                  <option value="">Select dataset</option>
                  {Array.isArray(datasetsQuery.data) && datasetsQuery.data.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name} ({ds.rows})
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {isRemote && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-slate-400">Target Worker</label>
                  <Select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                    <option value="any">Any available</option>
                    {Array.isArray(workersQuery.data) && workersQuery.data.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.status})
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                   <label className="mb-2 block text-sm text-slate-400">Job Name</label>
                   <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="remote-run-01" />
                </div>
              </div>
            )}

            {!isRemote && (
              <div>
                <label className="mb-2 block text-sm text-slate-400">Job / LoRA name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-bot-v1" />
              </div>
            )}

            {isRemote && (
              <div className="rounded-xl border border-blue-900/30 bg-blue-950/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-blue-400">Hugging Face Publishing</h4>
                  <input
                    type="checkbox"
                    checked={hfPushEnabled}
                    onChange={(e) => setHfPushEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                </div>
                {hfPushEnabled && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      size="sm"
                      value={hfRepoLora}
                      onChange={(e) => setHfRepoLora(e.target.value)}
                      placeholder="Username/repo-lora"
                    />
                    <Input
                      size="sm"
                      value={hfRepoMerged}
                      onChange={(e) => setHfRepoMerged(e.target.value)}
                      placeholder="Username/repo-merged"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 border-t border-slate-800 pt-4">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Training Type</label>
                <Select value={trainingType} onChange={(e) => {
                  const val = e.target.value as any;
                  setTrainingType(val);
                  if (val === 'qlora') setLoadIn4bit(true);
                  if (val === 'standard') setLoadIn4bit(false);
                }}>
                  <option value="standard">Standard (Full Fine-tune)</option>
                  <option value="lora">LoRA</option>
                  <option value="qlora">QLoRA (4-bit)</option>
                </Select>
              </div>

              <div>
                <div className="mb-2 block text-sm text-slate-400">Options</div>
                <div className="flex items-center gap-4 h-10">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loadIn4bit}
                      onChange={(e) => setLoadIn4bit(e.target.checked)}
                      disabled={trainingType === 'qlora'}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600"
                    />
                    <span className="text-sm text-slate-300">4-bit loading</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-400">Epochs</label>
                <Input value={epochs} onChange={(e) => setEpochs(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Learning rate</label>
                <Input value={lr} onChange={(e) => setLr(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Batch size</label>
                <Input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Grad accumulation</label>
                <Input value={gradAcc} onChange={(e) => setGradAcc(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Max seq length</label>
                <Input value={maxSeqLength} onChange={(e) => setMaxSeqLength(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">LoRA R</label>
                <Input value={loraR} onChange={(e) => setLoraR(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
               <div>
                <label className="mb-2 block text-sm text-slate-400">LoRA Alpha</label>
                <Input value={loraAlpha} onChange={(e) => setLoraAlpha(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">LoRA Dropout</label>
                <Input value={loraDropout} onChange={(e) => setLoraDropout(e.target.value)} disabled={trainingType === 'standard'} />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-400">Target modules (comma separated)</label>
              <Input
                value={targetModules}
                onChange={(e) => setTargetModules(e.target.value)}
                placeholder="q_proj, v_proj, k_proj, o_proj"
                disabled={trainingType === 'standard'}
              />
            </div>

            <Button
              onClick={handleStart}
              disabled={!datasetId || (!isRemote && !modelId) || startMutation.isPending}
              className="w-full"
            >
              {startMutation.isPending ? 'Starting…' : isRemote ? 'Start remote training' : 'Start local fine-tune'}
            </Button>

            {startMutation.error ? <p className="text-sm text-rose-300">{(startMutation.error as Error).message}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-slate-400">Selected model</div>
              <div className="mt-1 text-white">
                {isRemote ? (selectedPreset?.title || '—') : (selectedModel?.name || '—')}
              </div>
              <div className="text-[10px] text-slate-500 font-mono uppercase mt-0.5">
                {isRemote ? (selectedPreset?.logicalBaseModelId || 'NONE') : (selectedModel?.repoId || 'None')}
              </div>
            </div>

            {isRemote && selectedPreset && (
              <div className="rounded-xl border border-blue-900/30 bg-blue-950/10 p-3 text-[11px] text-blue-200/70 space-y-1">
                <div className="font-bold text-blue-400 uppercase text-[10px]">Preset Details</div>
                <div><span className="opacity-50">Base Model:</span> {selectedPreset.logicalBaseModelId}</div>
                <div><span className="opacity-50">Image:</span> <span className="font-mono">{selectedPreset.trainerImage}</span></div>
                <div><span className="opacity-50">SHM Size:</span> {selectedPreset.defaultShmSize}</div>
              </div>
            )}

            <div>
              <div className="text-sm text-slate-400">Existing LoRAs under this model</div>
              <div className="mt-2 space-y-2">
                {!filteredLoras.length ? (
                  <div className="text-sm text-slate-500">No LoRAs yet for this model.</div>
                ) : (
                  filteredLoras.map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-950/40 p-3">
                      <div className="font-medium text-white">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">Job: {item.jobId}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-sm text-slate-400">
              После завершения обучения LoRA появится в списке LoRAs. В удаленном режиме все веса будут опубликованы в Hugging Face.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

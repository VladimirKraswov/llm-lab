import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { cn } from '../../lib/utils';

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

  // Unified Agent-based execution
  const [workerId, setWorkerId] = useState('any');
  const [runtimePresetId, setRuntimePresetId] = useState('');
  const [hfRepoLora, setHfRepoLora] = useState('');
  const [hfRepoMerged, setHfRepoMerged] = useState('');

  // Pipeline state
  const [pipelineEnabled, setPipelineEnabled] = useState(true);
  const [stagePrepare, setStagePrepare] = useState(true);
  const [stageTraining, setStageTraining] = useState(true);
  const [stageMerge, setStageMerge] = useState(true);
  const [stageEval, setStageEval] = useState(false);
  const [stagePublish, setStagePublish] = useState(true);
  const [stageUpload, setStageUpload] = useState(true);

  // Advanced Evaluation State
  const [evalSystemPrompt, setEvalSystemPrompt] = useState('');
  const [evalPromptTemplate, setEvalPromptTemplate] = useState('');
  const [evalMaxSamples, setEvalMaxSamples] = useState('100');
  const [evalMaxTokens, setEvalMaxTokens] = useState('128');
  const [evalTemp, setEvalTemp] = useState('0');
  const [evalDoSample, setEvalDoSample] = useState(false);
  const [evalTarget, setEvalTarget] = useState<'auto' | 'lora' | 'merged'>('auto');
  const [evalParsingRegex, setEvalParsingRegex] = useState('');
  const [evalScoreMin, setEvalScoreMin] = useState('0');
  const [evalScoreMax, setEvalScoreMax] = useState('5');
  const [evalDatasetId, setEvalDatasetId] = useState('');

  const [showAdvancedEval, setShowAdvancedEval] = useState(false);

  const presetsQuery = useQuery({
    queryKey: ['runtime-presets'],
    queryFn: api.getRuntimePresets,
  });

  const evalDatasetsQuery = useQuery({
    queryKey: ['eval-datasets'],
    queryFn: api.getEvalDatasets,
    enabled: stageEval
  });

  const evalConfigQuery = useQuery({
    queryKey: ['eval-config'],
    queryFn: api.getEvalConfig,
    enabled: stageEval
  });

  useEffect(() => {
    if (evalConfigQuery.data) {
       setEvalPromptTemplate(prev => prev || evalConfigQuery.data.defaultPromptTemplate);
    }
  }, [evalConfigQuery.data]);

  useEffect(() => {
    if (evalDatasetsQuery.data && !evalDatasetId && evalDatasetsQuery.data.length > 0) {
      setEvalDatasetId(evalDatasetsQuery.data[0].id);
    }
  }, [evalDatasetsQuery.data, evalDatasetId]);

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
    if (presetsQuery.data && !runtimePresetId) {
      setRuntimePresetId(presetsQuery.data[0]?.id || '');
    }
  }, [presetsQuery.data, runtimePresetId]);

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
    if (!Array.isArray(presetsQuery.data)) return null;
    return presetsQuery.data.find(p => p.id === runtimePresetId) || null;
  }, [presetsQuery.data, runtimePresetId]);

  const startMutation = useMutation({
    mutationFn: (payload: any) => api.startRemoteTrain(payload),
    onSuccess: (data: any) => {
      navigate(`/app/jobs?selected=${data.id}`);
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

    const selectedEvalDataset = Array.isArray(evalDatasetsQuery.data)
      ? evalDatasetsQuery.data.find(d => d.id === evalDatasetId)
      : null;

    const pipeline = {
      prepare_assets: { enabled: stagePrepare },
      training: { enabled: stageTraining },
      merge: { enabled: stageMerge },
      evaluation: {
        enabled: stageEval,
        target: evalTarget,
        max_samples: evalMaxSamples ? Number(evalMaxSamples) : null,
        max_new_tokens: Number(evalMaxTokens),
        temperature: Number(evalTemp),
        do_sample: evalDoSample,
        system_prompt: evalSystemPrompt || null,
        prompt_template: evalPromptTemplate || undefined,
        parsing_regex: evalParsingRegex || null,
        score_min: Number(evalScoreMin),
        score_max: Number(evalScoreMax),
        dataset: selectedEvalDataset ? {
          source: 'local',
          path: selectedEvalDataset.jsonPath,
          format: 'jsonl',
        } : undefined,
      },
      publish: {
        enabled: stagePublish,
        push_lora: true,
        push_merged: stageMerge,
        repo_id_lora: hfRepoLora,
        repo_id_merged: hfRepoMerged,
      },
      upload: { enabled: stageUpload },
    };

    startMutation.mutate({
      datasetId,
      name,
      qlora: qloraParams,
      workerId: workerId === 'any' ? undefined : workerId,
      runtimePresetId,
      hfPublish: {
        enabled: stagePublish,
        push_lora: true,
        push_merged: stageMerge,
        repo_id_lora: hfRepoLora,
        repo_id_merged: hfRepoMerged,
      },
      pipeline: pipelineEnabled ? pipeline : undefined,
    });
  };

  return (
    <div>
      <PageHeader title="Training" description="Обучение моделей теперь полностью выполняется через агентов. Соберите pipeline шагов и назначьте его на подходящего воркера." />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Pipeline Configuration</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Executor: Agent</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
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
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="train-run-01" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Pipeline Configuration</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase">Custom Pipeline</span>
                    <button
                      onClick={() => setPipelineEnabled(!pipelineEnabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${pipelineEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${pipelineEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>

                {pipelineEnabled && !showAdvancedEval && (
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    <div className={cn("p-3 rounded-xl border transition-colors", stagePrepare ? "bg-slate-800/40 border-slate-700" : "bg-slate-950/20 border-slate-900")}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">Prepare Assets</span>
                        <input type="checkbox" checked={stagePrepare} onChange={e => setStagePrepare(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600 border-slate-700" />
                      </div>
                      <p className="text-[10px] text-slate-500">Download datasets and prerequisites.</p>
                    </div>

                    <div className={cn("p-3 rounded-xl border transition-colors", stageTraining ? "bg-slate-800/40 border-slate-700" : "bg-slate-950/20 border-slate-900")}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">Training</span>
                        <input type="checkbox" checked={stageTraining} onChange={e => setStageTraining(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600 border-slate-700" />
                      </div>
                      <p className="text-[10px] text-slate-500">Run LoRA/QLoRA training.</p>
                    </div>

                    <div className={cn("p-3 rounded-xl border transition-colors", stageMerge ? "bg-slate-800/40 border-slate-700" : "bg-slate-950/20 border-slate-900")}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">Merge LoRA</span>
                        <input type="checkbox" checked={stageMerge} onChange={e => setStageMerge(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600 border-slate-700" />
                      </div>
                      <p className="text-[10px] text-slate-500">Export merged 16-bit model.</p>
                    </div>

                    <div className={cn("p-3 rounded-xl border transition-colors flex flex-col", stageEval ? "bg-slate-800/40 border-slate-700" : "bg-slate-950/20 border-slate-900")}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">Evaluation</span>
                        <input type="checkbox" checked={stageEval} onChange={e => setStageEval(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600 border-slate-700" />
                      </div>
                      <p className="text-[10px] text-slate-500 flex-1">Run benchmark after training.</p>
                      {stageEval && (
                        <button
                          onClick={(e) => { e.preventDefault(); setShowAdvancedEval(!showAdvancedEval); }}
                          className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 font-medium text-left flex items-center gap-1"
                        >
                          {showAdvancedEval ? 'Hide Settings' : 'Configure Evaluation'}
                        </button>
                      )}
                    </div>

                    <div className={cn("p-3 rounded-xl border transition-colors", stagePublish ? "bg-slate-800/40 border-slate-700" : "bg-slate-950/20 border-slate-900")}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">HF Publish</span>
                        <input type="checkbox" checked={stagePublish} onChange={e => setStagePublish(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600 border-slate-700" />
                      </div>
                      {stagePublish && (
                        <div className="space-y-2 mt-2">
                          <Input
                            size="sm"
                            className="text-[10px] h-7"
                            value={hfRepoLora}
                            onChange={(e) => setHfRepoLora(e.target.value)}
                            placeholder="Repo ID (LoRA)"
                          />
                          <Input
                            size="sm"
                            className="text-[10px] h-7"
                            value={hfRepoMerged}
                            onChange={(e) => setHfRepoMerged(e.target.value)}
                            placeholder="Repo ID (Merged)"
                            disabled={!stageMerge}
                          />
                        </div>
                      )}
                    </div>

                    <div className={cn("p-3 rounded-xl border transition-colors", stageUpload ? "bg-slate-800/40 border-slate-700" : "bg-slate-950/20 border-slate-900")}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">Artifact Upload</span>
                        <input type="checkbox" checked={stageUpload} onChange={e => setStageUpload(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600 border-slate-700" />
                      </div>
                      <p className="text-[10px] text-slate-500">Upload logs and metrics via URL.</p>
                    </div>
                  </div>
                )}

                {pipelineEnabled && showAdvancedEval && stageEval && (
                  <div className="rounded-xl border border-blue-900/30 bg-blue-950/20 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">Evaluation Pipeline Settings</h4>
                      <button onClick={() => setShowAdvancedEval(false)} className="text-[10px] text-slate-500 hover:text-white uppercase font-bold">Back to pipeline</button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[10px] uppercase font-bold text-slate-500">Eval Dataset</label>
                        <Select value={evalDatasetId} onChange={e => setEvalDatasetId(e.target.value)}>
                          {evalDatasetsQuery.data?.map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.samplesCount} samples)</option>
                          ))}
                          {!evalDatasetsQuery.data?.length && <option value="">No eval datasets found</option>}
                        </Select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] uppercase font-bold text-slate-500">Evaluation Target</label>
                        <Select value={evalTarget} onChange={e => setEvalTarget(e.target.value as any)}>
                          <option value="auto">Auto (prefer merged)</option>
                          <option value="lora">LoRA adapter</option>
                          <option value="merged">Merged model</option>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="mb-1.5 block text-[10px] uppercase font-bold text-slate-500">System Prompt</label>
                        <textarea
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] text-white focus:border-blue-500 focus:outline-none min-h-[60px]"
                          placeholder="Instructions for the evaluator model..."
                          value={evalSystemPrompt}
                          onChange={e => setEvalSystemPrompt(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] uppercase font-bold text-slate-500">Prompt Template</label>
                        <textarea
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] font-mono text-white focus:border-blue-500 focus:outline-none min-h-[100px]"
                          value={evalPromptTemplate}
                          onChange={e => setEvalPromptTemplate(e.target.value)}
                        />
                        <div className="mt-1 flex flex-wrap gap-2">
                           {['${question}', '${candidateAnswer}', '${referenceScore}', '${maxScore}', '${tagsText}'].map(v => (
                             <code key={v} className="text-[9px] bg-slate-800 text-blue-300 px-1 rounded cursor-pointer" onClick={() => setEvalPromptTemplate(t => t + v)}>{v}</code>
                           ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-[10px] text-slate-500 font-bold uppercase">Max Samples</label>
                        <Input value={evalMaxSamples} onChange={e => setEvalMaxSamples(e.target.value)} placeholder="All" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-slate-500 font-bold uppercase">Max Tokens</label>
                        <Input value={evalMaxTokens} onChange={e => setEvalMaxTokens(e.target.value)} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-slate-500 font-bold uppercase">Temperature</label>
                        <Input value={evalTemp} onChange={e => setEvalTemp(e.target.value)} />
                      </div>
                      <div className="flex items-end h-9">
                        <label className="flex items-center gap-2 cursor-pointer pb-2">
                          <input type="checkbox" checked={evalDoSample} onChange={e => setEvalDoSample(e.target.checked)} className="h-3 w-3 rounded bg-slate-900 text-blue-600" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Do Sample</span>
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3 pt-2 border-t border-blue-900/20">
                      <div className="md:col-span-2">
                        <label className="mb-1.5 block text-[10px] uppercase font-bold text-slate-500">Parsing Regex (Capture Group 1)</label>
                        <Input className="font-mono text-[11px]" value={evalParsingRegex} onChange={e => setEvalParsingRegex(e.target.value)} placeholder="e.g. score:\s*(\d+)" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500 font-bold uppercase">Min Score</label>
                          <Input value={evalScoreMin} onChange={e => setEvalScoreMin(e.target.value)} />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500 font-bold uppercase">Max Score</label>
                          <Input value={evalScoreMax} onChange={e => setEvalScoreMax(e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {stageEval && !stageTraining && (
                   <div className="text-[10px] text-amber-400 bg-amber-400/10 p-2 rounded-lg">
                     Warning: Evaluation stage might fail if training stage is disabled and no existing weights are found.
                   </div>
                )}
                {stagePublish && !stageMerge && hfRepoMerged && (
                   <div className="text-[10px] text-amber-400 bg-amber-400/10 p-2 rounded-lg">
                     Warning: Merged model publishing is enabled but Merge stage is disabled.
                   </div>
                )}
              </div>
            </div>

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
              disabled={!datasetId || !runtimePresetId || startMutation.isPending}
              className="w-full"
            >
              {startMutation.isPending ? 'Starting…' : 'Start Agent Pipeline'}
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
              <div className="text-sm text-slate-400">Selected Preset</div>
              <div className="mt-1 text-white">
                {selectedPreset?.title || '—'}
              </div>
              <div className="text-[10px] text-slate-500 font-mono uppercase mt-0.5">
                {selectedPreset?.logicalBaseModelId || 'NONE'}
              </div>
            </div>

            {selectedPreset && (
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
              После завершения обучения LoRA появится в списке LoRAs. Если включен этап HF Publish, веса будут опубликованы в Hugging Face.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

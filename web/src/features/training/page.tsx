import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  FlaskConical,
  FolderCog,
  Layers3,
  PackageCheck,
  ShieldCheck,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/utils';

type StageId =
  | 'prepare_assets'
  | 'training'
  | 'merge'
  | 'evaluation'
  | 'publish'
  | 'upload';

const STAGE_ORDER: Array<{
  id: StageId;
  title: string;
  dependency?: string;
  icon: LucideIcon;
}> = [
  { id: 'prepare_assets', title: 'Prepare / Assets', icon: FolderCog },
  { id: 'training', title: 'Training', dependency: 'Depends on: Prepare / Assets', icon: Cpu },
  { id: 'merge', title: 'Merge', dependency: 'Depends on: Training', icon: Layers3 },
  {
    id: 'evaluation',
    title: 'Evaluation',
    dependency: 'Depends on: Training or Merge target',
    icon: FlaskConical,
  },
  {
    id: 'publish',
    title: 'Publish',
    dependency: 'Depends on: Training / Merge outputs',
    icon: PackageCheck,
  },
  {
    id: 'upload',
    title: 'Upload / Reporting',
    dependency: 'Depends on: previous enabled stages',
    icon: UploadCloud,
  },
];

function numberOrUndefined(value: string) {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function FieldLabel({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
      <span>{children}</span>
      {note ? <span className="ml-1 normal-case font-normal tracking-normal text-slate-600">{note}</span> : null}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-emerald-600' : 'bg-slate-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-white transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function StagePanel({
  title,
  summary,
  dependency,
  icon: Icon,
  enabled,
  onToggle,
  expanded,
  onExpand,
  children,
}: {
  title: string;
  summary: string;
  dependency?: string;
  icon: LucideIcon;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  expanded: boolean;
  onExpand: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        enabled ? 'border-slate-800 bg-slate-900/60' : 'border-slate-900 bg-slate-950/30 opacity-80',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onExpand}
          className="mt-0.5 rounded-md border border-slate-800 bg-slate-950/70 p-1 text-slate-400 hover:text-white"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="mt-0.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-slate-300">
          <Icon size={14} />
        </div>

        <button type="button" onClick={onExpand} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-white">{title}</div>
            <span className="rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              fixed order
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-400">{summary}</div>
          {dependency ? <div className="mt-1 text-[10px] text-slate-500">{dependency}</div> : null}
        </button>

        <div className="flex items-center gap-2 self-center">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      </div>

      {expanded ? <div className="border-t border-slate-800 px-4 py-4">{children}</div> : null}
    </div>
  );
}

export default function TrainingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.getDatasets });
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: api.getModels });
  const lorasQuery = useQuery({ queryKey: ['loras'], queryFn: api.getLoras });
  const workersQuery = useQuery({ queryKey: ['workers'], queryFn: api.getWorkers });
  const presetsQuery = useQuery({ queryKey: ['runtime-presets'], queryFn: api.getRuntimePresets });
  const evalDatasetsQuery = useQuery({ queryKey: ['eval-datasets'], queryFn: api.getEvalDatasets });
  const evalConfigQuery = useQuery({ queryKey: ['eval-config'], queryFn: api.getEvalConfig });

  const [expandedStage, setExpandedStage] = useState<StageId>('training');

  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState(searchParams.get('datasetId') || '');
  const [workerId, setWorkerId] = useState('any');
  const [runtimePresetId, setRuntimePresetId] = useState('');
  const [modelId, setModelId] = useState('');

  const [stagePrepare, setStagePrepare] = useState(true);
  const [stageTraining, setStageTraining] = useState(true);
  const [stageMerge, setStageMerge] = useState(true);
  const [stageEvaluation, setStageEvaluation] = useState(false);
  const [stagePublish, setStagePublish] = useState(true);
  const [stageUpload, setStageUpload] = useState(true);

  const [method, setMethod] = useState<'qlora' | 'lora' | 'full'>('qlora');
  const [loadIn4bit, setLoadIn4bit] = useState(true);
  const [maxSeqLength, setMaxSeqLength] = useState('4096');
  const [perDeviceTrainBatchSize, setPerDeviceTrainBatchSize] = useState('1');
  const [gradientAccumulationSteps, setGradientAccumulationSteps] = useState('8');
  const [numTrainEpochs, setNumTrainEpochs] = useState('3');
  const [learningRate, setLearningRate] = useState('0.0002');
  const [warmupRatio, setWarmupRatio] = useState('0.03');
  const [loggingSteps, setLoggingSteps] = useState('10');
  const [saveSteps, setSaveSteps] = useState('100');
  const [evalSteps, setEvalSteps] = useState('100');
  const [bf16, setBf16] = useState(true);
  const [packing, setPacking] = useState(false);
  const [saveTotalLimit, setSaveTotalLimit] = useState('2');
  const [optim, setOptim] = useState('paged_adamw_8bit');
  const [loraR, setLoraR] = useState('16');
  const [loraAlpha, setLoraAlpha] = useState('16');
  const [loraDropout, setLoraDropout] = useState('0');
  const [targetModules, setTargetModules] = useState('q_proj, v_proj, k_proj, o_proj, gate_proj, up_proj, down_proj');
  const [gradientCheckpointing, setGradientCheckpointing] = useState(true);
  const [randomState, setRandomState] = useState('3407');

  const [evalTarget, setEvalTarget] = useState<'auto' | 'lora' | 'merged'>('auto');
  const [evalDatasetMode, setEvalDatasetMode] = useState<'catalog' | 'custom'>('catalog');
  const [evalDatasetId, setEvalDatasetId] = useState('');
  const [evalDatasetSource, setEvalDatasetSource] = useState('local');
  const [evalDatasetConfig, setEvalDatasetConfig] = useState('');
  const [evalDatasetPath, setEvalDatasetPath] = useState('');
  const [evalDatasetFormat, setEvalDatasetFormat] = useState('jsonl');
  const [questionField, setQuestionField] = useState('question');
  const [answerField, setAnswerField] = useState('candidateAnswer');
  const [scoreField, setScoreField] = useState('referenceScore');
  const [maxScoreField, setMaxScoreField] = useState('maxScore');
  const [tagsField, setTagsField] = useState('hashTags');
  const [maxSamples, setMaxSamples] = useState('100');
  const [maxNewTokens, setMaxNewTokens] = useState('128');
  const [temperature, setTemperature] = useState('0');
  const [doSample, setDoSample] = useState(false);
  const [evalPromptTemplate, setEvalPromptTemplate] = useState('');
  const [evalSystemPrompt, setEvalSystemPrompt] = useState('');
  const [parsingRegex, setParsingRegex] = useState('');
  const [scoreMin, setScoreMin] = useState('0');
  const [scoreMax, setScoreMax] = useState('10');

  const [hfRepoLora, setHfRepoLora] = useState('');
  const [hfRepoMerged, setHfRepoMerged] = useState('');

  useEffect(() => {
    const defaults = settingsQuery.data?.qlora;
    if (!defaults) return;

    setLoadIn4bit(!!defaults.loadIn4bit);
    setMaxSeqLength(String(defaults.maxSeqLength ?? 4096));
    setPerDeviceTrainBatchSize(String(defaults.perDeviceTrainBatchSize ?? 1));
    setGradientAccumulationSteps(String(defaults.gradientAccumulationSteps ?? 8));
    setNumTrainEpochs(String(defaults.numTrainEpochs ?? 3));
    setLearningRate(String(defaults.learningRate ?? 0.0002));
    setWarmupRatio(String((defaults as any).warmupRatio ?? 0.03));
    setLoggingSteps(String((defaults as any).loggingSteps ?? 10));
    setSaveSteps(String((defaults as any).saveSteps ?? 100));
    setEvalSteps(String((defaults as any).evalSteps ?? 100));
    setBf16(Boolean((defaults as any).bf16 ?? true));
    setPacking(Boolean((defaults as any).packing ?? false));
    setSaveTotalLimit(String((defaults as any).saveTotalLimit ?? 2));
    setOptim(String((defaults as any).optim ?? 'paged_adamw_8bit'));
    setLoraR(String(defaults.loraR ?? 16));
    setLoraAlpha(String(defaults.loraAlpha ?? 16));
    setLoraDropout(String(defaults.loraDropout ?? 0));
    setTargetModules(((defaults.targetModules || []) as string[]).join(', ') || 'q_proj, v_proj, k_proj, o_proj');
    setGradientCheckpointing(Boolean((defaults as any).gradientCheckpointing ?? true));
    setRandomState(String((defaults as any).randomState ?? 3407));
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!runtimePresetId && presetsQuery.data?.[0]?.id) {
      setRuntimePresetId(presetsQuery.data[0].id);
    }
  }, [presetsQuery.data, runtimePresetId]);

  useEffect(() => {
    if (!datasetId && datasetsQuery.data?.[0]?.id) {
      setDatasetId(datasetsQuery.data[0].id);
    }
  }, [datasetsQuery.data, datasetId]);

  useEffect(() => {
    if (!evalDatasetId && evalDatasetsQuery.data?.[0]?.id) {
      setEvalDatasetId(evalDatasetsQuery.data[0].id);
    }
  }, [evalDatasetsQuery.data, evalDatasetId]);

  useEffect(() => {
    if (!evalPromptTemplate && evalConfigQuery.data?.defaultPromptTemplate) {
      setEvalPromptTemplate(evalConfigQuery.data.defaultPromptTemplate);
    }
  }, [evalConfigQuery.data, evalPromptTemplate]);

  const selectedPreset = useMemo(
    () => presetsQuery.data?.find((preset) => preset.id === runtimePresetId) || null,
    [presetsQuery.data, runtimePresetId],
  );

  const readyModels = useMemo(
    () => (modelsQuery.data || []).filter((model) => model.status === 'ready'),
    [modelsQuery.data],
  );

  useEffect(() => {
    if (!modelId && readyModels[0]?.id) {
      setModelId(readyModels[0].id);
    }
  }, [readyModels, modelId]);

  useEffect(() => {
    if (!selectedPreset?.logicalBaseModelId) return;
    const matchingModel =
      readyModels.find((model) => model.repoId === selectedPreset.logicalBaseModelId) ||
      readyModels.find((model) => model.name === selectedPreset.logicalBaseModelId);

    if (matchingModel && matchingModel.id !== modelId) {
      setModelId(matchingModel.id);
    }
  }, [selectedPreset, readyModels, modelId]);

  const selectedModel = useMemo(
    () => readyModels.find((model) => model.id === modelId) || null,
    [readyModels, modelId],
  );

  const selectedDataset = useMemo(
    () => datasetsQuery.data?.find((dataset) => dataset.id === datasetId) || null,
    [datasetsQuery.data, datasetId],
  );

  const selectedEvalDataset = useMemo(
    () => evalDatasetsQuery.data?.find((dataset) => dataset.id === evalDatasetId) || null,
    [evalDatasetsQuery.data, evalDatasetId],
  );

  const relatedLoras = useMemo(() => {
    const baseRef = selectedPreset?.logicalBaseModelId || selectedModel?.repoId;
    return (lorasQuery.data || []).filter((lora) => {
      return (
        lora.baseModelId === selectedModel?.id ||
        lora.baseModelRef === baseRef ||
        lora.trainingBaseModelPath === selectedPreset?.localModelPath
      );
    });
  }, [lorasQuery.data, selectedModel, selectedPreset]);

  const trainingSummary = `${method.toUpperCase()} · ${numTrainEpochs} ep · lr ${learningRate} · bs ${perDeviceTrainBatchSize} × ga ${gradientAccumulationSteps}`;
  const evaluationSummary = stageEvaluation
    ? `${selectedEvalDataset?.name || evalDatasetPath || 'dataset pending'} · target ${evalTarget} · prompt ${evalPromptTemplate ? 'configured' : 'missing'}`
    : 'Evaluation disabled';

  const pipelinePayload = useMemo(() => {
    return {
      prepare_assets: {
        enabled: stagePrepare,
        dataset_id: datasetId || undefined,
        dataset_name: selectedDataset?.name || undefined,
        worker_id: workerId === 'any' ? undefined : workerId,
      },
      training: {
        enabled: stageTraining,
        runtime_preset_id: runtimePresetId || undefined,
        logical_base_model: selectedPreset?.logicalBaseModelId || selectedModel?.repoId || undefined,
        trainer_image: selectedPreset?.trainerImage || undefined,
        model_local_path: selectedPreset?.localModelPath || selectedModel?.path || undefined,
        method,
        load_in_4bit: method === 'qlora' ? true : loadIn4bit,
        max_seq_length: numberOrUndefined(maxSeqLength),
        per_device_train_batch_size: numberOrUndefined(perDeviceTrainBatchSize),
        gradient_accumulation_steps: numberOrUndefined(gradientAccumulationSteps),
        num_train_epochs: numberOrUndefined(numTrainEpochs),
        learning_rate: numberOrUndefined(learningRate),
        warmup_ratio: numberOrUndefined(warmupRatio),
        logging_steps: numberOrUndefined(loggingSteps),
        save_steps: numberOrUndefined(saveSteps),
        eval_steps: numberOrUndefined(evalSteps),
        bf16,
        packing,
        save_total_limit: numberOrUndefined(saveTotalLimit),
        optim,
        lora_r: numberOrUndefined(loraR),
        lora_alpha: numberOrUndefined(loraAlpha),
        lora_dropout: numberOrUndefined(loraDropout),
        target_modules: parseCsv(targetModules),
        gradient_checkpointing: gradientCheckpointing,
        random_state: numberOrUndefined(randomState),
      },
      merge: {
        enabled: stageMerge,
        source: method === 'full' ? 'full_finetune' : 'adapter',
      },
      evaluation: {
        enabled: stageEvaluation,
        target: evalTarget,
        dataset: {
          source: evalDatasetMode === 'catalog' ? 'local' : evalDatasetSource,
          config: evalDatasetMode === 'catalog' ? selectedEvalDataset?.id : evalDatasetConfig || undefined,
          path: evalDatasetMode === 'catalog' ? selectedEvalDataset?.jsonPath : evalDatasetPath || undefined,
          format: evalDatasetFormat,
        },
        fields: {
          question: questionField,
          answer: answerField,
          score: scoreField,
          max_score: maxScoreField,
          tags: tagsField,
        },
        max_samples: numberOrUndefined(maxSamples),
        max_new_tokens: numberOrUndefined(maxNewTokens),
        temperature: numberOrUndefined(temperature) ?? 0,
        do_sample: doSample,
        system_prompt: evalSystemPrompt || undefined,
        prompt: evalPromptTemplate || undefined,
        prompt_template: evalPromptTemplate || undefined,
        parsing_regex: parsingRegex || undefined,
        score_min: numberOrUndefined(scoreMin),
        score_max: numberOrUndefined(scoreMax),
      },
      publish: {
        enabled: stagePublish,
        push_lora: true,
        push_merged: stageMerge,
        repo_id_lora: hfRepoLora || undefined,
        repo_id_merged: hfRepoMerged || undefined,
      },
      upload: {
        enabled: stageUpload,
      },
    };
  }, [
    answerField,
    bf16,
    datasetId,
    doSample,
    evalDatasetConfig,
    evalDatasetFormat,
    evalDatasetId,
    evalDatasetMode,
    evalDatasetPath,
    evalDatasetSource,
    evalPromptTemplate,
    evalSteps,
    evalSystemPrompt,
    evalTarget,
    gradientAccumulationSteps,
    gradientCheckpointing,
    hfRepoLora,
    hfRepoMerged,
    learningRate,
    loadIn4bit,
    loggingSteps,
    loraAlpha,
    loraDropout,
    loraR,
    maxNewTokens,
    maxSamples,
    maxScoreField,
    maxSeqLength,
    method,
    numTrainEpochs,
    optim,
    packing,
    parsingRegex,
    perDeviceTrainBatchSize,
    questionField,
    randomState,
    runtimePresetId,
    saveSteps,
    saveTotalLimit,
    scoreField,
    scoreMax,
    scoreMin,
    selectedDataset,
    selectedEvalDataset,
    selectedModel,
    selectedPreset,
    stageEvaluation,
    stageMerge,
    stagePrepare,
    stagePublish,
    stageTraining,
    stageUpload,
    tagsField,
    targetModules,
    temperature,
    warmupRatio,
    workerId,
  ]);

  const startMutation = useMutation({
    mutationFn: (payload: any) => api.startRemoteTrain(payload),
    onSuccess: (job) => {
      navigate(`/app/jobs?selected=${encodeURIComponent(job.id)}`);
    },
  });

  const handleStart = () => {
    startMutation.mutate({
      datasetId,
      name: name.trim() || undefined,
      modelId: modelId || undefined,
      baseModel: selectedPreset?.logicalBaseModelId || selectedModel?.repoId || selectedModel?.path || undefined,
      workerId: workerId === 'any' ? undefined : workerId,
      runtimePresetId: runtimePresetId || undefined,
      qlora: {
        useLora: method !== 'full',
        method,
        loadIn4bit: method === 'qlora' ? true : loadIn4bit,
        maxSeqLength: numberOrUndefined(maxSeqLength),
        perDeviceTrainBatchSize: numberOrUndefined(perDeviceTrainBatchSize),
        gradientAccumulationSteps: numberOrUndefined(gradientAccumulationSteps),
        numTrainEpochs: numberOrUndefined(numTrainEpochs),
        learningRate: numberOrUndefined(learningRate),
        warmupRatio: numberOrUndefined(warmupRatio),
        loggingSteps: numberOrUndefined(loggingSteps),
        saveSteps: numberOrUndefined(saveSteps),
        evalSteps: numberOrUndefined(evalSteps),
        bf16,
        packing,
        saveTotalLimit: numberOrUndefined(saveTotalLimit),
        optim,
        loraR: numberOrUndefined(loraR),
        loraAlpha: numberOrUndefined(loraAlpha),
        loraDropout: numberOrUndefined(loraDropout),
        targetModules: parseCsv(targetModules),
        gradientCheckpointing,
        randomState: numberOrUndefined(randomState),
      },
      hfPublish: {
        enabled: stagePublish,
        push_lora: true,
        push_merged: stageMerge,
        repo_id_lora: hfRepoLora || undefined,
        repo_id_merged: hfRepoMerged || undefined,
      },
      pipeline: pipelinePayload,
    });
  };

  const canStart = Boolean(datasetId && runtimePresetId);

  const presetCapabilities = selectedPreset
    ? [
        selectedPreset.supports?.qlora ? 'QLoRA' : null,
        selectedPreset.supports?.lora ? 'LoRA' : null,
        selectedPreset.supports?.merge ? 'Merge' : null,
        selectedPreset.supports?.evaluation ? 'Evaluation' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No preset selected';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Training"
        description="Dense pipeline-based training for remote jobs. Fixed safe order, stage toggles, compact summaries, and backward-compatible payloads."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Train Pipeline</CardTitle>
              <div className="mt-1 text-xs text-slate-500">
                Train is no longer a loose legacy settings form. Configure a fixed vertical pipeline and start a new remote job.
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
              safe fixed order
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <FieldLabel>Job name</FieldLabel>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="train-qwen-stage-run-01" />
              </div>
              <div>
                <FieldLabel>Dataset</FieldLabel>
                <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                  <option value="">Select dataset</option>
                  {datasetsQuery.data?.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} ({dataset.rows})
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <FieldLabel>Runtime preset</FieldLabel>
                <Select value={runtimePresetId} onChange={(e) => setRuntimePresetId(e.target.value)}>
                  <option value="">Select preset</option>
                  {presetsQuery.data?.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.title} · {preset.family}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel>Target worker</FieldLabel>
                <Select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                  <option value="any">Any available</option>
                  {workersQuery.data?.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name} ({worker.status})
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              {STAGE_ORDER.map((stage) => {
                const enabled =
                  stage.id === 'prepare_assets'
                    ? stagePrepare
                    : stage.id === 'training'
                    ? stageTraining
                    : stage.id === 'merge'
                    ? stageMerge
                    : stage.id === 'evaluation'
                    ? stageEvaluation
                    : stage.id === 'publish'
                    ? stagePublish
                    : stageUpload;

                const summary =
                  stage.id === 'prepare_assets'
                    ? `${selectedDataset?.name || 'dataset pending'} · ${workerId === 'any' ? 'auto worker' : workerId}`
                    : stage.id === 'training'
                    ? trainingSummary
                    : stage.id === 'merge'
                    ? stageMerge
                      ? 'Merged export enabled'
                      : 'Merged export disabled'
                    : stage.id === 'evaluation'
                    ? evaluationSummary
                    : stage.id === 'publish'
                    ? stagePublish
                      ? `${hfRepoLora || 'LoRA repo pending'}${stageMerge ? ` · ${hfRepoMerged || 'merged repo pending'}` : ''}`
                      : 'HF publish disabled'
                    : stageUpload
                    ? 'Upload logs, reports and bundle references'
                    : 'Upload / reporting disabled';

                const handleToggle =
                  stage.id === 'prepare_assets'
                    ? setStagePrepare
                    : stage.id === 'training'
                    ? setStageTraining
                    : stage.id === 'merge'
                    ? setStageMerge
                    : stage.id === 'evaluation'
                    ? setStageEvaluation
                    : stage.id === 'publish'
                    ? setStagePublish
                    : setStageUpload;

                return (
                  <StagePanel
                    key={stage.id}
                    title={stage.title}
                    summary={summary}
                    dependency={stage.dependency}
                    icon={stage.icon}
                    enabled={enabled}
                    onToggle={handleToggle}
                    expanded={expandedStage === stage.id}
                    onExpand={() => setExpandedStage(stage.id)}
                  >
                    {stage.id === 'prepare_assets' ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <FieldLabel>Dataset snapshot</FieldLabel>
                          <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                            {selectedDataset ? `${selectedDataset.name} · ${selectedDataset.rows} rows` : 'Select dataset'}
                          </div>
                        </div>
                        <div>
                          <FieldLabel>Worker allocation</FieldLabel>
                          <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                            {workerId === 'any' ? 'Any available worker' : workerId}
                          </div>
                        </div>
                        <div>
                          <FieldLabel>Runtime hand-off</FieldLabel>
                          <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                            {selectedPreset?.title || 'Select runtime preset'}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {stage.id === 'training' ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>Logical base model</FieldLabel>
                            <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                              <option value="">Select model</option>
                              {readyModels.map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <FieldLabel>Method</FieldLabel>
                            <Select
                              value={method}
                              onChange={(e) => {
                                const next = e.target.value as 'qlora' | 'lora' | 'full';
                                setMethod(next);
                                if (next === 'qlora') setLoadIn4bit(true);
                                if (next === 'full') setLoadIn4bit(false);
                              }}
                            >
                              <option value="qlora">QLoRA</option>
                              <option value="lora">LoRA</option>
                              <option value="full">Full fine-tune</option>
                            </Select>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <FieldLabel>Trainer image</FieldLabel>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs font-mono text-slate-300">
                              {selectedPreset?.trainerImage || 'Resolved from runtime preset'}
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Model local path</FieldLabel>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs font-mono text-slate-300">
                              {selectedPreset?.localModelPath || selectedModel?.path || 'Resolved by backend / preset'}
                            </div>
                          </div>
                          <div>
                            <FieldLabel>4-bit loading</FieldLabel>
                            <div className="flex h-10 items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3">
                              <Toggle
                                checked={method === 'qlora' ? true : loadIn4bit}
                                onChange={setLoadIn4bit}
                                disabled={method === 'qlora'}
                              />
                              <span className="text-xs text-slate-300">
                                {method === 'qlora' ? 'Forced by method=QLoRA' : loadIn4bit ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <div>
                            <FieldLabel>max_seq_length</FieldLabel>
                            <Input value={maxSeqLength} onChange={(e) => setMaxSeqLength(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>per_device_train_batch_size</FieldLabel>
                            <Input value={perDeviceTrainBatchSize} onChange={(e) => setPerDeviceTrainBatchSize(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>gradient_accumulation_steps</FieldLabel>
                            <Input value={gradientAccumulationSteps} onChange={(e) => setGradientAccumulationSteps(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>num_train_epochs</FieldLabel>
                            <Input value={numTrainEpochs} onChange={(e) => setNumTrainEpochs(e.target.value)} />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <div>
                            <FieldLabel>learning_rate</FieldLabel>
                            <Input value={learningRate} onChange={(e) => setLearningRate(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>warmup_ratio</FieldLabel>
                            <Input value={warmupRatio} onChange={(e) => setWarmupRatio(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>logging_steps</FieldLabel>
                            <Input value={loggingSteps} onChange={(e) => setLoggingSteps(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>save_steps</FieldLabel>
                            <Input value={saveSteps} onChange={(e) => setSaveSteps(e.target.value)} />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <div>
                            <FieldLabel>eval_steps</FieldLabel>
                            <Input value={evalSteps} onChange={(e) => setEvalSteps(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>save_total_limit</FieldLabel>
                            <Input value={saveTotalLimit} onChange={(e) => setSaveTotalLimit(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>optim</FieldLabel>
                            <Input value={optim} onChange={(e) => setOptim(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>random_state</FieldLabel>
                            <Input value={randomState} onChange={(e) => setRandomState(e.target.value)} />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <FieldLabel>lora r</FieldLabel>
                            <Input value={loraR} onChange={(e) => setLoraR(e.target.value)} disabled={method === 'full'} />
                          </div>
                          <div>
                            <FieldLabel>lora alpha</FieldLabel>
                            <Input value={loraAlpha} onChange={(e) => setLoraAlpha(e.target.value)} disabled={method === 'full'} />
                          </div>
                          <div>
                            <FieldLabel>lora dropout</FieldLabel>
                            <Input value={loraDropout} onChange={(e) => setLoraDropout(e.target.value)} disabled={method === 'full'} />
                          </div>
                        </div>

                        <div>
                          <FieldLabel>target_modules</FieldLabel>
                          <Input value={targetModules} onChange={(e) => setTargetModules(e.target.value)} disabled={method === 'full'} />
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                            <Toggle checked={bf16} onChange={setBf16} />
                            <span className="text-xs text-slate-300">bf16</span>
                          </label>
                          <label className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                            <Toggle checked={packing} onChange={setPacking} />
                            <span className="text-xs text-slate-300">packing</span>
                          </label>
                          <label className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                            <Toggle checked={gradientCheckpointing} onChange={setGradientCheckpointing} />
                            <span className="text-xs text-slate-300">gradient checkpointing</span>
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {stage.id === 'merge' ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Source</div>
                          <div className="mt-1 text-sm text-white">
                            {method === 'full' ? 'Full fine-tune output' : 'Adapter / LoRA output'}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Dependency</div>
                          <div className="mt-1 text-sm text-white">Uses previous training outputs only</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Safe default</div>
                          <div className="mt-1 text-sm text-white">Enabled for publishable merged model</div>
                        </div>
                      </div>
                    ) : null}

                    {stage.id === 'evaluation' ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>target</FieldLabel>
                            <Select value={evalTarget} onChange={(e) => setEvalTarget(e.target.value as 'auto' | 'lora' | 'merged')}>
                              <option value="auto">auto</option>
                              <option value="lora">lora</option>
                              <option value="merged">merged</option>
                            </Select>
                          </div>
                          <div>
                            <FieldLabel>dataset source/config</FieldLabel>
                            <Select value={evalDatasetMode} onChange={(e) => setEvalDatasetMode(e.target.value as 'catalog' | 'custom')}>
                              <option value="catalog">catalog dataset</option>
                              <option value="custom">custom source/config</option>
                            </Select>
                          </div>
                        </div>

                        {evalDatasetMode === 'catalog' ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <FieldLabel>dataset</FieldLabel>
                              <Select value={evalDatasetId} onChange={(e) => setEvalDatasetId(e.target.value)}>
                                <option value="">Select eval dataset</option>
                                {evalDatasetsQuery.data?.map((dataset) => (
                                  <option key={dataset.id} value={dataset.id}>
                                    {dataset.name} ({dataset.samplesCount} samples)
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <div>
                              <FieldLabel>format</FieldLabel>
                              <Input value={evalDatasetFormat} onChange={(e) => setEvalDatasetFormat(e.target.value)} />
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-3">
                            <div>
                              <FieldLabel>dataset source</FieldLabel>
                              <Input value={evalDatasetSource} onChange={(e) => setEvalDatasetSource(e.target.value)} placeholder="hf / s3 / local" />
                            </div>
                            <div>
                              <FieldLabel>dataset config</FieldLabel>
                              <Input value={evalDatasetConfig} onChange={(e) => setEvalDatasetConfig(e.target.value)} placeholder="split or config id" />
                            </div>
                            <div>
                              <FieldLabel>format</FieldLabel>
                              <Input value={evalDatasetFormat} onChange={(e) => setEvalDatasetFormat(e.target.value)} placeholder="jsonl" />
                            </div>
                            <div className="md:col-span-3">
                              <FieldLabel>dataset path</FieldLabel>
                              <Input value={evalDatasetPath} onChange={(e) => setEvalDatasetPath(e.target.value)} placeholder="/datasets/eval.jsonl or hf://repo/path" />
                            </div>
                          </div>
                        )}

                        <div className="grid gap-3 md:grid-cols-5">
                          <div>
                            <FieldLabel>question field</FieldLabel>
                            <Input value={questionField} onChange={(e) => setQuestionField(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>answer field</FieldLabel>
                            <Input value={answerField} onChange={(e) => setAnswerField(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>score field</FieldLabel>
                            <Input value={scoreField} onChange={(e) => setScoreField(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>max score field</FieldLabel>
                            <Input value={maxScoreField} onChange={(e) => setMaxScoreField(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>tags field</FieldLabel>
                            <Input value={tagsField} onChange={(e) => setTagsField(e.target.value)} />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <div>
                            <FieldLabel>max_samples</FieldLabel>
                            <Input value={maxSamples} onChange={(e) => setMaxSamples(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>max_new_tokens</FieldLabel>
                            <Input value={maxNewTokens} onChange={(e) => setMaxNewTokens(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>temperature</FieldLabel>
                            <Input value={temperature} onChange={(e) => setTemperature(e.target.value)} />
                          </div>
                          <label className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                            <Toggle checked={doSample} onChange={setDoSample} />
                            <span className="text-xs text-slate-300">do_sample</span>
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>score min</FieldLabel>
                            <Input value={scoreMin} onChange={(e) => setScoreMin(e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel>score max</FieldLabel>
                            <Input value={scoreMax} onChange={(e) => setScoreMax(e.target.value)} />
                          </div>
                        </div>

                        <div>
                          <FieldLabel>prompt_template for eval_runner</FieldLabel>
                          <Textarea
                            value={evalPromptTemplate}
                            onChange={(e) => setEvalPromptTemplate(e.target.value)}
                            className="min-h-[180px] font-mono text-xs"
                            placeholder="Keep this stable: it is serialized into the pipeline payload and should survive retry / reopen."
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            {['${question}', '${candidateAnswer}', '${referenceScore}', '${maxScore}', '${tagsText}'].map((variable) => (
                              <button
                                key={variable}
                                type="button"
                                onClick={() => setEvalPromptTemplate((value) => `${value}${value ? '\n' : ''}${variable}`)}
                                className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] font-mono text-blue-300 hover:bg-slate-900"
                              >
                                {variable}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <FieldLabel>system prompt</FieldLabel>
                          <Textarea value={evalSystemPrompt} onChange={(e) => setEvalSystemPrompt(e.target.value)} className="min-h-[80px] text-xs" />
                        </div>

                        <div>
                          <FieldLabel>parsing regex</FieldLabel>
                          <Input value={parsingRegex} onChange={(e) => setParsingRegex(e.target.value)} placeholder="Optional capture pattern for score extraction" />
                        </div>
                      </div>
                    ) : null}

                    {stage.id === 'publish' ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <FieldLabel>LoRA repo</FieldLabel>
                          <Input value={hfRepoLora} onChange={(e) => setHfRepoLora(e.target.value)} placeholder="org/model-lora" />
                        </div>
                        <div>
                          <FieldLabel>merged repo</FieldLabel>
                          <Input
                            value={hfRepoMerged}
                            onChange={(e) => setHfRepoMerged(e.target.value)}
                            placeholder="org/model-merged"
                            disabled={!stageMerge}
                          />
                        </div>
                      </div>
                    ) : null}

                    {stage.id === 'upload' ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Logs</div>
                          <div className="mt-1 text-sm text-white">Upload / expose log history</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Reports</div>
                          <div className="mt-1 text-sm text-white">Metrics and evaluation summaries</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Launch data</div>
                          <div className="mt-1 text-sm text-white">Bundle remains available in job details</div>
                        </div>
                      </div>
                    ) : null}
                  </StagePanel>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <div className="text-xs text-slate-500">
                New remote job will inherit pipeline, runtime preset, publish settings, and evaluation prompt template.
              </div>
              <Button onClick={handleStart} disabled={!canStart || startMutation.isPending}>
                {startMutation.isPending ? 'Starting…' : 'Start remote pipeline'}
              </Button>
            </div>

            {startMutation.error ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
                {(startMutation.error as Error).message}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardHeader>
              <CardTitle>Runtime Preset Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg bg-slate-950/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">title</div>
                <div className="mt-1 text-white">{selectedPreset?.title || '—'}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">family</div>
                  <div className="mt-1 text-white">{selectedPreset?.family || '—'}</div>
                </div>
                <div className="rounded-lg bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">logical base model</div>
                  <div className="mt-1 text-white">{selectedPreset?.logicalBaseModelId || selectedModel?.repoId || '—'}</div>
                </div>
                <div className="rounded-lg bg-slate-950/40 p-3 sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">trainer image</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-300">{selectedPreset?.trainerImage || '—'}</div>
                </div>
                <div className="rounded-lg bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">model local path</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-300">{selectedPreset?.localModelPath || selectedModel?.path || '—'}</div>
                </div>
                <div className="rounded-lg bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">shm size</div>
                  <div className="mt-1 text-white">{selectedPreset?.defaultShmSize || '—'}</div>
                </div>
              </div>
              <div className="rounded-lg border border-blue-500/20 bg-slate-950/40 p-3">
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-blue-400">
                  <ShieldCheck size={12} />
                  capabilities
                </div>
                <div className="text-xs text-slate-300">{presetCapabilities}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operator Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-slate-950/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Existing LoRAs for base model</div>
                <div className="mt-2 space-y-2">
                  {!relatedLoras.length ? (
                    <div className="text-xs text-slate-500">No related adapters found yet.</div>
                  ) : (
                    relatedLoras.slice(0, 5).map((lora) => (
                      <div key={lora.id} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-2 text-xs">
                        <div className="text-white">{lora.name}</div>
                        <div className="mt-1 text-slate-500">{lora.jobId}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-slate-950/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Serialized pipeline preview</div>
                <pre className="mt-2 max-h-[380px] overflow-auto text-[10px] text-slate-300">
                  {JSON.stringify(pipelinePayload, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
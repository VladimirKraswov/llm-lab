import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, Layers3, Link2, Package2, Workflow } from 'lucide-react';
import { api, type PipelineConfig, type RuntimePreset } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/utils';
import { CopyButton } from '../../components/copy-button';

type ExpandMap = Record<string, boolean>;

type TrainingStageState = {
  method: 'lora' | 'qlora';
  runtimePresetId: string;
  logicalBaseModelId: string;
  trainerImage: string;
  modelLocalPath: string;
  loadIn4bit: boolean;
  maxSeqLength: string;
  perDeviceTrainBatchSize: string;
  gradientAccumulationSteps: string;
  numTrainEpochs: string;
  learningRate: string;
  warmupRatio: string;
  loggingSteps: string;
  saveSteps: string;
  evalSteps: string;
  bf16: boolean;
  packing: boolean;
  saveTotalLimit: string;
  optim: string;
  loraR: string;
  loraAlpha: string;
  loraDropout: string;
  targetModules: string;
  gradientCheckpointing: boolean;
  randomState: string;
};

type MergeStageState = {
  saveMerged16Bit: boolean;
  mergeLora: boolean;
  outputBehavior: 'default' | 'custom';
  outputPath: string;
  safeSerialization: boolean;
};

type EvalStageState = {
  target: 'auto' | 'lora' | 'merged';
  datasetId: string;
  datasetSource: 'local' | 'remote';
  format: 'jsonl' | 'json';
  questionField: string;
  answerField: string;
  scoreField: string;
  maxScoreField: string;
  tagsField: string;
  maxSamples: string;
  maxNewTokens: string;
  temperature: string;
  doSample: boolean;
  promptTemplate: string;
};

type UploadStageState = {
  pushLora: boolean;
  pushMerged: boolean;
  pushMetadata: boolean;
  repoIdLora: string;
  repoIdMerged: string;
  repoIdMetadata: string;
  visibility: 'private' | 'public';
  commitMessage: string;
  revision: string;
};

type ReportingStageState = {
  statusCallback: boolean;
  progressCallback: boolean;
  finalCallback: boolean;
  logsCallback: boolean;
  authTokenInheritance: boolean;
  timeoutSeconds: string;
};

function numberOrUndefined(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

function boolSummary(enabled: boolean, label: string) {
  return enabled ? label : null;
}

function stageSummary(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(' · ') || 'No custom settings';
}

function normalizePreset(preset: RuntimePreset | undefined | null) {
  if (!preset) return null;
  return {
    id: preset.id,
    title: preset.title,
    description: preset.description || '',
    family: preset.family || '—',
    logicalBaseModelId: preset.logicalBaseModelId,
    trainerImage: preset.trainerImage,
    modelLocalPath: preset.modelLocalPath,
    defaultShmSize: preset.defaultShmSize,
    gpuCount: preset.gpuCount,
    supports: preset.supports,
  };
}

function buildPipelinePayload(args: {
  prepareEnabled: boolean;
  trainingEnabled: boolean;
  saveLoraEnabled: boolean;
  mergeEnabled: boolean;
  evaluationEnabled: boolean;
  uploadEnabled: boolean;
  reportingEnabled: boolean;
  training: TrainingStageState;
  merge: MergeStageState;
  evaluation: EvalStageState;
  upload: UploadStageState;
  reporting: ReportingStageState;
  selectedEvalDataset?: { id: string; jsonPath: string; name: string } | null;
}): PipelineConfig {
  const { prepareEnabled, trainingEnabled, saveLoraEnabled, mergeEnabled, evaluationEnabled, uploadEnabled, reportingEnabled, training, merge, evaluation, upload, reporting, selectedEvalDataset } = args;

  return {
    prepare_assets: {
      enabled: prepareEnabled,
      order: 10,
      title: 'Prepare / Assets',
      description: 'Resolve config, runtime preset, dataset and output locations.',
    },
    training: {
      enabled: trainingEnabled,
      order: 20,
      title: 'Training',
      description: 'Run remote LoRA/QLoRA training inside trainer image.',
      method: training.method,
      runtime_preset_id: training.runtimePresetId,
      logical_base_model_id: training.logicalBaseModelId,
      trainer_image: training.trainerImage,
      model_local_path: training.modelLocalPath,
      load_in_4bit: training.loadIn4bit,
      max_seq_length: numberOrUndefined(training.maxSeqLength),
      per_device_train_batch_size: numberOrUndefined(training.perDeviceTrainBatchSize),
      gradient_accumulation_steps: numberOrUndefined(training.gradientAccumulationSteps),
      num_train_epochs: numberOrUndefined(training.numTrainEpochs),
      learning_rate: numberOrUndefined(training.learningRate),
      warmup_ratio: numberOrUndefined(training.warmupRatio),
      logging_steps: numberOrUndefined(training.loggingSteps),
      save_steps: numberOrUndefined(training.saveSteps),
      eval_steps: numberOrUndefined(training.evalSteps),
      bf16: training.bf16,
      packing: training.packing,
      save_total_limit: numberOrUndefined(training.saveTotalLimit),
      optim: training.optim,
      lora: {
        r: numberOrUndefined(training.loraR),
        alpha: numberOrUndefined(training.loraAlpha),
        dropout: numberOrUndefined(training.loraDropout),
      },
      target_modules: training.targetModules.split(',').map((item) => item.trim()).filter(Boolean),
      gradient_checkpointing: training.gradientCheckpointing,
      random_state: numberOrUndefined(training.randomState),
    },
    save_lora: {
      enabled: saveLoraEnabled,
      order: 30,
      title: 'Save LoRA',
      description: 'Persist adapter weights and metadata snapshot.',
    },
    merge_model: {
      enabled: mergeEnabled,
      order: 40,
      title: 'Merge',
      description: 'Optional merged model export.',
      merge_lora: merge.mergeLora,
      save_merged_16bit: merge.saveMerged16Bit,
      output_behavior: merge.outputBehavior,
      output_path: merge.outputBehavior === 'custom' ? merge.outputPath || undefined : undefined,
      safe_serialization: merge.safeSerialization,
    },
    evaluation: {
      enabled: evaluationEnabled,
      order: 50,
      title: 'Evaluation',
      description: 'Remote eval runner configuration.',
      target: evaluation.target,
      dataset: selectedEvalDataset
        ? {
            id: selectedEvalDataset.id,
            source: evaluation.datasetSource,
            path: selectedEvalDataset.jsonPath,
            format: evaluation.format,
          }
        : undefined,
      question_field: evaluation.questionField,
      answer_field: evaluation.answerField,
      score_field: evaluation.scoreField,
      max_score_field: evaluation.maxScoreField,
      tags_field: evaluation.tagsField,
      max_samples: numberOrUndefined(evaluation.maxSamples),
      max_new_tokens: numberOrUndefined(evaluation.maxNewTokens),
      temperature: numberOrUndefined(evaluation.temperature),
      do_sample: evaluation.doSample,
      prompt_template: evaluation.promptTemplate,
    },
    upload_huggingface: {
      enabled: uploadEnabled,
      order: 60,
      title: 'Upload / Hugging Face',
      description: 'Push artifacts and metadata to HF repos.',
      push_lora: upload.pushLora,
      push_merged: upload.pushMerged,
      push_metadata: upload.pushMetadata,
      repo_id_lora: upload.repoIdLora || undefined,
      repo_id_merged: upload.repoIdMerged || undefined,
      repo_id_metadata: upload.repoIdMetadata || undefined,
      private: upload.visibility === 'private',
      commit_message: upload.commitMessage || undefined,
      revision: upload.revision || undefined,
    },
    finalize: {
      enabled: true,
      order: 70,
      title: 'Finalize / Reporting',
      description: 'Final status, log upload and callbacks.',
    },
    reporting: {
      enabled: reportingEnabled,
      order: 80,
      title: 'Reporting',
      description: 'Callback transport and timeout policy.',
      status_callback: reporting.statusCallback,
      progress_callback: reporting.progressCallback,
      final_callback: reporting.finalCallback,
      logs_callback: reporting.logsCallback,
      auth_token_inheritance: reporting.authTokenInheritance,
      timeout_seconds: numberOrUndefined(reporting.timeoutSeconds),
    },
  };
}

function StageCard({
  id,
  title,
  description,
  enabled,
  expanded,
  summary,
  dependency,
  onToggleEnabled,
  onToggleExpanded,
  children,
}: {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  expanded: boolean;
  summary: string;
  dependency?: string;
  onToggleEnabled: (value: boolean) => void;
  onToggleExpanded: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border', enabled ? 'border-slate-700 bg-slate-900/70' : 'border-slate-800 bg-slate-950/30')}>
      <div className="flex items-start gap-3 p-4">
        <div className="pt-0.5 text-slate-500">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
        <button type="button" onClick={onToggleExpanded} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className={cn('rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider', enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500')}>
              {enabled ? 'enabled' : 'disabled'}
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-400">{description}</div>
          <div className="mt-2 text-[11px] text-slate-500">{summary}</div>
          {dependency ? <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">Depends on: {dependency}</div> : null}
        </button>
        <label className="mt-0.5 inline-flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={enabled} onChange={(event) => onToggleEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-600" />
          Active
        </label>
      </div>
      {expanded ? <div className="border-t border-slate-800 px-4 py-4">{children}</div> : null}
    </div>
  );
}

export default function TrainingPage() {
  const navigate = useNavigate();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.getDatasets });
  const workersQuery = useQuery({ queryKey: ['workers'], queryFn: api.getWorkers });
  const presetsQuery = useQuery({ queryKey: ['runtime-presets'], queryFn: api.getRuntimePresets });
  const evalDatasetsQuery = useQuery({ queryKey: ['eval-datasets'], queryFn: api.getEvalDatasets });
  const evalConfigQuery = useQuery({ queryKey: ['eval-config'], queryFn: api.getEvalConfig });

  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [workerId, setWorkerId] = useState('any');
  const [expanded, setExpanded] = useState<ExpandMap>({
    prepare: true,
    training: true,
    saveLora: false,
    merge: false,
    evaluation: false,
    upload: false,
    reporting: false,
  });

  const [prepareEnabled, setPrepareEnabled] = useState(true);
  const [trainingEnabled, setTrainingEnabled] = useState(true);
  const [saveLoraEnabled, setSaveLoraEnabled] = useState(true);
  const [mergeEnabled, setMergeEnabled] = useState(true);
  const [evaluationEnabled, setEvaluationEnabled] = useState(false);
  const [uploadEnabled, setUploadEnabled] = useState(true);
  const [reportingEnabled, setReportingEnabled] = useState(true);

  const [training, setTraining] = useState<TrainingStageState>({
    method: 'qlora',
    runtimePresetId: '',
    logicalBaseModelId: '',
    trainerImage: '',
    modelLocalPath: '',
    loadIn4bit: true,
    maxSeqLength: '4096',
    perDeviceTrainBatchSize: '1',
    gradientAccumulationSteps: '8',
    numTrainEpochs: '3',
    learningRate: '0.0002',
    warmupRatio: '0.03',
    loggingSteps: '10',
    saveSteps: '200',
    evalSteps: '200',
    bf16: true,
    packing: false,
    saveTotalLimit: '2',
    optim: 'adamw_8bit',
    loraR: '16',
    loraAlpha: '16',
    loraDropout: '0',
    targetModules: 'q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj',
    gradientCheckpointing: true,
    randomState: '3407',
  });

  const [merge, setMerge] = useState<MergeStageState>({
    saveMerged16Bit: true,
    mergeLora: true,
    outputBehavior: 'default',
    outputPath: '',
    safeSerialization: true,
  });

  const [evaluation, setEvaluation] = useState<EvalStageState>({
    target: 'auto',
    datasetId: '',
    datasetSource: 'local',
    format: 'jsonl',
    questionField: 'question',
    answerField: 'candidateAnswer',
    scoreField: 'referenceScore',
    maxScoreField: 'maxScore',
    tagsField: 'hashTags',
    maxSamples: '100',
    maxNewTokens: '128',
    temperature: '0',
    doSample: false,
    promptTemplate: '',
  });

  const [upload, setUpload] = useState<UploadStageState>({
    pushLora: true,
    pushMerged: true,
    pushMetadata: true,
    repoIdLora: '',
    repoIdMerged: '',
    repoIdMetadata: '',
    visibility: 'private',
    commitMessage: 'Upload training artifacts',
    revision: '',
  });

  const [reporting, setReporting] = useState<ReportingStageState>({
    statusCallback: true,
    progressCallback: true,
    finalCallback: true,
    logsCallback: true,
    authTokenInheritance: true,
    timeoutSeconds: '30',
  });

  useEffect(() => {
    const qlora = settingsQuery.data?.qlora;
    if (!qlora) return;
    setTraining((current) => ({
      ...current,
      loadIn4bit: qlora.loadIn4bit,
      maxSeqLength: String(qlora.maxSeqLength ?? current.maxSeqLength),
      perDeviceTrainBatchSize: String(qlora.perDeviceTrainBatchSize ?? current.perDeviceTrainBatchSize),
      gradientAccumulationSteps: String(qlora.gradientAccumulationSteps ?? current.gradientAccumulationSteps),
      numTrainEpochs: String(qlora.numTrainEpochs ?? current.numTrainEpochs),
      learningRate: String(qlora.learningRate ?? current.learningRate),
      warmupRatio: String(qlora.warmupRatio ?? current.warmupRatio),
      loraR: String(qlora.loraR ?? current.loraR),
      loraAlpha: String(qlora.loraAlpha ?? current.loraAlpha),
      loraDropout: String(qlora.loraDropout ?? current.loraDropout),
      targetModules: Array.isArray(qlora.targetModules) ? qlora.targetModules.join(', ') : current.targetModules,
      method: qlora.loadIn4bit ? 'qlora' : current.method,
    }));
  }, [settingsQuery.data]);

  const presets = useMemo(() => (Array.isArray(presetsQuery.data) ? presetsQuery.data : []), [presetsQuery.data]);
  const datasets = useMemo(() => (Array.isArray(datasetsQuery.data) ? datasetsQuery.data : []), [datasetsQuery.data]);
  const workers = useMemo(() => (Array.isArray(workersQuery.data) ? workersQuery.data : []), [workersQuery.data]);
  const evalDatasets = useMemo(() => (Array.isArray(evalDatasetsQuery.data) ? evalDatasetsQuery.data : []), [evalDatasetsQuery.data]);

  useEffect(() => {
    if (!datasetId && datasets[0]?.id) setDatasetId(datasets[0].id);
  }, [datasetId, datasets]);

  useEffect(() => {
    if (!training.runtimePresetId && presets[0]?.id) {
      setTraining((current) => ({ ...current, runtimePresetId: presets[0].id }));
    }
  }, [presets, training.runtimePresetId]);

  useEffect(() => {
    if (!evaluation.datasetId && evalDatasets[0]?.id) {
      setEvaluation((current) => ({ ...current, datasetId: evalDatasets[0].id }));
    }
  }, [evaluation.datasetId, evalDatasets]);

  useEffect(() => {
    if (!evaluation.promptTemplate && evalConfigQuery.data?.defaultPromptTemplate) {
      setEvaluation((current) => ({ ...current, promptTemplate: evalConfigQuery.data?.defaultPromptTemplate || current.promptTemplate }));
    }
  }, [evalConfigQuery.data, evaluation.promptTemplate]);

  const selectedPreset = useMemo(() => normalizePreset(presets.find((item) => item.id === training.runtimePresetId)), [presets, training.runtimePresetId]);
  const selectedDataset = useMemo(() => datasets.find((item) => item.id === datasetId) || null, [datasetId, datasets]);
  const selectedEvalDataset = useMemo(() => evalDatasets.find((item) => item.id === evaluation.datasetId) || null, [evalDatasets, evaluation.datasetId]);

  useEffect(() => {
    if (!selectedPreset) return;
    setTraining((current) => ({
      ...current,
      runtimePresetId: selectedPreset.id,
      logicalBaseModelId: selectedPreset.logicalBaseModelId,
      trainerImage: selectedPreset.trainerImage,
      modelLocalPath: selectedPreset.modelLocalPath,
    }));
  }, [selectedPreset]);

  const pipelinePayload = useMemo(
    () => buildPipelinePayload({
      prepareEnabled,
      trainingEnabled,
      saveLoraEnabled,
      mergeEnabled,
      evaluationEnabled,
      uploadEnabled,
      reportingEnabled,
      training,
      merge,
      evaluation,
      upload,
      reporting,
      selectedEvalDataset: selectedEvalDataset ? { id: selectedEvalDataset.id, jsonPath: selectedEvalDataset.jsonPath, name: selectedEvalDataset.name } : null,
    }),
    [trainingEnabled, mergeEnabled, evaluationEnabled, uploadEnabled, reportingEnabled, training, merge, evaluation, upload, reporting, selectedEvalDataset],
  );

  const startMutation = useMutation({
    mutationFn: (payload: any) => api.startRemoteTrain(payload),
    onSuccess: (job) => {
      navigate(`/app/jobs?selected=${encodeURIComponent(job.id)}`);
    },
  });

  const canStart = !!datasetId && !!training.runtimePresetId && trainingEnabled;

  const handleStart = () => {
    startMutation.mutate({
      datasetId,
      name: name.trim() || undefined,
      workerId: workerId === 'any' ? undefined : workerId,
      runtimePresetId: training.runtimePresetId,
      qlora: {
        loadIn4bit: training.method === 'qlora' ? true : training.loadIn4bit,
        maxSeqLength: Number(training.maxSeqLength),
        perDeviceTrainBatchSize: Number(training.perDeviceTrainBatchSize),
        gradientAccumulationSteps: Number(training.gradientAccumulationSteps),
        learningRate: Number(training.learningRate),
        numTrainEpochs: Number(training.numTrainEpochs),
        warmupRatio: Number(training.warmupRatio),
        loraR: Number(training.loraR),
        loraAlpha: Number(training.loraAlpha),
        loraDropout: Number(training.loraDropout),
        targetModules: training.targetModules.split(',').map((item) => item.trim()).filter(Boolean),
        useLora: true,
      },
      hfPublish: {
        enabled: uploadEnabled,
        push_lora: upload.pushLora,
        push_merged: upload.pushMerged,
        repo_id_lora: upload.repoIdLora || undefined,
        repo_id_merged: upload.repoIdMerged || undefined,
      },
      pipeline: pipelinePayload,
    });
  };

  const trainingSummary = stageSummary([
    training.method.toUpperCase(),
    `${training.numTrainEpochs} epochs`,
    `lr ${training.learningRate}`,
    `${training.perDeviceTrainBatchSize}×${training.gradientAccumulationSteps}`,
    selectedPreset?.title,
  ]);

  const mergeSummary = stageSummary([
    merge.saveMerged16Bit ? 'save merged 16-bit' : null,
    merge.safeSerialization ? 'safe serialization' : null,
    merge.outputBehavior === 'custom' ? `custom path ${merge.outputPath || '—'}` : 'default output',
  ]);

  const evalSummary = stageSummary([
    evaluation.target,
    selectedEvalDataset?.name,
    `${evaluation.maxSamples || 'all'} samples`,
    `${evaluation.maxNewTokens} tokens`,
  ]);

  const uploadSummary = stageSummary([
    boolSummary(upload.pushLora, 'push LoRA'),
    boolSummary(upload.pushMerged, 'push merged'),
    boolSummary(upload.pushMetadata, 'push metadata'),
    upload.visibility,
  ]);

  const reportingSummary = stageSummary([
    boolSummary(reporting.statusCallback, 'status'),
    boolSummary(reporting.progressCallback, 'progress'),
    boolSummary(reporting.finalCallback, 'final'),
    boolSummary(reporting.logsCallback, 'logs'),
    `${reporting.timeoutSeconds}s timeout`,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Train"
        description="Remote training is configured as a pipeline. Choose runtime preset, tune stages, then generate a launchable remote job."
        actions={
          <Button onClick={handleStart} disabled={!canStart || startMutation.isPending}>
            {startMutation.isPending ? 'Creating…' : 'Create remote job'}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Job context</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Job name</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="qwen-7b-remote-train" />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Dataset</label>
              <Select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
                <option value="">Select dataset</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.rows} rows)
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Worker</label>
              <Select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
                <option value="any">Any available</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} ({worker.status})
                  </option>
                ))}
              </Select>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
              Remote flow stays agent-based: orchestrator creates job, operator launches trainer container from launch bundle, agent reports status/progress/final/logs back.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runtime preset</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Preset</label>
              <Select
                value={training.runtimePresetId}
                onChange={(event) => setTraining((current) => ({ ...current, runtimePresetId: event.target.value }))}
              >
                <option value="">Select preset</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.title}
                  </option>
                ))}
              </Select>
            </div>

            {selectedPreset ? (
              <div className="space-y-3 rounded-xl border border-blue-900/30 bg-blue-950/10 p-4 text-sm">
                <div className="flex items-center gap-2 text-blue-300">
                  <Package2 size={14} />
                  {selectedPreset.title}
                </div>
                <div className="grid gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Family</div>
                    <div className="text-white">{selectedPreset.family}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Logical base model</div>
                    <div className="break-all text-white">{selectedPreset.logicalBaseModelId}</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
                      <span>Trainer image</span>
                      <CopyButton text={selectedPreset.trainerImage} className="h-5 w-5 px-1 py-0.5" />
                    </div>
                    <div className="break-all font-mono text-[11px] text-slate-300">{selectedPreset.trainerImage}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">model local path</div>
                      <div className="text-white">{selectedPreset.modelLocalPath}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">SHM / GPU</div>
                      <div className="text-white">{selectedPreset.defaultShmSize} · {selectedPreset.gpuCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">No runtime preset selected.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow size={16} className="text-blue-400" />
            Pipeline stages
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StageCard
            id="prepare"
            title="1. Prepare / Assets"
            description="Resolve runtime preset, dataset and output locations. Safe fixed order, no drag-and-drop."
            enabled={prepareEnabled}
            expanded={!!expanded.prepare}
            summary={stageSummary([selectedDataset?.name, selectedPreset?.title, selectedPreset?.logicalBaseModelId])}
            onToggleEnabled={setPrepareEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, prepare: !value.prepare }))}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Dataset source</div>
                <div className="mt-1 text-sm text-white">{selectedDataset?.name || '—'}</div>
                <div className="mt-1 text-[11px] text-slate-500">{selectedDataset?.processedPath || 'Select dataset above'}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Resolved runtime</div>
                <div className="mt-1 text-sm text-white">{selectedPreset?.title || '—'}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                  <Link2 size={12} />
                  {selectedPreset?.trainerImage || 'Select preset above'}
                </div>
              </div>
            </div>
          </StageCard>

          <StageCard
            id="training"
            title="2. Training"
            description="Fine-grained remote trainer settings. Runtime preset fields are shown explicitly and serialized into payload."
            enabled={trainingEnabled}
            expanded={!!expanded.training}
            summary={trainingSummary}
            dependency="Prepare / Assets"
            onToggleEnabled={setTrainingEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, training: !value.training }))}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Method</label>
                <Select
                  value={training.method}
                  onChange={(event) => setTraining((current) => ({ ...current, method: event.target.value as 'lora' | 'qlora', loadIn4bit: event.target.value === 'qlora' ? true : current.loadIn4bit }))}
                >
                  <option value="lora">LoRA</option>
                  <option value="qlora">QLoRA</option>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">load_in_4bit</label>
                <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={training.method === 'qlora' ? true : training.loadIn4bit}
                    disabled={training.method === 'qlora'}
                    onChange={(event) => setTraining((current) => ({ ...current, loadIn4bit: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                  {training.method === 'qlora' ? 'Forced by QLoRA' : 'Enabled'}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Logical base model</label>
                <Input value={training.logicalBaseModelId} readOnly className="font-mono text-[11px] text-slate-300" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Trainer image</label>
                <div className="relative">
                  <Input value={training.trainerImage} readOnly className="pr-9 font-mono text-[11px] text-slate-300" />
                  <div className="absolute inset-y-0 right-2 flex items-center">
                    <CopyButton text={training.trainerImage} className="h-5 w-5 px-1 py-0.5" />
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Model local path</label>
                <Input value={training.modelLocalPath} readOnly className="font-mono text-[11px] text-slate-300" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">max_seq_length</label>
                <Input value={training.maxSeqLength} onChange={(event) => setTraining((current) => ({ ...current, maxSeqLength: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">per_device_train_batch_size</label>
                <Input value={training.perDeviceTrainBatchSize} onChange={(event) => setTraining((current) => ({ ...current, perDeviceTrainBatchSize: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">gradient_accumulation_steps</label>
                <Input value={training.gradientAccumulationSteps} onChange={(event) => setTraining((current) => ({ ...current, gradientAccumulationSteps: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">num_train_epochs</label>
                <Input value={training.numTrainEpochs} onChange={(event) => setTraining((current) => ({ ...current, numTrainEpochs: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">learning_rate</label>
                <Input value={training.learningRate} onChange={(event) => setTraining((current) => ({ ...current, learningRate: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">warmup_ratio</label>
                <Input value={training.warmupRatio} onChange={(event) => setTraining((current) => ({ ...current, warmupRatio: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">optim</label>
                <Input value={training.optim} onChange={(event) => setTraining((current) => ({ ...current, optim: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">logging_steps</label>
                <Input value={training.loggingSteps} onChange={(event) => setTraining((current) => ({ ...current, loggingSteps: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">save_steps</label>
                <Input value={training.saveSteps} onChange={(event) => setTraining((current) => ({ ...current, saveSteps: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">eval_steps</label>
                <Input value={training.evalSteps} onChange={(event) => setTraining((current) => ({ ...current, evalSteps: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">save_total_limit</label>
                <Input value={training.saveTotalLimit} onChange={(event) => setTraining((current) => ({ ...current, saveTotalLimit: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">lora.r</label>
                <Input value={training.loraR} onChange={(event) => setTraining((current) => ({ ...current, loraR: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">lora.alpha</label>
                <Input value={training.loraAlpha} onChange={(event) => setTraining((current) => ({ ...current, loraAlpha: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">lora.dropout</label>
                <Input value={training.loraDropout} onChange={(event) => setTraining((current) => ({ ...current, loraDropout: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">random_state</label>
                <Input value={training.randomState} onChange={(event) => setTraining((current) => ({ ...current, randomState: event.target.value }))} />
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">target_modules</label>
                <Textarea value={training.targetModules} onChange={(event) => setTraining((current) => ({ ...current, targetModules: event.target.value }))} className="min-h-[96px] font-mono text-[11px]" />
              </div>
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={training.bf16} onChange={(event) => setTraining((current) => ({ ...current, bf16: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                  bf16
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={training.packing} onChange={(event) => setTraining((current) => ({ ...current, packing: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                  packing
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={training.gradientCheckpointing} onChange={(event) => setTraining((current) => ({ ...current, gradientCheckpointing: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                  gradient checkpointing
                </label>
              </div>
            </div>
          </StageCard>

          <StageCard
            id="saveLora"
            title="3. Save LoRA"
            description="Persist adapter weights before optional merge and upload stages."
            enabled={saveLoraEnabled}
            expanded={!!expanded.saveLora}
            summary="Adapter weights and training snapshot are stored for downstream stages."
            dependency="Training"
            onToggleEnabled={setSaveLoraEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, saveLora: !value.saveLora }))}
          >
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
              No extra settings yet. Stage remains explicit because downstream merge/upload/evaluation depend on saved adapters.
            </div>
          </StageCard>

          <StageCard
            id="merge"
            title="4. Merge model"
            description="Optional merge of LoRA into a runnable merged checkpoint."
            enabled={mergeEnabled}
            expanded={!!expanded.merge}
            summary={mergeSummary}
            dependency="Save LoRA"
            onToggleEnabled={setMergeEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, merge: !value.merge }))}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={merge.mergeLora} onChange={(event) => setMerge((current) => ({ ...current, mergeLora: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                merge_lora
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={merge.saveMerged16Bit} onChange={(event) => setMerge((current) => ({ ...current, saveMerged16Bit: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                save_merged_16bit
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={merge.safeSerialization} onChange={(event) => setMerge((current) => ({ ...current, safeSerialization: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                safe serialization
              </label>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Output behavior</label>
                <Select value={merge.outputBehavior} onChange={(event) => setMerge((current) => ({ ...current, outputBehavior: event.target.value as 'default' | 'custom' }))}>
                  <option value="default">default</option>
                  <option value="custom">custom path</option>
                </Select>
              </div>
            </div>
            {merge.outputBehavior === 'custom' ? (
              <div className="mt-4">
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Target path / behavior</label>
                <Input value={merge.outputPath} onChange={(event) => setMerge((current) => ({ ...current, outputPath: event.target.value }))} placeholder="/output/merged" />
              </div>
            ) : null}
          </StageCard>

          <StageCard
            id="evaluation"
            title="5. Evaluation"
            description="Remote evaluation configuration, including editable input prompt/template for eval runner."
            enabled={evaluationEnabled}
            expanded={!!expanded.evaluation}
            summary={evalSummary}
            dependency="Training or Merge model"
            onToggleEnabled={setEvaluationEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, evaluation: !value.evaluation }))}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Target</label>
                <Select value={evaluation.target} onChange={(event) => setEvaluation((current) => ({ ...current, target: event.target.value as 'auto' | 'lora' | 'merged' }))}>
                  <option value="auto">auto</option>
                  <option value="lora">lora</option>
                  <option value="merged">merged</option>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Dataset</label>
                <Select value={evaluation.datasetId} onChange={(event) => setEvaluation((current) => ({ ...current, datasetId: event.target.value }))}>
                  <option value="">Select eval dataset</option>
                  {evalDatasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} ({dataset.samplesCount})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Dataset source</label>
                <Select value={evaluation.datasetSource} onChange={(event) => setEvaluation((current) => ({ ...current, datasetSource: event.target.value as 'local' | 'remote' }))}>
                  <option value="local">local</option>
                  <option value="remote">remote</option>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Format</label>
                <Select value={evaluation.format} onChange={(event) => setEvaluation((current) => ({ ...current, format: event.target.value as 'jsonl' | 'json' }))}>
                  <option value="jsonl">jsonl</option>
                  <option value="json">json</option>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">question field</label>
                <Input value={evaluation.questionField} onChange={(event) => setEvaluation((current) => ({ ...current, questionField: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">answer field</label>
                <Input value={evaluation.answerField} onChange={(event) => setEvaluation((current) => ({ ...current, answerField: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">score field</label>
                <Input value={evaluation.scoreField} onChange={(event) => setEvaluation((current) => ({ ...current, scoreField: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">max score field</label>
                <Input value={evaluation.maxScoreField} onChange={(event) => setEvaluation((current) => ({ ...current, maxScoreField: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">tags field</label>
                <Input value={evaluation.tagsField} onChange={(event) => setEvaluation((current) => ({ ...current, tagsField: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">max_samples</label>
                <Input value={evaluation.maxSamples} onChange={(event) => setEvaluation((current) => ({ ...current, maxSamples: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">max_new_tokens</label>
                <Input value={evaluation.maxNewTokens} onChange={(event) => setEvaluation((current) => ({ ...current, maxNewTokens: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">temperature</label>
                <Input value={evaluation.temperature} onChange={(event) => setEvaluation((current) => ({ ...current, temperature: event.target.value }))} />
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Evaluation prompt / prompt_template</label>
                <Textarea value={evaluation.promptTemplate} onChange={(event) => setEvaluation((current) => ({ ...current, promptTemplate: event.target.value }))} className="min-h-[220px] font-mono text-[11px]" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {['${question}', '${candidateAnswer}', '${referenceScore}', '${maxScore}', '${tagsText}'].map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => setEvaluation((current) => ({ ...current, promptTemplate: `${current.promptTemplate}${current.promptTemplate ? '\n' : ''}${token}` }))}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-blue-300 hover:bg-slate-700"
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={evaluation.doSample} onChange={(event) => setEvaluation((current) => ({ ...current, doSample: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                  do_sample
                </label>
                <div className="rounded-lg border border-slate-800 bg-black/20 p-2 text-[11px] text-slate-500">
                  Prompt is stored in frontend state and serialized into pipeline payload, so it survives save / retry / clone / reopen when backend echoes paramsSnapshot.
                </div>
              </div>
            </div>
          </StageCard>

          <StageCard
            id="upload"
            title="6. Upload / Hugging Face"
            description="Artifact publication and metadata upload configuration."
            enabled={uploadEnabled}
            expanded={!!expanded.upload}
            summary={uploadSummary}
            dependency="Save LoRA / Merge / Evaluation"
            onToggleEnabled={setUploadEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, upload: !value.upload }))}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={upload.pushLora} onChange={(event) => setUpload((current) => ({ ...current, pushLora: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                push_lora
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={upload.pushMerged} onChange={(event) => setUpload((current) => ({ ...current, pushMerged: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                push_merged
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={upload.pushMetadata} onChange={(event) => setUpload((current) => ({ ...current, pushMetadata: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                push_metadata
              </label>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">Visibility</label>
                <Select value={upload.visibility} onChange={(event) => setUpload((current) => ({ ...current, visibility: event.target.value as 'private' | 'public' }))}>
                  <option value="private">private</option>
                  <option value="public">public</option>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">repo_id_lora</label>
                <Input value={upload.repoIdLora} onChange={(event) => setUpload((current) => ({ ...current, repoIdLora: event.target.value }))} placeholder="org/model-lora" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">repo_id_merged</label>
                <Input value={upload.repoIdMerged} onChange={(event) => setUpload((current) => ({ ...current, repoIdMerged: event.target.value }))} placeholder="org/model-merged" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">repo_id_metadata</label>
                <Input value={upload.repoIdMetadata} onChange={(event) => setUpload((current) => ({ ...current, repoIdMetadata: event.target.value }))} placeholder="org/model-metadata" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">revision</label>
                <Input value={upload.revision} onChange={(event) => setUpload((current) => ({ ...current, revision: event.target.value }))} placeholder="main" />
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">commit_message</label>
              <Input value={upload.commitMessage} onChange={(event) => setUpload((current) => ({ ...current, commitMessage: event.target.value }))} />
            </div>
          </StageCard>

          <StageCard
            id="reporting"
            title="7. Finalize / Reporting"
            description="Callback behaviour, auth-token inheritance and timeout policy."
            enabled={reportingEnabled}
            expanded={!!expanded.reporting}
            summary={reportingSummary}
            dependency="All enabled upstream stages"
            onToggleEnabled={setReportingEnabled}
            onToggleExpanded={() => setExpanded((value) => ({ ...value, reporting: !value.reporting }))}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={reporting.statusCallback} onChange={(event) => setReporting((current) => ({ ...current, statusCallback: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                status callback
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={reporting.progressCallback} onChange={(event) => setReporting((current) => ({ ...current, progressCallback: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                progress callback
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={reporting.finalCallback} onChange={(event) => setReporting((current) => ({ ...current, finalCallback: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                final callback
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={reporting.logsCallback} onChange={(event) => setReporting((current) => ({ ...current, logsCallback: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                logs callback
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={reporting.authTokenInheritance} onChange={(event) => setReporting((current) => ({ ...current, authTokenInheritance: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />
                auth token inheritance
              </label>
              <div>
                <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">timeouts</label>
                <Input value={reporting.timeoutSeconds} onChange={(event) => setReporting((current) => ({ ...current, timeoutSeconds: event.target.value }))} />
              </div>
            </div>
          </StageCard>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Serialized pipeline preview</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="scrollbar-thin max-h-[540px] overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] text-slate-300">{JSON.stringify(pipelinePayload, null, 2)}</pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operator notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-400">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              Runtime preset is the only source of truth for trainer image, logical base model and model local path.
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              `logical_base_model_id` is serialized separately from `model_local_path`, so `/app` will not leak into HF metadata as base model.
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              Evaluation prompt template is part of pipeline payload, so retry/clone/reopen can restore it from paramsSnapshot.
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              Launch bundle is generated after job creation. Operator can copy `JOB_CONFIG_URL`, `docker run`, `docker-compose` or download the bundle from job details.
            </div>
            {startMutation.error ? (
              <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">
                {(startMutation.error as Error).message}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

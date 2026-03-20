const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = { ...(init?.headers || {}) } as Record<string, string>;

  if (!headers['Content-Type'] && !(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = localStorage.getItem('llm_lab_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('llm_lab_token');
      localStorage.removeItem('llm_lab_user');
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login';
      }
    }
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error?: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';

export type AwqCalibrationMode = 'text_only' | 'permissive';

export type Settings = {
  baseModel: string;
  qlora: {
    loadIn4bit: boolean;
    maxSeqLength: number;
    perDeviceTrainBatchSize: number;
    gradientAccumulationSteps: number;
    learningRate: number;
    numTrainEpochs: number;
    warmupRatio: number;
    loraR: number;
    loraAlpha: number;
    loraDropout: number;
    targetModules: string[];
    useLora?: boolean;
  };
  quantization: {
    awq: {
      dtype: string;
      numSamples: number;
      maxSeqLen: number;
      bits: number;
      groupSize: number;
      sym: boolean;
      trustRemoteCode: boolean;
      calibrationMode: AwqCalibrationMode;
    };
  };
  inference: {
    provider: string;
    model: string;
    host: string;
    port: number;
    gpuMemoryUtilization: number;
    tensorParallelSize: number;
    maxModelLen: number;
    maxNumSeqs: number;
    swapSpace: number;
    quantization: string | null;
    dtype: string;
    trustRemoteCode: boolean;
    enforceEager: boolean;
    kvCacheDtype: string;
  };
  wandb?: {
    enabled: boolean;
    mode: 'online' | 'offline' | 'disabled';
    apiKey: string;
    project: string;
    entity: string;
    baseUrl?: string;
    httpProxy?: string;
    httpsProxy?: string;
    noProxy?: string;
  };
};

export type QuantizationCapability = {
  supported: boolean;
  methods: string[];
  runner?: 'ml_env' | 'quant_env';
  experimental?: boolean;
  reason?: string | null;
};

export type ModelItem = {
  jobId: string;
  id: string;
  name: string;
  repoId: string;
  createdAt: string;
  status: 'downloading' | 'ready' | 'failed' | 'building';
  path: string;
  logFile: string;
  pid: number | null;
  error: string | null;
  size?: number;
  sizeHuman?: string;
  quantization?: string | null;
  vramEstimate?: string;
  runner?: string;
  envName?: string;
  quantizationCapability?: QuantizationCapability;
};

export type MergeDeviceStrategy = 'cpu' | 'cuda' | 'auto';
export type MergeDtype = 'auto' | 'float16' | 'bfloat16' | 'float32';
export type BaseModelSource = 'auto' | 'manual';

export type MergeBuildOptions = {
  deviceStrategy: MergeDeviceStrategy;
  cudaDevice?: number;
  dtype?: MergeDtype;
  lowCpuMemUsage?: boolean;
  safeSerialization?: boolean;
  overwriteOutput?: boolean;
  maxShardSize?: string;
  offloadFolderName?: string;
  clearGpuBeforeMerge?: boolean;
  trustRemoteCode?: boolean;
  registerAsModel?: boolean;
  customOutputName?: string;
  baseModelSource?: BaseModelSource;
  baseModelOverride?: string;
};

export type MergeOptionsInfo = {
  deviceStrategies: MergeDeviceStrategy[];
  dtypes: MergeDtype[];
  defaultOptions: {
    deviceStrategy: MergeDeviceStrategy;
    cudaDevice: number;
    dtype: MergeDtype;
    lowCpuMemUsage: boolean;
    safeSerialization: boolean;
    overwriteOutput: boolean;
    maxShardSize: string;
    offloadFolderName: string;
    clearGpuBeforeMerge: boolean;
    trustRemoteCode: boolean;
    registerAsModel: boolean;
    baseModelSource: BaseModelSource;
    baseModelOverride: string;
  };
  gpus: Array<{
    model: string;
    vram: number;
    vendor: string;
  }>;
};

export type LoraItem = {
  id: string;
  name: string;
  jobId: string;
  baseModelId: string | null;
  baseModelName: string;
  baseModelRef: string;
  adapterPath: string;
  mergedPath: string | null;
  packagePath: string | null;
  createdAt: string;
  status: string;
  mergeStatus: string;
  mergeProgress?: number;
  mergePid?: number | null;
  mergeLogFile?: string | null;
  mergeOptions?: MergeBuildOptions | null;
  mergeArtifacts?: Array<{ name: string; path: string; size: number }>;
  mergedSize?: number;
  mergedSizeHuman?: string | null;
  trainingBaseModelPath?: string | null;
  packageStatus: string;
  error: string | null;
  size?: number;
  sizeHuman?: string;
};

export type Dataset = {
  id: string;
  name: string;
  createdAt: string;
  format: string;
  rawPath?: string;
  processedPath: string;
  rows: number;
};

export type DatasetPreviewResponse = {
  id: string;
  name: string;
  totalRows: number;
  preview: Array<{ messages: Array<{ role: string; content: string }> }>;
};

export type DatasetValidationResponse = {
  ok: boolean;
  detectedFormat: string;
  totalLines?: number;
  totalItems?: number;
  validCount: number;
  invalidCount: number;
  preview: Array<{ messages: Array<{ role: string; content: string }> }>;
  errors: Array<{ line?: number; index?: number; error: string; raw: unknown }>;
};

export type SyntheticGenType = 'qa' | 'summary' | 'cot' | 'cot-enhance';

export type SyntheticGenConfig = {
  name: string;
  type: SyntheticGenType;
  model: string;
  numPairs: number;
  chunkSize: number;
  chunkOverlap: number;
  curate: boolean;
  curateThreshold: number;
  sourceFiles: string[];
};

export type EvalModelSummary = {
  modelId: string;
  modelLabel: string;
  samples: number;
  parseSuccessRate: number;
  squaredDeltaSquaresMean: number | null;
  mae: number | null;
  rmse: number | null;
  exactRate: number;
  within1Rate: number;
  within2Rate: number;
  meanSignedError: number | null;
  avgPredictedScore?: number | null;
  parseErrors?: number;
  emptyResponses?: number;
};

export type SummaryMetrics = {
  rows?: number;
  final_loss?: number;
  duration_human?: string;
  bf16?: boolean;
  fp16?: boolean;
  sizeHuman?: string;
  validCount?: number;
  invalidCount?: number;
  targets?: number;
  promptsPerTarget?: number;
  models?: EvalModelSummary[];
};

export type SyntheticInvalidSample = {
  line: number;
  error: string;
  raw: string;
};

export type SyntheticImportMeta = {
  sampleLine?: string | null;
  sampleParsed?: unknown;
  invalidSamples?: SyntheticInvalidSample[];
  detectedFormats?: string[];
  totalLines?: number;
  validCount?: number;
  invalidCount?: number;
};

export type SyntheticMeta = {
  progressStep?: string | null;
  finalPath?: string | null;
  import?: SyntheticImportMeta;
};

export type JobProgress = {
  currentStage?: string;
  currentModelId?: string;
  currentModelName?: string;
  processedModels?: number;
  totalModels?: number;
  processedSamples?: number;
  totalSamples?: number;
  modelProgressPercent?: number;
  totalProgressPercent?: number;
  etaSeconds?: number;
  updatedAt?: string;
};

export type Job = {
  id: string;
  type: string;
  name: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  datasetId?: string;
  datasetPath?: string;
  modelId?: string | null;
  baseModel?: string;
  qlora?: Partial<Settings['qlora']>;
  outputDir: string;
  logFile: string;
  pid: number | null;
  error: string | null;
  paramsSnapshot?: any;
  modelPath?: string;
  datasetSnapshot?: {
    path: string;
    size: number;
    mtime: string | null;
    hash?: string | null;
  };
  modelSnapshot?: any;
  envSnapshot?: {
    python: string;
    torch: string;
    transformers: string;
    unsloth: string;
  };
  tags?: string[];
  notes?: string;
  artifacts?: Array<{ name: string; size: number; path: string }>;
  progressStep?: string;
  progress?: JobProgress;
  runner?: string;
  summaryMetrics?: SummaryMetrics;
  resultDatasetId?: string | null;
  syntheticMeta?: SyntheticMeta;
  workerId?: string | null;
  jobConfigUrl?: string | null;
  hfRepoIdLora?: string | null;
  hfRepoIdMerged?: string | null;
  hfRepoIdMetadata?: string | null;

  mode?: 'local' | 'remote';
  progressPercent?: number;
  runtimePresetId?: string | null;
  modelLocalPath?: string | null;
  containerImage?: string | null;

  launch?: {
    jobConfigUrl: string;
    env: {
      JOB_CONFIG_URL: string;
    };
    exampleDockerRun: string;
  } | null;
};

export type WorkerItem = {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  resources: any;
  labels: any;
  lastHeartbeat: string;
};

export type SyntheticPreviewRow = {
  line: number;
  sourceFormat: string;
  original: unknown;
  normalized: {
    messages: Array<{ role: string; content: string }>;
  };
};

export type SyntheticJobPreviewResponse = {
  ok: boolean;
  jobId: string;
  status: JobStatus;
  progressStep: string | null;
  path: string;
  totalLines: number;
  validCount: number;
  invalidCount: number;
  detectedFormats: string[];
  sampleLine: string | null;
  sampleParsed: unknown;
  preview: SyntheticPreviewRow[];
  invalidSamples: SyntheticInvalidSample[];
};

export type RuntimeProbe = {
  ok: boolean;
  status: string;
  checkedAt: string | null;
  error: string | null;
};

export type RuntimeCapabilities = {
  experimental: boolean;
  supportsStreaming: boolean;
  supportsLora: boolean;
  supportsAwq: boolean;
};

export type InferenceRuntime = {
  pid: number | null;
  model: string | null;
  startedAt: string | null;
  port: number;
  logFile?: string;
  baseModel?: string | null;
  activeModelId?: string | null;
  activeModelName?: string | null;
  activeLoraId?: string | null;
  activeLoraName?: string | null;
  providerRequested?: string;
  providerResolved?: string | null;
  compatibilityRisk?: 'low' | 'medium' | 'high' | null;
  compatibilityWarning?: string | null;
  capabilities?: RuntimeCapabilities;
  probe?: RuntimeProbe;
};

export type RuntimeState = {
  inference: InferenceRuntime;
  vllm?: InferenceRuntime;
};

export type ProviderItem = {
  id: string;
  label: string;
  description: string;
  available: boolean;
  reason: string | null;
};

export type ProvidersResponse = {
  available: ProviderItem[];
  selected: string;
  active: string | null;
};

export type RuntimeHealth = {
  ok: boolean;
  raw?: string;
  port?: number;
};

export type EvalSample = {
  id: string;
  question: string;
  candidateAnswer: string;
  referenceScore: number;
  sourceFile?: string;
  topic?: string | null;
  hashTags?: string[];
  maxScore?: number;
};

export type EvalDataset = {
  id: string;
  name: string;
  samplesCount: number;
  jsonPath: string;
  txtPath: string;
  createdAt: string;
  samples?: EvalSample[];
};

export type EvalDatasetValidationResponse = {
  validCount: number;
  invalidCount: number;
  errors: Array<{ index: number; error: string; raw: string }>;
  preview: EvalSample[];
};

export type EvalSampleResult = {
  sampleId: string;
  question: string;
  candidateAnswer: string;
  referenceScore: number;
  predictedScore: number | null;
  predictedFeedback: string | null;
  rawResponse: string | null;
  parseError: boolean;
  absoluteError: number | null;
  error?: string;
  modelId?: string;
  modelLabel?: string;
};

export type EvalBenchmarkResult = {
  target: {
    id: string;
    type: 'model' | 'lora';
    label: string;
    modelPath: string;
    loraPath?: string | null;
    loraName?: string | null;
  };
  results: EvalSampleResult[];
  metrics: {
    samples: number;
    parseSuccessRate: number;
    squaredDeltaSquaresMean: number | null;
    mae: number | null;
    rmse: number | null;
    exactRate: number;
    within1Rate: number;
    within2Rate: number;
    meanSignedError: number | null;
    avgPredictedScore?: number | null;
    parseErrors?: number;
    emptyResponses?: number;
  };
};

export type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  [key: string]: any;
};

export type DashboardSummary = {
  health: {
    ok: boolean;
    python: boolean;
    vllmBin: boolean;
    transformersPython?: boolean;
    quantizePython?: boolean;
    quantizeEnvOk?: boolean;
    time: string;
  };
  settings: {
    baseModel: string;
    inferenceModel: string;
    inferencePort: number;
  };
  runtime: RuntimeState;
  counts: {
    datasets: number;
    jobs: number;
    runningJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  recentJobs: Job[];
};

export type ChatResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
  }>;
};

export type ManagedProcess = {
  pid: number;
  type: string;
  label: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type ManagedProcessesCleanupResponse = {
  ok: boolean;
  killedCount: number;
  failed?: Array<{
    pid: number;
    type: string;
    error: string;
  }>;
  remaining?: number;
};

export type ComparisonTargetInput = {
  type: 'model' | 'lora';
  id: string;
};

export type ComparisonRunPayload = {
  name?: string;
  targets: ComparisonTargetInput[];
  prompts: string[];
  inference?: {
    provider?: string;
    port?: number;
    max_tokens?: number;
    temperature?: number;
    maxModelLen?: number;
    gpuMemoryUtilization?: number;
    tensorParallelSize?: number;
    quantization?: string | null;
    dtype?: string;
    trustRemoteCode?: boolean;
    enforceEager?: boolean;
    kvCacheDtype?: string;
    maxNumSeqs?: number;
    swapSpace?: number;
  };
};

export type ComparisonRunResponse = {
  ok: boolean;
  jobId: string;
  outputDir: string;
  logFile: string;
};

export type ComparisonSummary = {
  targets: number;
  promptsPerTarget: number;
  targetSummaries: Array<{
    target: {
      id: string;
      type: 'model' | 'lora';
      label: string;
      meta?: Record<string, unknown>;
    };
    provider: string;
    totalPrompts: number;
    okCount: number;
    failedCount: number;
    avgDurationSec: number | null;
    avgCompletionTokens: number | null;
  }>;
};

export type ComparisonResultRow = {
  prompt: string;
  startedAt: string;
  durationSec: number;
  ok: boolean;
  error?: string;
  response?: {
    content: string;
    finish_reason?: string | null;
    usage?: Record<string, unknown> | null;
  };
  raw?: unknown;
};

export type ComparisonResultItem = {
  target: {
    id: string;
    type: 'model' | 'lora';
    label: string;
    meta?: Record<string, unknown>;
  };
  runtime: {
    provider: string;
    model: string;
    activeModelName?: string | null;
    activeLoraName?: string | null;
    port?: number;
  };
  results: ComparisonResultRow[];
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export function createEventsSource() {
  return new EventSource(`${API_BASE}/events`);
}

export const api = {
  health: () => request<{ ok: boolean; service?: string; time?: string }>('/health'),

  login: (payload: any) => request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  createUser: (payload: any) => request<{ user: User }>('/auth/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  getDashboardSummary: () => request<DashboardSummary>('/dashboard/summary'),

  getSettings: () => request<Settings>('/settings'),
  updateSettings: (payload: DeepPartial<Settings>) =>
    request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getModels: () => request<ModelItem[]>('/models'),
  getModel: (id: string) => request<ModelItem>(`/models/${id}`),
  getModelLogs: (id: string, tail = 200) =>
    request<{ id: string; logFile: string; content: string }>(`/models/${id}/logs?tail=${tail}`),
  downloadModel: (payload: { repoId: string; name?: string }) =>
    request<ModelItem>('/models/download', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  activateModel: (id: string, payload?: Partial<Settings['inference']>) =>
    request<{ ok: boolean; model: ModelItem; runtime: InferenceRuntime }>(`/models/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  deleteModel: (id: string) =>
    request<{ ok: boolean }>(`/models/${id}`, {
      method: 'DELETE',
    }),
  quantizeModel: (payload: {
    modelId: string;
    method: string;
    name?: string;
    datasetPath?: string;
    numSamples?: number;
    maxSeqLen?: number;
    bits?: number;
    groupSize?: number;
    sym?: boolean;
    runner?: 'ml_env' | 'quant_env';
    dtype?: string;
    calibrationMode?: AwqCalibrationMode;
    trustRemoteCode?: boolean;
  }) =>
    request<ModelItem>('/models/quantize', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getLoras: () => request<LoraItem[]>('/loras'),
  getLora: (id: string) => request<LoraItem>(`/loras/${id}`),
  getLoraMergeOptions: () => request<MergeOptionsInfo>('/loras/merge-options'),
  getLoraMergeLogs: (id: string, tail = 200) =>
    request<{ id: string; logFile: string | null; content: string }>(`/loras/${id}/logs?tail=${tail}`),
  registerLoraFromJob: (payload: { jobId: string; name?: string }) =>
    request<LoraItem>('/loras/from-job', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  renameLora: (id: string, payload: { name: string }) =>
    request<LoraItem>(`/loras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  buildMergedLora: (id: string, payload?: Partial<MergeBuildOptions>) =>
    request<{ ok: boolean; lora: LoraItem }>(`/loras/${id}/build-merged`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  cancelMergedLora: (id: string) =>
    request<{ ok: boolean; lora: LoraItem }>(`/loras/${id}/cancel-merge`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  packageLora: (id: string) =>
    request<{ ok: boolean; lora: LoraItem; downloadPath: string }>(`/loras/${id}/package`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  activateLora: (id: string, payload?: Partial<Settings['inference']>) =>
    request<{ ok: boolean; lora: LoraItem; runtime: InferenceRuntime }>(`/loras/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  deactivateLora: () =>
    request<{ ok: boolean; runtime: InferenceRuntime }>('/loras/deactivate', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  deleteLora: (id: string) =>
    request<{ ok: boolean }>(`/loras/${id}`, {
      method: 'DELETE',
    }),

  getDatasets: () => request<Dataset[]>('/datasets'),
  validateDatasetJsonl: (payload: { jsonl: string }) =>
    request<DatasetValidationResponse>('/datasets/validate-jsonl', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createDatasetFromJsonl: (payload: { name: string; jsonl: string }) =>
    request<Dataset>('/datasets/from-jsonl', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createDatasetFromItems: (payload: {
    name: string;
    items: Array<{ messages: Array<{ role: string; content: string }> }>;
  }) =>
    request<Dataset>('/datasets/from-items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getDatasetPreview: (id: string, limit = 20) =>
    request<DatasetPreviewResponse>(`/datasets/${id}/preview?limit=${limit}`),
  deleteDataset: (id: string) =>
    request<{ ok: boolean }>(`/datasets/${id}`, {
      method: 'DELETE',
    }),

  getWorkers: () => request<WorkerItem[]>('/workers'),

  getJobs: () => request<Job[]>('/jobs'),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  getJobLogs: (id: string, tail = 200) =>
    request<{ id: string; logFile: string; content: string }>(`/jobs/${id}/logs?tail=${tail}`),
  startFineTune: (payload: {
    datasetId: string;
    name?: string;
    modelId?: string;
    baseModel?: string;
    qlora?: Partial<Settings['qlora']>;
  }) =>
    request<{ ok: boolean; jobId: string; logFile: string; outputDir: string }>('/jobs/fine-tune', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  startRemoteTrain: (payload: {
    datasetId: string;
    name?: string;
    modelId?: string;
    baseModel?: string;
    qlora?: Partial<Settings['qlora']>;
    hfPublish?: {
      enabled: boolean;
      push_lora?: boolean;
      push_merged?: boolean;
      repo_id_lora?: string;
      repo_id_merged?: string;
      private?: boolean;
    };
    workerId?: string;
  }) =>
    request<Job>('/jobs/remote-train', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  startSyntheticGen: (payload: SyntheticGenConfig) =>
    request<{ ok: boolean; jobId: string; logFile: string; outputDir: string }>('/jobs/synthetic-gen', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  startComparison: (payload: ComparisonRunPayload) =>
    request<ComparisonRunResponse>('/comparisons/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getComparisonJob: (jobId: string) =>
    request<Job>(`/comparisons/${jobId}`),
  getComparisonResult: (jobId: string) =>
    request<ComparisonResultItem[]>(`/comparisons/${jobId}/result`),
  getComparisonSummary: (jobId: string) =>
    request<ComparisonSummary>(`/comparisons/${jobId}/summary`),
  stopJob: (id: string) =>
    request<{ ok: boolean }>(`/jobs/${id}/stop`, {
      method: 'POST',
    }),
  updateJobMetadata: (id: string, payload: { tags?: string[]; notes?: string }) =>
    request<Job>(`/jobs/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  retryJob: (id: string) =>
    request<Job>(`/jobs/${id}/retry`, {
      method: 'POST',
    }),
  getRuntimePresets: () => request<RuntimePreset[]>('/jobs/runtime-presets'),

  getSyntheticJobPreview: (jobId: string, limit = 20) =>
    request<SyntheticJobPreviewResponse>(`/synthetic/jobs/${jobId}/preview?limit=${limit}`),

  getRuntime: () => request<RuntimeState>('/runtime'),
  getRuntimeProviders: () => request<ProvidersResponse>('/runtime/providers'),
  getRuntimeHealth: () => request<RuntimeHealth>('/runtime/health'),
  startVllm: (payload: {
    model: string;
    port: number;
    maxModelLen: number;
    gpuMemoryUtilization: number;
    tensorParallelSize: number;
    maxNumSeqs?: number;
    swapSpace?: number;
    quantization?: string | null;
    dtype?: string;
    trustRemoteCode?: boolean;
    enforceEager?: boolean;
    kvCacheDtype?: string;
    provider?: string;
  }) =>
    request<{ ok: boolean; runtime: InferenceRuntime }>('/runtime/vllm/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopVllm: () =>
    request<{ ok: boolean; runtime: InferenceRuntime }>('/runtime/vllm/stop', {
      method: 'POST',
    }),
  getRuntimeLogs: (tail = 200) =>
    request<{ logFile: string; content: string }>(`/runtime/logs?tail=${tail}`),

  getLogs: (params: { level?: string; q?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params.level) search.append('level', params.level);
    if (params.q) search.append('q', params.q);
    if (params.limit) search.append('limit', String(params.limit));
    return request<LogEntry[]>(`/logs?${search.toString()}`);
  },

  getMonitorStats: () => request<{
    cpu: { load: number; cores: number[] };
    memory: { total: number; used: number; free: number; active: number; swaptotal: number; swapused: number };
    gpus: Array<{ model: string; vendor: string; vram: number; vramUsed: number; utilizationGpu: number; temperatureGpu: number }>;
    disks: Array<{ fs: string; type: string; size: number; used: number; available: number; use: number; mount: string }>;
    network: Array<{ iface: string; operstate: string; rx_sec: number; tx_sec: number }>;
    gpuProcesses: Array<{ pid: number; name: string; cpu: number; mem: number; user: string; command: string }>;
  }>('/monitor/stats'),

  getManagedProcesses: () =>
    request<ManagedProcess[]>('/monitor/managed-processes'),

  cleanupManagedProcesses: (payload?: { types?: string[] }) =>
    request<ManagedProcessesCleanupResponse>('/monitor/managed-processes/cleanup', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  killProcess: (pid: number) =>
    request<{ ok: boolean }>('/monitor/kill', {
      method: 'POST',
      body: JSON.stringify({ pid }),
    }),

  clearGpu: () =>
    request<{ ok: boolean; killedCount: number }>('/monitor/clear-gpu', {
      method: 'POST',
    }),

  chat: (payload: {
    model?: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  }) =>
    request<ChatResponse>('/runtime/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  chatStream: async (payload: {
    model?: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature?: number;
    max_tokens?: number;
  }) => {
    const res = await fetch(`${API_BASE}/runtime/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: true }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    return res.body;
  },

  useJobOutput: (jobId: string) =>
    request<{ ok: boolean; runtime: InferenceRuntime; job: Job }>('/runtime/use-job-output', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  getEvalDatasets: () => request<EvalDataset[]>('/evaluations/datasets'),
  getEvalDataset: (id: string) => request<EvalDataset>(`/evaluations/datasets/${id}`),
  validateEvalDataset: (payload: { content: string }) =>
    request<EvalDatasetValidationResponse>('/evaluations/datasets/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  importEvalDataset: (payload: { name: string; content: string }) =>
    request<EvalDataset>('/evaluations/datasets/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteEvalDataset: (id: string) =>
    request<{ ok: boolean }>(`/evaluations/datasets/${id}`, {
      method: 'DELETE',
    }),
  getEvalConfig: () =>
    request<{ defaultPromptTemplate: string; availableVariables: Array<{ name: string; description: string }> }>(
      '/evaluations/config'
    ),
  runEvalBenchmark: (payload: { datasetId: string; targets: any[]; name?: string; promptTemplate?: string }) =>
    request<{ jobId: string }>('/evaluations/benchmark', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getEvalBenchmarkResult: (jobId: string) =>
    request<EvalBenchmarkResult[]>(`/evaluations/jobs/${jobId}/result`),

  uploadSyntheticSource: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ ok: boolean; filename: string; path: string }>('/synthetic/upload', {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
};

export type User = {
  id: number;
  username: string;
  role: string;
};

export type AuthResponse = {
  user: User;
  token: string;
};

export type RuntimePreset = {
  id: string;
  title: string;
  family: string;
  logicalBaseModelId: string;
  localModelPath: string;
  trainerImage: string;
  defaultShmSize: string;
  gpuCount: number;
  supports: {
    qlora: boolean;
    lora: boolean;
    merge: boolean;
  };
  enabled: boolean;
};

export type Api = typeof api;
export const apiBase = API_BASE;

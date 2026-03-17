const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = { ...(init?.headers || {}) } as Record<string, string>;

  if (!headers['Content-Type'] && !(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
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
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error?: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';

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

export type SummaryMetrics = {
  rows?: number;
  final_loss?: number;
  duration_human?: string;
  bf16?: boolean;
  fp16?: boolean;
  sizeHuman?: string;
  validCount?: number;
  invalidCount?: number;
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
  runner?: string;
  summaryMetrics?: SummaryMetrics;
  resultDatasetId?: string | null;
  syntheticMeta?: SyntheticMeta;
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
  startSyntheticGen: (payload: SyntheticGenConfig) =>
    request<{ ok: boolean; jobId: string; logFile: string; outputDir: string }>('/jobs/synthetic-gen', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopJob: (id: string) =>
    request<{ ok: boolean }>(`/jobs/${id}/stop`, {
      method: 'POST',
    }),
  updateJobMetadata: (id: string, payload: { tags?: string[]; notes?: string }) =>
    request<Job>(`/jobs/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

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

export type Api = typeof api;
export const apiBase = API_BASE;
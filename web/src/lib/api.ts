const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
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

export type ModelItem = {
  id: string;
  name: string;
  repoId: string;
  createdAt: string;
  status: 'downloading' | 'ready' | 'failed';
  path: string;
  logFile: string;
  pid: number | null;
  error: string | null;
  size?: number;
  sizeHuman?: string;
  quantization?: string | null;
  vramEstimate?: string;
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

export type Job = {
  id: string;
  type: string;
  name: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  datasetId: string;
  datasetPath: string;
  modelId?: string | null;
  baseModel: string;
  qlora?: Partial<Settings['qlora']>;
  outputDir: string;
  logFile: string;
  pid: number | null;
  error: string | null;
};

export type RuntimeState = {
  vllm: {
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
    probe?: {
      ok: boolean;
      status: string;
      checkedAt: string | null;
      error: string | null;
    };
  };
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
    request<{ ok: boolean; model: ModelItem; runtime: RuntimeState['vllm'] }>(`/models/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  deleteModel: (id: string) =>
    request<{ ok: boolean }>(`/models/${id}`, {
      method: 'DELETE',
    }),
  quantizeModel: (payload: { modelId: string; method: string; name?: string }) =>
    request<ModelItem>('/models/quantize', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getLoras: () => request<LoraItem[]>('/loras'),
  getLora: (id: string) => request<LoraItem>(`/loras/${id}`),
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
  buildMergedLora: (id: string) =>
    request<LoraItem>(`/loras/${id}/build-merged`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  packageLora: (id: string) =>
    request<{ ok: boolean; lora: LoraItem; downloadPath: string }>(`/loras/${id}/package`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  activateLora: (id: string, payload?: Partial<Settings['inference']>) =>
    request<{ ok: boolean; lora: LoraItem; runtime: RuntimeState['vllm'] }>(`/loras/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  deactivateLora: () =>
    request<{ ok: boolean; runtime: RuntimeState['vllm'] }>('/loras/deactivate', {
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
  stopJob: (id: string) =>
    request<{ ok: boolean }>(`/jobs/${id}/stop`, {
      method: 'POST',
    }),

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
    request<{ ok: boolean; runtime: RuntimeState['vllm'] }>('/runtime/vllm/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopVllm: () =>
    request<{ ok: boolean; runtime: RuntimeState['vllm'] }>('/runtime/vllm/stop', {
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
    request<{ ok: boolean; runtime: RuntimeState['vllm']; job: Job }>('/runtime/use-job-output', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),
};

export type Api = typeof api;
export const apiBase = API_BASE;
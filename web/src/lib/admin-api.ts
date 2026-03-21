import { api } from './api';
import { asArray } from './utils';

const API_BASE = import.meta.env.VITE_API_BASE || '';

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = { ...(init?.headers || {}) } as Record<string, string>;
  if (!headers['Content-Type'] && !(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = localStorage.getItem('llm_lab_token');
  if (token) headers.Authorization = `Bearer ${token}`;

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

export type CapabilityFlags = {
  qlora: boolean;
  lora: boolean;
  merge: boolean;
  evaluation: boolean;
};

export type BaseModelImageAdmin = {
  id: string;
  title: string;
  slug?: string;
  description?: string;
  family?: string;
  logicalBaseModelId: string;
  dockerImage: string;
  dockerRegistry?: string;
  dockerRepository?: string;
  dockerTag?: string;
  modelLocalPath: string;
  defaultShmSize: string;
  defaultGpuCount: number;
  cudaNotes?: string;
  memoryNotes?: string;
  notes?: string;
  supports: CapabilityFlags;
  enabled: boolean;
  archived?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type RecipeAdmin = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  baseModelImageId?: string | null;
  baseImageOverride?: string;
  trainerContextPath?: string;
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
  targetRegistry?: string;
  targetRepository: string;
  targetTagTemplate: string;
  stableTag?: string;
  pushEnabled: boolean;
  defaultRuntimePresetTitle?: string;
  defaultRuntimePresetDescription?: string;
  defaultRuntimePresetEnabled?: boolean;
  defaultShmSize?: string;
  defaultGpuCount?: number;
  capabilities: CapabilityFlags;
  createdAt?: string;
  updatedAt?: string;
};

export type BuildAdmin = {
  id: string;
  recipeId: string;
  baseModelImageId?: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  logs?: string;
  resolvedBaseImage?: string;
  resultImage?: string;
  pushedImage?: string;
  immutableTag?: string;
  stableTag?: string;
  dockerHubRepo?: string;
  digest?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  publishedRuntimePresetId?: string | null;
};

export type RuntimePresetAdmin = {
  id: string;
  title: string;
  family?: string;
  description?: string;
  logicalBaseModelId: string;
  baseModelImageId?: string | null;
  sourceBuildId?: string | null;
  trainerImage: string;
  modelLocalPath: string;
  defaultShmSize: string;
  defaultGpuCount: number;
  supports: CapabilityFlags;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type BuildStartPayload = {
  recipeId: string;
  baseModelImageId?: string;
  baseImageOverride?: string;
  buildArgs?: Record<string, string>;
  pushEnabled?: boolean;
};

function normalizeSupports(input: any): CapabilityFlags {
  return {
    qlora: Boolean(input?.qlora ?? input?.supports_qlora ?? input?.supports?.qlora),
    lora: Boolean(input?.lora ?? input?.supports_lora ?? input?.supports?.lora),
    merge: Boolean(input?.merge ?? input?.supports_merge ?? input?.supports?.merge),
    evaluation: Boolean(input?.evaluation ?? input?.supports_evaluation ?? input?.supports?.evaluation),
  };
}

export function normalizeBaseModelImage(item: any): BaseModelImageAdmin {
  return {
    id: String(item.id),
    title: item.title || item.name || item.slug || 'Untitled base image',
    slug: item.slug || undefined,
    description: item.description || '',
    family: item.family || '',
    logicalBaseModelId: item.logicalBaseModelId || item.logical_base_model_id || '',
    dockerImage: item.dockerImage || item.docker_image || '',
    dockerRegistry: item.dockerRegistry || item.docker_registry || '',
    dockerRepository: item.dockerRepository || item.docker_repository || '',
    dockerTag: item.dockerTag || item.docker_tag || '',
    modelLocalPath: item.modelLocalPath || item.model_local_path || '/app',
    defaultShmSize: item.defaultShmSize || item.default_shm_size || '16g',
    defaultGpuCount: Number(item.defaultGpuCount ?? item.default_gpu_count ?? 1),
    cudaNotes: item.cudaNotes || item.cuda_notes || '',
    memoryNotes: item.memoryNotes || item.memory_notes || '',
    notes: item.notes || '',
    supports: normalizeSupports(item),
    enabled: item.enabled !== false,
    archived: Boolean(item.archived),
    sortOrder: Number(item.sortOrder ?? item.sort_order ?? 0),
    createdAt: item.createdAt || item.created_at,
    updatedAt: item.updatedAt || item.updated_at,
  };
}

export function normalizeRecipe(item: any): RecipeAdmin {
  return {
    id: String(item.id),
    name: item.name || 'Untitled recipe',
    description: item.description || '',
    enabled: item.enabled !== false,
    baseModelImageId: item.baseModelImageId || item.base_model_image_id || null,
    baseImageOverride: item.baseImageOverride || item.base_image_override || '',
    trainerContextPath: item.trainerContextPath || item.trainer_context_path || '.',
    dockerfilePath: item.dockerfilePath || item.dockerfile_path || 'Dockerfile',
    buildArgs: item.buildArgs || item.build_args || {},
    targetRegistry: item.targetRegistry || item.target_registry || 'docker.io',
    targetRepository: item.targetRepository || item.target_repository || '',
    targetTagTemplate: item.targetTagTemplate || item.target_tag_template || '{{slug}}-{{timestamp}}',
    stableTag: item.stableTag || item.stable_tag || 'latest',
    pushEnabled: Boolean(item.pushEnabled ?? item.push_enabled ?? true),
    defaultRuntimePresetTitle:
      item.defaultRuntimePresetTitle || item.default_runtime_preset_title || '',
    defaultRuntimePresetDescription:
      item.defaultRuntimePresetDescription || item.default_runtime_preset_description || '',
    defaultRuntimePresetEnabled: Boolean(
      item.defaultRuntimePresetEnabled ?? item.default_runtime_preset_enabled ?? true,
    ),
    defaultShmSize: item.defaultShmSize || item.default_shm_size || '16g',
    defaultGpuCount: Number(item.defaultGpuCount ?? item.default_gpu_count ?? 1),
    capabilities: normalizeSupports(item.capabilities || item),
    createdAt: item.createdAt || item.created_at,
    updatedAt: item.updatedAt || item.updated_at,
  };
}

export function normalizeBuild(item: any): BuildAdmin {
  return {
    id: String(item.id),
    recipeId: String(item.recipeId || item.recipe_id || ''),
    baseModelImageId: item.baseModelImageId || item.base_model_image_id || null,
    status: item.status || 'queued',
    logs: item.logs || '',
    resolvedBaseImage: item.resolvedBaseImage || item.resolved_base_image || '',
    resultImage: item.resultImage || item.result_image || '',
    pushedImage: item.pushedImage || item.pushed_image || '',
    immutableTag: item.immutableTag || item.immutable_tag || '',
    stableTag: item.stableTag || item.stable_tag || '',
    dockerHubRepo: item.dockerHubRepo || item.docker_hub_repo || '',
    digest: item.digest || '',
    startedAt: item.startedAt || item.started_at,
    finishedAt: item.finishedAt || item.finished_at,
    error: item.error || '',
    publishedRuntimePresetId: item.publishedRuntimePresetId || item.published_runtime_preset_id || null,
  };
}

export function normalizeRuntimePreset(item: any): RuntimePresetAdmin {
  return {
    id: String(item.id),
    title: item.title || 'Untitled preset',
    family: item.family || '',
    description: item.description || '',
    logicalBaseModelId: item.logicalBaseModelId || item.logical_base_model_id || '',
    baseModelImageId: item.baseModelImageId || item.base_model_image_id || null,
    sourceBuildId: item.sourceBuildId || item.source_build_id || null,
    trainerImage: item.trainerImage || item.trainer_image || '',
    modelLocalPath: item.modelLocalPath || item.model_local_path || item.localModelPath || item.local_model_path || '/app',
    defaultShmSize: item.defaultShmSize || item.default_shm_size || '16g',
    defaultGpuCount: Number(item.defaultGpuCount ?? item.default_gpu_count ?? item.gpuCount ?? 1),
    supports: normalizeSupports(item.supports || item),
    enabled: item.enabled !== false,
    createdAt: item.createdAt || item.created_at,
    updatedAt: item.updatedAt || item.updated_at,
  };
}

export const adminApi = {
  async getBaseModels() {
    const data = await adminRequest<any>('/infrastructure/base-models');
    return asArray<any>(data).map(normalizeBaseModelImage);
  },
  createBaseModel: (payload: Partial<BaseModelImageAdmin>) =>
    adminRequest<BaseModelImageAdmin>('/infrastructure/base-models', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then(normalizeBaseModelImage),
  updateBaseModel: (id: string, payload: Partial<BaseModelImageAdmin>) =>
    adminRequest<BaseModelImageAdmin>(`/infrastructure/base-models/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }).then(normalizeBaseModelImage),
  deleteBaseModel: (id: string) =>
    adminRequest<{ ok: boolean }>(`/infrastructure/base-models/${id}`, {
      method: 'DELETE',
    }),

  async getRecipes() {
    const data = await adminRequest<any>('/infrastructure/recipes');
    return asArray<any>(data).map(normalizeRecipe);
  },
  createRecipe: (payload: Partial<RecipeAdmin>) =>
    adminRequest<RecipeAdmin>('/infrastructure/recipes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then(normalizeRecipe),
  updateRecipe: (id: string, payload: Partial<RecipeAdmin>) =>
    adminRequest<RecipeAdmin>(`/infrastructure/recipes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }).then(normalizeRecipe),
  deleteRecipe: (id: string) =>
    adminRequest<{ ok: boolean }>(`/infrastructure/recipes/${id}`, {
      method: 'DELETE',
    }),

  async getBuilds() {
    const data = await adminRequest<any>('/infrastructure/builds');
    return asArray<any>(data).map(normalizeBuild);
  },
  startBuild: (payload: BuildStartPayload) =>
    adminRequest<BuildAdmin>('/infrastructure/builds', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then(normalizeBuild),
  getBuildLogs: (id: string) =>
    adminRequest<{ logFile?: string; content: string }>(`/infrastructure/builds/${id}/logs`),
  publishRuntimePreset: (buildId: string) =>
    adminRequest<RuntimePresetAdmin>(`/infrastructure/builds/${buildId}/publish`, {
      method: 'POST',
    }).then(normalizeRuntimePreset),

  async getRuntimePresets() {
    try {
      const data = await adminRequest<any>('/infrastructure/runtime-presets');
      return asArray<any>(data).map(normalizeRuntimePreset);
    } catch {
      const data = await api.getRuntimePresets();
      return asArray<any>(data).map(normalizeRuntimePreset);
    }
  },
  updateRuntimePreset: (id: string, payload: Partial<RuntimePresetAdmin>) =>
    adminRequest<RuntimePresetAdmin>(`/infrastructure/runtime-presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }).then(normalizeRuntimePreset),
  deleteRuntimePreset: (id: string) =>
    adminRequest<{ ok: boolean }>(`/infrastructure/runtime-presets/${id}`, {
      method: 'DELETE',
    }),
};

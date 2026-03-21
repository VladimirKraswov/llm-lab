import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, ExternalLink, Hammer, Image, Layers, LucideIcon, PackageCheck, Play, Plus, Save, Settings2, Wrench } from 'lucide-react';
import { api, type AgentBuild, type AgentBuildRecipe, type BaseModelImage, type RuntimePreset } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select } from '../../components/ui/select';
import { CopyButton } from '../../components/copy-button';

type TabId = 'baseImages' | 'recipes' | 'builds' | 'presets';

const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'baseImages', label: 'Base model images', icon: Image },
  { id: 'recipes', label: 'Build recipes', icon: Wrench },
  { id: 'builds', label: 'Builds', icon: Hammer },
  { id: 'presets', label: 'Runtime presets', icon: PackageCheck },
];

type BaseModelForm = {
  id?: string;
  title: string;
  description: string;
  family: string;
  logicalBaseModelId: string;
  dockerImage: string;
  modelLocalPath: string;
  defaultShmSize: string;
  defaultGpuCount: string;
  cudaNotes: string;
  memoryNotes: string;
  enabled: boolean;
  supportsQlorA: boolean;
  supportsLora: boolean;
  supportsMerge: boolean;
  supportsEvaluation: boolean;
};

type RecipeForm = {
  id?: string;
  name: string;
  description: string;
  baseModelImageId: string;
  baseImageOverride: string;
  trainerContextPath: string;
  dockerfilePath: string;
  targetRegistry: string;
  targetRepository: string;
  targetTagTemplate: string;
  stableTag: string;
  defaultRuntimePresetTitle: string;
  defaultRuntimePresetDescription: string;
  defaultShmSize: string;
  defaultGpuCount: string;
  enabled: boolean;
  pushEnabled: boolean;
};

function emptyBaseModelForm(): BaseModelForm {
  return {
    title: '',
    description: '',
    family: '',
    logicalBaseModelId: '',
    dockerImage: '',
    modelLocalPath: '/app',
    defaultShmSize: '16g',
    defaultGpuCount: '1',
    cudaNotes: '',
    memoryNotes: '',
    enabled: true,
    supportsQlorA: true,
    supportsLora: true,
    supportsMerge: true,
    supportsEvaluation: true,
  };
}

function emptyRecipeForm(): RecipeForm {
  return {
    name: '',
    description: '',
    baseModelImageId: '',
    baseImageOverride: '',
    trainerContextPath: './trainer-agent',
    dockerfilePath: './trainer-agent/Dockerfile',
    targetRegistry: 'docker.io',
    targetRepository: '',
    targetTagTemplate: '{slug}-r{date}-{build}',
    stableTag: 'latest',
    defaultRuntimePresetTitle: '',
    defaultRuntimePresetDescription: '',
    defaultShmSize: '16g',
    defaultGpuCount: '1',
    enabled: true,
    pushEnabled: true,
  };
}

function normalizeBaseModel(item: BaseModelImage | undefined | null) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title,
    description: item.description || '',
    family: item.family || '',
    logicalBaseModelId: item.logicalBaseModelId || item.logical_base_model_id || '',
    dockerImage: item.dockerImage || item.docker_image || '',
    modelLocalPath: item.modelLocalPath || item.model_local_path || '/app',
    defaultShmSize: item.defaultShmSize || item.default_shm_size || '16g',
    defaultGpuCount: String(item.defaultGpuCount ?? item.default_gpu_count ?? 1),
    cudaNotes: item.cudaNotes || '',
    memoryNotes: item.memoryNotes || item.notes || '',
    enabled: item.enabled !== false,
    supportsQlorA: item.supports?.qlora ?? item.supports_qlora ?? true,
    supportsLora: item.supports?.lora ?? item.supports_lora ?? true,
    supportsMerge: item.supports?.merge ?? item.supports_merge ?? true,
    supportsEvaluation: item.supports?.evaluation ?? item.supports_evaluation ?? true,
  } satisfies BaseModelForm;
}

function normalizeRecipe(item: AgentBuildRecipe | undefined | null) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    description: item.description || '',
    baseModelImageId: item.baseModelImageId || item.base_model_image_id || '',
    baseImageOverride: item.baseImageOverride || item.base_image_override || '',
    trainerContextPath: item.trainerContextPath || item.trainer_context_path || './trainer-agent',
    dockerfilePath: item.dockerfilePath || item.dockerfile_path || './trainer-agent/Dockerfile',
    targetRegistry: item.targetRegistry || item.target_registry || 'docker.io',
    targetRepository: item.targetRepository || item.target_repository || '',
    targetTagTemplate: item.targetTagTemplate || item.target_tag_template || '{slug}-r{date}-{build}',
    stableTag: item.stableTag || item.stable_tag || 'latest',
    defaultRuntimePresetTitle: item.defaultRuntimePresetTitle || item.default_runtime_preset_title || '',
    defaultRuntimePresetDescription: item.defaultRuntimePresetDescription || item.default_runtime_preset_description || '',
    defaultShmSize: item.defaultShmSize || item.default_shm_size || '16g',
    defaultGpuCount: String(item.defaultGpuCount ?? item.default_gpu_count ?? 1),
    enabled: item.enabled !== false,
    pushEnabled: item.pushEnabled ?? item.push_enabled ?? true,
  } satisfies RecipeForm;
}

function normalizePreset(item: RuntimePreset | undefined | null) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title,
    description: item.description || '',
    family: item.family || '',
    logicalBaseModelId: item.logicalBaseModelId,
    trainerImage: item.trainerImage,
    modelLocalPath: item.modelLocalPath,
    defaultShmSize: item.defaultShmSize,
    gpuCount: item.gpuCount,
    enabled: item.enabled,
  };
}

export default function InfrastructurePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('baseImages');
  const [baseModelForm, setBaseModelForm] = useState<BaseModelForm>(emptyBaseModelForm());
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(emptyRecipeForm());
  const [selectedBuildId, setSelectedBuildId] = useState<string>('');

  const baseModelsQuery = useQuery({ queryKey: ['base-models'], queryFn: api.getBaseModels });
  const recipesQuery = useQuery({ queryKey: ['recipes'], queryFn: api.getRecipes });
  const buildsQuery = useQuery({ queryKey: ['builds'], queryFn: api.getBuilds, refetchInterval: 5000 });
  const presetsQuery = useQuery({ queryKey: ['runtime-presets'], queryFn: api.getRuntimePresets });
  const buildLogsQuery = useQuery({
    queryKey: ['build-logs', selectedBuildId],
    queryFn: () => api.getBuildLogs(selectedBuildId),
    enabled: !!selectedBuildId,
    refetchInterval: selectedBuildId ? 4000 : false,
  });

  const baseModels = useMemo(() => (Array.isArray(baseModelsQuery.data) ? baseModelsQuery.data : []), [baseModelsQuery.data]);
  const recipes = useMemo(() => (Array.isArray(recipesQuery.data) ? recipesQuery.data : []), [recipesQuery.data]);
  const builds = useMemo(() => (Array.isArray(buildsQuery.data) ? buildsQuery.data : []), [buildsQuery.data]);
  const presets = useMemo(() => (Array.isArray(presetsQuery.data) ? presetsQuery.data : []), [presetsQuery.data]);

  const saveBaseModelMutation = useMutation({
    mutationFn: (payload: BaseModelForm) => {
      const body = {
        title: payload.title,
        description: payload.description,
        family: payload.family,
        logicalBaseModelId: payload.logicalBaseModelId,
        dockerImage: payload.dockerImage,
        modelLocalPath: payload.modelLocalPath,
        defaultShmSize: payload.defaultShmSize,
        defaultGpuCount: Number(payload.defaultGpuCount),
        cudaNotes: payload.cudaNotes,
        memoryNotes: payload.memoryNotes,
        enabled: payload.enabled,
        supports: {
          qlora: payload.supportsQlorA,
          lora: payload.supportsLora,
          merge: payload.supportsMerge,
          evaluation: payload.supportsEvaluation,
        },
      };
      return payload.id ? api.updateBaseModel(payload.id, body) : api.createBaseModel(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['base-models'] });
      setBaseModelForm(emptyBaseModelForm());
    },
  });

  const deleteBaseModelMutation = useMutation({
    mutationFn: api.deleteBaseModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['base-models'] }),
  });

  const saveRecipeMutation = useMutation({
    mutationFn: (payload: RecipeForm) => {
      const body = {
        name: payload.name,
        description: payload.description,
        baseModelImageId: payload.baseModelImageId,
        baseImageOverride: payload.baseImageOverride || undefined,
        trainerContextPath: payload.trainerContextPath,
        dockerfilePath: payload.dockerfilePath,
        targetRegistry: payload.targetRegistry,
        targetRepository: payload.targetRepository,
        targetTagTemplate: payload.targetTagTemplate,
        stableTag: payload.stableTag,
        defaultRuntimePresetTitle: payload.defaultRuntimePresetTitle,
        defaultRuntimePresetDescription: payload.defaultRuntimePresetDescription,
        defaultShmSize: payload.defaultShmSize,
        defaultGpuCount: Number(payload.defaultGpuCount),
        enabled: payload.enabled,
        pushEnabled: payload.pushEnabled,
      };
      return payload.id ? api.updateRecipe(payload.id, body) : api.createRecipe(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setRecipeForm(emptyRecipeForm());
    },
  });

  const deleteRecipeMutation = useMutation({
    mutationFn: api.deleteRecipe,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recipes'] }),
  });

  const startBuildMutation = useMutation({
    mutationFn: api.startBuild,
    onSuccess: (build) => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setSelectedBuildId(build.id);
      setTab('builds');
    },
  });

  const publishPresetMutation = useMutation({
    mutationFn: api.publishRuntimePreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-presets'] });
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setTab('presets');
    },
  });

  const updatePresetMutation = useMutation({
    mutationFn: ({ id, enabled, title, description }: { id: string; enabled: boolean; title: string; description: string }) => api.updateRuntimePreset(id, { enabled, title, description }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runtime-presets'] }),
  });

  useEffect(() => {
    if (!selectedBuildId && builds[0]?.id) setSelectedBuildId(builds[0].id);
  }, [builds, selectedBuildId]);

  const selectedBuild = builds.find((item) => item.id === selectedBuildId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Infrastructure"
        description="Catalog of baked base model images, trainer build recipes, runnable trainer image builds and publishable runtime presets."
      />

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={tab === id ? 'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white' : 'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white'}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'baseImages' ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Base model image catalog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {baseModels.length ? (
                baseModels.map((item) => {
                  const normalized = normalizeBaseModel(item);
                  if (!normalized) return null;
                  return (
                    <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-white">{normalized.title}</div>
                            <div className={normalized.enabled ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300' : 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500'}>
                              {normalized.enabled ? 'enabled' : 'disabled'}
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">{normalized.family} · {normalized.logicalBaseModelId}</div>
                          <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-slate-300">
                            <span className="truncate">{normalized.dockerImage}</span>
                            <CopyButton text={normalized.dockerImage} className="h-5 w-5 px-1 py-0.5" />
                          </div>
                          <div className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-3">
                            <div>local path: {normalized.modelLocalPath}</div>
                            <div>shm: {normalized.defaultShmSize}</div>
                            <div>gpu: {normalized.defaultGpuCount}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => setBaseModelForm(normalized)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deleteBaseModelMutation.mutate(item.id)}>
                            Archive
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-sm text-slate-500">No base model images yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{baseModelForm.id ? 'Edit base model image' : 'New base model image'}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setBaseModelForm(emptyBaseModelForm())}>
                <Plus size={14} className="mr-1.5" />
                Reset
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">title</label>
                  <Input value={baseModelForm.title} onChange={(event) => setBaseModelForm((current) => ({ ...current, title: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">family</label>
                  <Input value={baseModelForm.family} onChange={(event) => setBaseModelForm((current) => ({ ...current, family: event.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">description</label>
                  <Textarea value={baseModelForm.description} onChange={(event) => setBaseModelForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[84px]" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">logical base model id</label>
                  <Input value={baseModelForm.logicalBaseModelId} onChange={(event) => setBaseModelForm((current) => ({ ...current, logicalBaseModelId: event.target.value }))} placeholder="Qwen/Qwen2.5-7B-Instruct" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">docker image</label>
                  <Input value={baseModelForm.dockerImage} onChange={(event) => setBaseModelForm((current) => ({ ...current, dockerImage: event.target.value }))} placeholder="igortet/model-qwen-7b" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">model local path</label>
                  <Input value={baseModelForm.modelLocalPath} onChange={(event) => setBaseModelForm((current) => ({ ...current, modelLocalPath: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">default shm size</label>
                  <Input value={baseModelForm.defaultShmSize} onChange={(event) => setBaseModelForm((current) => ({ ...current, defaultShmSize: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">default gpu count</label>
                  <Input value={baseModelForm.defaultGpuCount} onChange={(event) => setBaseModelForm((current) => ({ ...current, defaultGpuCount: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">cuda notes</label>
                  <Input value={baseModelForm.cudaNotes} onChange={(event) => setBaseModelForm((current) => ({ ...current, cudaNotes: event.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">memory / operator notes</label>
                  <Textarea value={baseModelForm.memoryNotes} onChange={(event) => setBaseModelForm((current) => ({ ...current, memoryNotes: event.target.value }))} className="min-h-[84px]" />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={baseModelForm.enabled} onChange={(event) => setBaseModelForm((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />enabled</label>
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={baseModelForm.supportsQlorA} onChange={(event) => setBaseModelForm((current) => ({ ...current, supportsQlorA: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />supports.qlora</label>
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={baseModelForm.supportsLora} onChange={(event) => setBaseModelForm((current) => ({ ...current, supportsLora: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />supports.lora</label>
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={baseModelForm.supportsMerge} onChange={(event) => setBaseModelForm((current) => ({ ...current, supportsMerge: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />supports.merge</label>
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={baseModelForm.supportsEvaluation} onChange={(event) => setBaseModelForm((current) => ({ ...current, supportsEvaluation: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />supports.evaluation</label>
              </div>

              <Button onClick={() => saveBaseModelMutation.mutate(baseModelForm)} disabled={saveBaseModelMutation.isPending || !baseModelForm.title || !baseModelForm.logicalBaseModelId || !baseModelForm.dockerImage}>
                <Save size={14} className="mr-1.5" />
                {saveBaseModelMutation.isPending ? 'Saving…' : 'Save base model image'}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'recipes' ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader>
              <CardTitle>Trainer build recipes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recipes.length ? recipes.map((item) => {
                const normalized = normalizeRecipe(item);
                if (!normalized) return null;
                const linkedBaseModel = baseModels.find((baseModel) => baseModel.id === normalized.baseModelImageId);
                const resolvedBaseImage = normalizeBaseModel(linkedBaseModel)?.dockerImage || normalized.baseImageOverride || '—';
                return (
                  <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-white">{normalized.name}</div>
                          <div className={normalized.enabled ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300' : 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500'}>
                            {normalized.enabled ? 'enabled' : 'disabled'}
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">{linkedBaseModel ? normalizeBaseModel(linkedBaseModel)?.title : 'base image override'} · {resolvedBaseImage}</div>
                        <div className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-2">
                          <div>context: {normalized.trainerContextPath}</div>
                          <div>dockerfile: {normalized.dockerfilePath}</div>
                          <div>repo: {normalized.targetRepository}</div>
                          <div>tag template: {normalized.targetTagTemplate}</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setRecipeForm(normalized)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => startBuildMutation.mutate(item.id)} disabled={startBuildMutation.isPending}>
                          <Play size={14} className="mr-1.5" />
                          Build
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => deleteRecipeMutation.mutate(item.id)}>
                          Archive
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }) : <div className="rounded-xl border border-dashed border-slate-800 p-6 text-sm text-slate-500">No recipes yet.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{recipeForm.id ? 'Edit recipe' : 'New recipe'}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setRecipeForm(emptyRecipeForm())}>
                <Plus size={14} className="mr-1.5" />Reset
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">name</label>
                  <Input value={recipeForm.name} onChange={(event) => setRecipeForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">base model image</label>
                  <Select
                    value={recipeForm.baseModelImageId}
                    onChange={(event) => {
                      const baseModel = normalizeBaseModel(baseModels.find((item) => item.id === event.target.value));
                      setRecipeForm((current) => ({
                        ...current,
                        baseModelImageId: event.target.value,
                        baseImageOverride: baseModel?.dockerImage || current.baseImageOverride,
                        defaultRuntimePresetTitle: current.defaultRuntimePresetTitle || baseModel?.title || '',
                        defaultShmSize: baseModel?.defaultShmSize || current.defaultShmSize,
                        defaultGpuCount: baseModel?.defaultGpuCount || current.defaultGpuCount,
                      }));
                    }}
                  >
                    <option value="">Select base image</option>
                    {baseModels.map((baseModel) => (
                      <option key={baseModel.id} value={baseModel.id}>{normalizeBaseModel(baseModel)?.title}</option>
                    ))}
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">description</label>
                  <Textarea value={recipeForm.description} onChange={(event) => setRecipeForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[84px]" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">base image override</label>
                  <Input value={recipeForm.baseImageOverride} onChange={(event) => setRecipeForm((current) => ({ ...current, baseImageOverride: event.target.value }))} placeholder="optional legacy fallback" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">trainer context path</label>
                  <Input value={recipeForm.trainerContextPath} onChange={(event) => setRecipeForm((current) => ({ ...current, trainerContextPath: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">dockerfile path</label>
                  <Input value={recipeForm.dockerfilePath} onChange={(event) => setRecipeForm((current) => ({ ...current, dockerfilePath: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">target registry</label>
                  <Input value={recipeForm.targetRegistry} onChange={(event) => setRecipeForm((current) => ({ ...current, targetRegistry: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">target repository</label>
                  <Input value={recipeForm.targetRepository} onChange={(event) => setRecipeForm((current) => ({ ...current, targetRepository: event.target.value }))} placeholder="igortet/itk-ai-trainer-service" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">target tag template</label>
                  <Input value={recipeForm.targetTagTemplate} onChange={(event) => setRecipeForm((current) => ({ ...current, targetTagTemplate: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">stable tag</label>
                  <Input value={recipeForm.stableTag} onChange={(event) => setRecipeForm((current) => ({ ...current, stableTag: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">default runtime preset title</label>
                  <Input value={recipeForm.defaultRuntimePresetTitle} onChange={(event) => setRecipeForm((current) => ({ ...current, defaultRuntimePresetTitle: event.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">default runtime preset description</label>
                  <Textarea value={recipeForm.defaultRuntimePresetDescription} onChange={(event) => setRecipeForm((current) => ({ ...current, defaultRuntimePresetDescription: event.target.value }))} className="min-h-[84px]" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">default shm size</label>
                  <Input value={recipeForm.defaultShmSize} onChange={(event) => setRecipeForm((current) => ({ ...current, defaultShmSize: event.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-500">default gpu count</label>
                  <Input value={recipeForm.defaultGpuCount} onChange={(event) => setRecipeForm((current) => ({ ...current, defaultGpuCount: event.target.value }))} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={recipeForm.enabled} onChange={(event) => setRecipeForm((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />enabled</label>
                <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={recipeForm.pushEnabled} onChange={(event) => setRecipeForm((current) => ({ ...current, pushEnabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600" />push enabled</label>
              </div>
              <Button onClick={() => saveRecipeMutation.mutate(recipeForm)} disabled={saveRecipeMutation.isPending || !recipeForm.name || !recipeForm.targetRepository}>
                <Save size={14} className="mr-1.5" />
                {saveRecipeMutation.isPending ? 'Saving…' : 'Save recipe'}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'builds' ? (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader>
              <CardTitle>Runnable trainer builds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {builds.length ? builds.map((build) => {
                const recipeId = build.recipeId || build.recipe_id || '—';
                const resultImage = build.resultImage || build.result_image || '—';
                const publishedRuntimePresetId = build.publishedRuntimePresetId || build.published_runtime_preset_id;
                return (
                  <button key={build.id} onClick={() => setSelectedBuildId(build.id)} className={selectedBuildId === build.id ? 'w-full rounded-xl border border-blue-500 bg-blue-500/10 p-4 text-left' : 'w-full rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-left hover:border-slate-700'}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">Build {build.id}</div>
                        <div className="mt-1 text-[11px] text-slate-400">recipe: {recipeId}</div>
                        <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-slate-300">
                          <span className="truncate">{resultImage}</span>
                          {resultImage !== '—' ? <CopyButton text={resultImage} className="h-5 w-5 px-1 py-0.5" /> : null}
                        </div>
                      </div>
                      <div className={build.status === 'completed' ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300' : build.status === 'failed' ? 'rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] uppercase text-rose-300' : 'rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] uppercase text-blue-300'}>
                        {build.status}
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">started: {build.startedAt || build.started_at}</div>
                    {publishedRuntimePresetId ? <div className="mt-1 text-[11px] text-emerald-300">published preset: {publishedRuntimePresetId}</div> : null}
                  </button>
                );
              }) : <div className="rounded-xl border border-dashed border-slate-800 p-6 text-sm text-slate-500">No builds yet. Start one from recipe list.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Build details</CardTitle>
              {selectedBuild?.status === 'completed' && !(selectedBuild.publishedRuntimePresetId || selectedBuild.published_runtime_preset_id) ? (
                <Button size="sm" onClick={() => publishPresetMutation.mutate(selectedBuild.id)} disabled={publishPresetMutation.isPending}>
                  Publish runtime preset
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedBuild ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Resolved base image</div>
                      <div className="mt-1 break-all font-mono text-[11px] text-slate-300">{selectedBuild.resolvedBaseImage || selectedBuild.resolved_base_image || '—'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Result image</div>
                      <div className="mt-1 flex items-center gap-2 break-all font-mono text-[11px] text-slate-300">
                        <span>{selectedBuild.resultImage || selectedBuild.result_image || '—'}</span>
                        {selectedBuild.resultImage || selectedBuild.result_image ? <CopyButton text={selectedBuild.resultImage || selectedBuild.result_image || ''} className="h-5 w-5 px-1 py-0.5" /> : null}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Published image</div>
                      <div className="mt-1 break-all font-mono text-[11px] text-slate-300">{selectedBuild.pushedImage || selectedBuild.pushed_image || '—'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Digest / immutable tag</div>
                      <div className="mt-1 break-all font-mono text-[11px] text-slate-300">{selectedBuild.digest || selectedBuild.immutableTag || selectedBuild.immutable_tag || '—'}</div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Build logs</div>
                    <pre className="max-h-[480px] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-[11px] text-slate-300">{buildLogsQuery.data?.content || selectedBuild.logs || 'No logs yet.'}</pre>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-sm text-slate-500">Select build to inspect logs and publish runtime preset.</div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'presets' ? (
        <Card>
          <CardHeader>
            <CardTitle>Runtime presets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {presets.length ? presets.map((item) => {
              const preset = normalizePreset(item);
              if (!preset) return null;
              return (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-white">{preset.title}</div>
                        <div className={preset.enabled ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300' : 'rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500'}>
                          {preset.enabled ? 'enabled' : 'disabled'}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">{preset.family} · {preset.logicalBaseModelId}</div>
                      <div className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-3">
                        <div>image: {preset.trainerImage}</div>
                        <div>path: {preset.modelLocalPath}</div>
                        <div>shm/gpu: {preset.defaultShmSize} · {preset.gpuCount}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <CopyButton text={preset.trainerImage} className="h-8 px-2" showLabel>image</CopyButton>
                      <Button size="sm" variant="outline" onClick={() => updatePresetMutation.mutate({ id: preset.id, enabled: !preset.enabled, title: preset.title, description: preset.description })}>
                        {preset.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }) : <div className="rounded-xl border border-dashed border-slate-800 p-6 text-sm text-slate-500">No runtime presets yet. Publish one from completed build.</div>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

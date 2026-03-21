import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  FileCode2,
  Layers3,
  PackageCheck,
  Play,
  Plus,
  Server,
  Wrench,
} from 'lucide-react';
import { api, type AgentBuild, type AgentBuildRecipe, type BaseModelImage, type RuntimePreset } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';

type TabId = 'models' | 'recipes' | 'builds' | 'presets';

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
        active ? 'bg-slate-800 text-white ring-1 ring-slate-700' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function BuildStatus({ build }: { build: AgentBuild }) {
  if (build.status === 'completed') return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (build.status === 'running') return <Clock3 size={16} className="text-blue-400 animate-pulse" />;
  return <AlertCircle size={16} className="text-rose-400" />;
}

export default function InfrastructurePage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<TabId>('models');

  const { data: baseModels = [], isLoading: loadingModels } = useQuery({
    queryKey: ['base-models'],
    queryFn: api.getBaseModels,
  });

  const { data: recipes = [], isLoading: loadingRecipes } = useQuery({
    queryKey: ['recipes'],
    queryFn: api.getRecipes,
  });

  const { data: builds = [], isLoading: loadingBuilds } = useQuery({
    queryKey: ['builds'],
    queryFn: api.getBuilds,
    refetchInterval: 5000,
  });

  const { data: presets = [], isLoading: loadingPresets } = useQuery({
    queryKey: ['runtime-presets'],
    queryFn: api.getRuntimePresets,
  });

  const startBuildMutation = useMutation({
    mutationFn: (recipeId: string) => api.startBuild(recipeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setActiveTab('builds');
    },
  });

  const publishPresetMutation = useMutation({
    mutationFn: (buildId: string) => api.publishRuntimePreset(buildId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-presets'] });
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setActiveTab('presets');
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Infrastructure"
        description="Operator-facing catalog for base model images, trainer build recipes, published runtime images, and runtime presets."
        actions={
          <div className="flex items-center gap-2">
            <TabButton active={activeTab === 'models'} onClick={() => setActiveTab('models')}>Base models</TabButton>
            <TabButton active={activeTab === 'recipes'} onClick={() => setActiveTab('recipes')}>Recipes</TabButton>
            <TabButton active={activeTab === 'builds'} onClick={() => setActiveTab('builds')}>Builds</TabButton>
            <TabButton active={activeTab === 'presets'} onClick={() => setActiveTab('presets')}>Runtime presets</TabButton>
          </div>
        }
      />

      {activeTab === 'models' ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {loadingModels ? <div className="text-sm text-slate-500">Loading base models…</div> : null}
          {baseModels.map((model: BaseModelImage) => (
            <Card key={model.id} className="bg-slate-900/60">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="truncate">{model.title}</span>
                  <span className={`rounded px-2 py-1 text-[10px] uppercase tracking-wide ${model.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                    {model.enabled ? 'enabled' : 'disabled'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg bg-slate-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">logical base model</div>
                  <div className="mt-1 text-white">{model.logical_base_model_id}</div>
                </div>
                <div className="rounded-lg bg-slate-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">docker image</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-300">{model.docker_image}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">local path</div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-300">{model.model_local_path}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">defaults</div>
                    <div className="mt-1 text-slate-300">{model.default_gpu_count} GPU · {model.default_shm_size} SHM</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide">
                  <span className={`rounded px-2 py-1 ${model.supports_qlora ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-800 text-slate-500'}`}>qlora</span>
                  <span className={`rounded px-2 py-1 ${model.supports_lora ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-800 text-slate-500'}`}>lora</span>
                  <span className={`rounded px-2 py-1 ${model.supports_merge ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-800 text-slate-500'}`}>merge</span>
                  <span className={`rounded px-2 py-1 ${model.supports_evaluation ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-800 text-slate-500'}`}>evaluation</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {activeTab === 'recipes' ? (
        <div className="space-y-4">
          {loadingRecipes ? <div className="text-sm text-slate-500">Loading recipes…</div> : null}
          {recipes.map((recipe: AgentBuildRecipe) => (
            <Card key={recipe.id} className="bg-slate-900/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Wrench size={16} className="text-blue-400" />
                  {recipe.name}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => startBuildMutation.mutate(recipe.id)} disabled={startBuildMutation.isPending}>
                    <Play size={14} className="mr-2" />
                    Build
                  </Button>
                  <Button size="sm" variant="outline">
                    <Plus size={14} className="mr-2" />
                    Edit later
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4 text-sm">
                <div className="rounded-lg bg-slate-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">base model image</div>
                  <div className="mt-1 break-all text-white">{recipe.base_model_image_id}</div>
                </div>
                <div className="rounded-lg bg-slate-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">repository</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-300">{recipe.target_repository}</div>
                </div>
                <div className="rounded-lg bg-slate-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">tag template</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-300">{recipe.target_tag_template}</div>
                </div>
                <div className="rounded-lg bg-slate-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">push</div>
                  <div className="mt-1 text-white">{recipe.push_enabled ? 'Enabled' : 'Disabled'}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {activeTab === 'builds' ? (
        <div className="space-y-4">
          {loadingBuilds ? <div className="text-sm text-slate-500">Loading builds…</div> : null}
          {builds.map((build: AgentBuild) => (
            <Card key={build.id} className="bg-slate-900/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <BuildStatus build={build} />
                  Build {build.id}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {build.status === 'completed' && !build.published_runtime_preset_id ? (
                    <Button size="sm" onClick={() => publishPresetMutation.mutate(build.id)} disabled={publishPresetMutation.isPending}>
                      <PackageCheck size={14} className="mr-2" />
                      Publish preset
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline">
                    <FileCode2 size={14} className="mr-2" />
                    Logs later
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">recipe</div>
                    <div className="mt-1 text-white">{build.recipe_id}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">started</div>
                    <div className="mt-1 text-white">{new Date(build.started_at).toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">finished</div>
                    <div className="mt-1 text-white">{build.finished_at ? new Date(build.finished_at).toLocaleString() : '—'}</div>
                  </div>
                </div>
                {build.result_image ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">result image</div>
                        <div className="mt-1 break-all font-mono text-xs text-slate-300">{build.result_image}</div>
                      </div>
                      <ExternalLink size={14} className="shrink-0 text-slate-500" />
                    </div>
                  </div>
                ) : null}
                {build.error ? (
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">{build.error}</div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {activeTab === 'presets' ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {loadingPresets ? <div className="text-sm text-slate-500">Loading runtime presets…</div> : null}
          {presets.map((preset: RuntimePreset) => {
            const capabilities = [
              preset.supports?.qlora ? 'QLoRA' : null,
              preset.supports?.lora ? 'LoRA' : null,
              preset.supports?.merge ? 'Merge' : null,
              preset.supports?.evaluation ? 'Evaluation' : null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <Card key={preset.id} className="bg-slate-900/60">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span className="truncate">{preset.title}</span>
                    <span className={`rounded px-2 py-1 text-[10px] uppercase tracking-wide ${preset.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                      {preset.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">family</div>
                    <div className="mt-1 text-white">{preset.family}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">logical base model</div>
                    <div className="mt-1 text-white">{preset.logicalBaseModelId}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">trainer image</div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-300">{preset.trainerImage}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-950/50 p-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">local model path</div>
                      <div className="mt-1 break-all font-mono text-xs text-slate-300">{preset.localModelPath}</div>
                    </div>
                    <div className="rounded-lg bg-slate-950/50 p-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">shm / gpu</div>
                      <div className="mt-1 text-white">{preset.defaultShmSize} · {preset.gpuCount} GPU</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-blue-500/20 bg-slate-950/50 p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-blue-400">capabilities</div>
                    <div className="text-xs text-slate-300">{capabilities || 'No declared capabilities'}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

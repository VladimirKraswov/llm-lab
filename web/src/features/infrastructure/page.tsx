import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type BaseModelImage, type AgentBuildRecipe, type AgentBuild } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  Plus,
  Settings as SettingsIcon,
  Play,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
  FileCode,
  Zap,
  ExternalLink
} from 'lucide-react';

export default function InfrastructurePage() {
  const [activeTab, setActiveTab] = React.useState<'models' | 'recipes' | 'builds'>('models');
  const queryClient = useQueryClient();

  const { data: baseModels = [], isLoading: loadingModels } = useQuery({
    queryKey: ['base-models'],
    queryFn: () => api.getBaseModels()
  });

  const { data: recipes = [], isLoading: loadingRecipes } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => api.getRecipes()
  });

  const { data: builds = [], isLoading: loadingBuilds } = useQuery({
    queryKey: ['builds'],
    queryFn: () => api.getBuilds()
  });

  const startBuildMutation = useMutation({
    mutationFn: (recipeId: string) => api.startBuild(recipeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setActiveTab('builds');
    }
  });

  const publishPresetMutation = useMutation({
    mutationFn: (buildId: string) => api.publishRuntimePreset(buildId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-presets'] });
      alert('Runtime preset published successfully!');
    }
  });

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white">
      <div className="flex items-center justify-between p-6 border-b border-white/5 bg-[#0f0f0f]">
        <div>
          <h1 className="text-xl font-semibold">Infrastructure</h1>
          <p className="text-sm text-white/40">Manage base models, agent build recipes, and trainer images.</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'models' && <Button size="sm"><Plus className="w-4 h-4 mr-2" /> Add Base Model</Button>}
          {activeTab === 'recipes' && <Button size="sm"><Plus className="w-4 h-4 mr-2" /> Create Recipe</Button>}
        </div>
      </div>

      <div className="flex border-b border-white/5 bg-[#0f0f0f] px-6">
        <button
          onClick={() => setActiveTab('models')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'models' ? 'border-blue-500 text-blue-500' : 'border-transparent text-white/40 hover:text-white/60'}`}
        >
          Base Models
        </button>
        <button
          onClick={() => setActiveTab('recipes')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'recipes' ? 'border-blue-500 text-blue-500' : 'border-transparent text-white/40 hover:text-white/60'}`}
        >
          Build Recipes
        </button>
        <button
          onClick={() => setActiveTab('builds')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'builds' ? 'border-blue-500 text-blue-500' : 'border-transparent text-white/40 hover:text-white/60'}`}
        >
          Agent Builds
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'models' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loadingModels ? <p>Loading...</p> : baseModels.map((model: BaseModelImage) => (
              <Card key={model.id} className="bg-[#141414] border-white/5 p-4 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-white/90">{model.title}</h3>
                    <p className="text-xs text-white/40 font-mono mt-1">{model.logical_base_model_id}</p>
                  </div>
                  <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${model.enabled ? 'bg-green-500/10 text-green-500' : 'bg-white/5 text-white/40'}`}>
                    {model.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center text-xs text-white/60">
                    <Database className="w-3.5 h-3.5 mr-2 opacity-40" />
                    <span className="truncate">{model.docker_image}</span>
                  </div>
                  <div className="flex items-center text-xs text-white/60">
                    <FileCode className="w-3.5 h-3.5 mr-2 opacity-40" />
                    <span>Path: {model.model_local_path}</span>
                  </div>
                  <div className="flex items-center text-xs text-white/60">
                    <Zap className="w-3.5 h-3.5 mr-2 opacity-40" />
                    <span>{model.default_gpu_count} GPU / {model.default_shm_size} SHM</span>
                  </div>
                </div>
                <div className="pt-2 flex gap-2">
                  <Button variant="outline" size="xs" className="flex-1">Edit</Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'recipes' && (
          <div className="grid grid-cols-1 gap-4">
            {loadingRecipes ? <p>Loading...</p> : recipes.map((recipe: AgentBuildRecipe) => (
              <Card key={recipe.id} className="bg-[#141414] border-white/5 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-blue-500/10 flex items-center justify-center text-blue-500">
                      <SettingsIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-medium text-white/90">{recipe.name}</h3>
                      <p className="text-xs text-white/40">{recipe.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-500"
                      onClick={() => startBuildMutation.mutate(recipe.id)}
                      disabled={startBuildMutation.isPending}
                    >
                      <Play className="w-3.5 h-3.5 mr-2 fill-current" /> Build Agent
                    </Button>
                    <Button variant="outline" size="sm">Edit</Button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs">
                  <div className="bg-white/5 p-2 rounded">
                    <div className="text-white/40 mb-1">Target Registry</div>
                    <div className="font-mono">{recipe.target_registry || 'Docker Hub'}</div>
                  </div>
                  <div className="bg-white/5 p-2 rounded">
                    <div className="text-white/40 mb-1">Repository</div>
                    <div className="font-mono">{recipe.target_repository}</div>
                  </div>
                  <div className="bg-white/5 p-2 rounded">
                    <div className="text-white/40 mb-1">Tag Template</div>
                    <div className="font-mono">{recipe.target_tag_template}</div>
                  </div>
                  <div className="bg-white/5 p-2 rounded">
                    <div className="text-white/40 mb-1">Push Enabled</div>
                    <div className={recipe.push_enabled ? 'text-green-500' : 'text-white/40'}>{recipe.push_enabled ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'builds' && (
          <div className="space-y-4">
            {loadingBuilds ? <p>Loading...</p> : builds.map((build: AgentBuild) => (
              <Card key={build.id} className="bg-[#141414] border-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center">
                      {build.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                      {build.status === 'running' && <Clock className="w-5 h-5 text-blue-500 animate-pulse" />}
                      {build.status === 'failed' && <AlertCircle className="w-5 h-5 text-red-500" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white/90">Build {build.id}</span>
                        <span className="text-[10px] text-white/40 font-mono">RECIPE: {build.recipe_id}</span>
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">
                        Started: {new Date(build.started_at).toLocaleString()}
                        {build.finished_at && ` • Finished: ${new Date(build.finished_at).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {build.status === 'completed' && !build.published_runtime_preset_id && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-500"
                        onClick={() => publishPresetMutation.mutate(build.id)}
                      >
                        Publish Preset
                      </Button>
                    )}
                    {build.published_runtime_preset_id && (
                      <div className="px-3 py-1.5 rounded bg-green-500/10 text-green-500 text-xs font-medium border border-green-500/20">
                        Published
                      </div>
                    )}
                    <Button variant="outline" size="sm">View Logs</Button>
                  </div>
                </div>
                {build.result_image && (
                  <div className="mt-4 p-2 bg-black rounded font-mono text-[10px] text-blue-400 flex items-center justify-between">
                    <span>{build.result_image}</span>
                    <ExternalLink className="w-3 h-3 cursor-pointer opacity-50 hover:opacity-100" />
                  </div>
                )}
                {build.error && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
                    {build.error}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

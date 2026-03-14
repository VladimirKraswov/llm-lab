import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/utils';
import { StatusBadge } from '../../components/status-badge';

export default function ModelsPage() {
  const qc = useQueryClient();
  const [repoId, setRepoId] = useState('Qwen/Qwen2.5-7B-Instruct');
  const [name, setName] = useState('Qwen 2.5 7B Instruct');

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: api.getModels,
    refetchInterval: 5000,
  });

  const downloadMutation = useMutation({
    mutationFn: api.downloadModel,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.activateModel(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['runtime'] });
      await qc.invalidateQueries({ queryKey: ['runtime-health'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteModel,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['models'] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models"
        description="База базовых моделей. Скачивай, удаляй и запускай их на инференс."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Hugging Face repo id</label>
              <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="Qwen/Qwen2.5-7B-Instruct" />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Display name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Qwen 2.5 7B Instruct" />
            </div>
          </div>
          <div className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">
            Сначала модель скачивается в локальную базу. После этого её можно использовать для обучения и инференса.
          </div>
          <Button
            onClick={() => downloadMutation.mutate({ repoId, name })}
            disabled={!repoId.trim() || downloadMutation.isPending}
          >
            {downloadMutation.isPending ? 'Starting download…' : 'Download model'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored models</CardTitle>
        </CardHeader>
        <CardContent>
          {!modelsQuery.data?.length ? (
            <div className="text-sm text-slate-500">No models yet.</div>
          ) : (
            <div className="space-y-3">
              {modelsQuery.data.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-base font-semibold text-white">{item.name}</div>
                      <div className="mt-1 text-sm text-slate-400">{item.repoId}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.path}</div>
                      <div className="mt-1 text-xs text-slate-500">Created: {fmtDate(item.createdAt)}</div>
                      {item.error ? <div className="mt-2 text-sm text-rose-300">{item.error}</div> : null}
                    </div>
                    <StatusBadge value={item.status === 'ready' ? 'healthy' : item.status} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() => activateMutation.mutate({ id: item.id })}
                      disabled={item.status !== 'ready' || activateMutation.isPending}
                    >
                      Use in runtime
                    </Button>
                    <Button
                      className="bg-rose-700 text-white hover:bg-rose-600"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api, apiBase } from '../../lib/api';
import { fmtDate } from '../../lib/utils';

export default function LorasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const lorasQuery = useQuery({
    queryKey: ['loras'],
    queryFn: api.getLoras,
    refetchInterval: 5000,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameLora(id, { name }),
    onSuccess: async () => {
      setEditingId(null);
      setEditingName('');
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.activateLora(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['runtime'] });
      await qc.invalidateQueries({ queryKey: ['runtime-health'] });
      navigate('/app/runtime');
    },
  });

  const buildMutation = useMutation({
    mutationFn: api.buildMergedLora,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const packageMutation = useMutation({
    mutationFn: api.packageLora,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteLora,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loras'] });
    },
  });

  const items = useMemo(() => lorasQuery.data || [], [lorasQuery.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="LoRAs"
        description="Список адаптеров, построение merged-модели, активация на инференс и упаковка для передачи."
      />

      <Card>
        <CardHeader>
          <CardTitle>Stored LoRAs</CardTitle>
        </CardHeader>
        <CardContent>
          {!items.length ? (
            <div className="text-sm text-slate-500">No LoRAs yet. После completed training они создаются автоматически.</div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      {editingId === item.id ? (
                        <div className="flex max-w-xl gap-2">
                          <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                          <Button onClick={() => renameMutation.mutate({ id: item.id, name: editingName })}>
                            Save
                          </Button>
                        </div>
                      ) : (
                        <div className="text-base font-semibold text-white">{item.name}</div>
                      )}

                      <div className="mt-1 text-sm text-slate-400">Base model: {item.baseModelName}</div>
                      <div className="mt-1 text-sm text-slate-400">Job: {item.jobId}</div>
                      <div className="mt-1 text-xs text-slate-500">Adapter: {item.adapterPath}</div>
                      <div className="mt-1 text-xs text-slate-500">Merged: {item.mergedPath || 'not built'}</div>
                      <div className="mt-1 text-xs text-slate-500">Package: {item.packagePath || 'not built'}</div>
                      <div className="mt-1 text-xs text-slate-500">Created: {fmtDate(item.createdAt)}</div>
                      {item.error ? <div className="mt-2 text-sm text-rose-300">{item.error}</div> : null}
                    </div>

                    <div className="text-right text-sm">
                      <div className="text-slate-400">Merge: <span className="text-white">{item.mergeStatus}</span></div>
                      <div className="text-slate-400">Package: <span className="text-white">{item.packageStatus}</span></div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      className="bg-slate-800 hover:bg-slate-700"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingName(item.name);
                      }}
                    >
                      Rename
                    </Button>

                    <Button
                      className="bg-slate-800 hover:bg-slate-700"
                      onClick={() => buildMutation.mutate(item.id)}
                      disabled={buildMutation.isPending}
                    >
                      Build merged
                    </Button>

                    <Button
                      onClick={() => activateMutation.mutate(item.id)}
                      disabled={activateMutation.isPending}
                    >
                      Use in runtime
                    </Button>

                    <Button
                      className="bg-emerald-700 text-white hover:bg-emerald-600"
                      onClick={() => packageMutation.mutate(item.id)}
                      disabled={packageMutation.isPending}
                    >
                      Package
                    </Button>

                    {item.packagePath ? (
                      <a
                        href={`${apiBase}/loras/${item.id}/package/download`}
                        className="inline-flex items-center justify-center rounded-xl bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600"
                      >
                        Download package
                      </a>
                    ) : null}

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
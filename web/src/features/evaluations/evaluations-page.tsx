import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ModelItem, type LoraItem, type EvalDataset } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select } from '../../components/ui/select';
import { Trash2, Play, Upload, Eye, CheckCircle, AlertCircle, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

type TargetInput = {
  type: 'model' | 'lora';
  id: string;
};

export default function EvaluationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [importName, setImportName] = useState('');
  const [importContent, setImportContent] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewDataset, setPreviewDataset] = useState<EvalDataset | null>(null);

  const [runName, setRunName] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [targets, setTargets] = useState<TargetInput[]>([{ type: 'model', id: '' }]);

  const datasetsQuery = useQuery({
    queryKey: ['eval-datasets'],
    queryFn: () => api.getEvalDatasets(),
  });

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: () => api.getModels(),
  });

  const lorasQuery = useQuery({
    queryKey: ['loras'],
    queryFn: () => api.getLoras(),
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.getJobs(),
  });

  const recentRuns = (jobsQuery.data || [])
    .filter(j => j.type === 'eval-benchmark')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const importMutation = useMutation({
    mutationFn: (payload: { name: string; content: string }) => api.importEvalDataset(payload),
    onSuccess: () => {
      toast.success('Dataset imported successfully');
      setImportName('');
      setImportContent('');
      queryClient.invalidateQueries({ queryKey: ['eval-datasets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteEvalDataset(id),
    onSuccess: () => {
      toast.success('Dataset deleted');
      queryClient.invalidateQueries({ queryKey: ['eval-datasets'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: (payload: { datasetId: string; targets: any[]; name?: string }) => api.runEvalBenchmark(payload),
    onSuccess: (res) => {
      toast.success('Benchmark started');
      navigate(`/jobs/${res.jobId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleImport = () => {
    if (!importName || !importContent) return;
    importMutation.mutate({ name: importName, content: importContent });
  };

  const handleAddTarget = () => {
    setTargets([...targets, { type: 'model', id: '' }]);
  };

  const handleRemoveTarget = (index: number) => {
    setTargets(targets.filter((_, i) => i !== index));
  };

  const handleTargetChange = (index: number, field: keyof TargetInput, value: string) => {
    const next = [...targets];
    next[index] = { ...next[index], [field]: value };
    setTargets(next);
  };

  const handleRun = () => {
    if (!selectedDatasetId || targets.some(t => !t.id)) {
      toast.error('Please select a dataset and all targets');
      return;
    }

    const resolvedTargets = targets.map(t => {
      if (t.type === 'model') {
        const m = modelsQuery.data?.find(x => x.id === t.id);
        return {
          id: t.id,
          type: 'model',
          label: m?.name || t.id,
          modelPath: m?.path || t.id
        };
      } else {
        const l = lorasQuery.data?.find(x => x.id === t.id);
        return {
          id: t.id,
          type: 'lora',
          label: l?.name || t.id,
          modelPath: l?.trainingBaseModelPath || l?.baseModelRef,
          loraPath: l?.adapterPath,
          loraName: l?.name
        };
      }
    });

    runMutation.mutate({
      datasetId: selectedDatasetId,
      targets: resolvedTargets,
      name: runName || undefined
    });
  };

  const showPreview = async (id: string) => {
    try {
      const ds = await api.getEvalDataset(id);
      setPreviewDataset(ds);
      setIsPreviewOpen(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-8">
      <PageHeader
        title="Evaluations"
        subtitle="Сравнение моделей-оценщиков на контрольных датасетах."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Import Section */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload size={18} /> Import Dataset
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Dataset Name"
              value={importName}
              onChange={e => setImportName(e.target.value)}
            />
            <Textarea
              placeholder="Вопрос: ...\nОтвет: ...\nОценка: 10/10"
              className="font-mono text-xs h-40"
              value={importContent}
              onChange={e => setImportContent(e.target.value)}
            />
            <Button
              className="w-full"
              onClick={handleImport}
              disabled={importMutation.isPending || !importName || !importContent}
            >
              {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Import Dataset'}
            </Button>
          </CardContent>
        </Card>

        {/* Run Section */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play size={18} /> Run Benchmark
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Run Name (Optional)"
              value={runName}
              onChange={e => setRunName(e.target.value)}
            />

            <div className="space-y-1">
              <Select value={selectedDatasetId} onChange={e => setSelectedDatasetId(e.target.value)}>
                <option value="">Select Dataset</option>
                {datasetsQuery.data?.map(ds => (
                  <option key={ds.id} value={ds.id}>{ds.name} ({ds.samplesCount} samples)</option>
                ))}
              </Select>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] text-slate-500 uppercase font-bold">Targets</div>
              {targets.map((target, index) => (
                <div key={index} className="flex gap-2">
                  <Select
                    className="w-[100px]"
                    value={target.type}
                    onChange={e => handleTargetChange(index, 'type', e.target.value)}
                  >
                    <option value="model">Model</option>
                    <option value="lora">LoRA</option>
                  </Select>

                  <Select
                    className="flex-1"
                    value={target.id}
                    onChange={e => handleTargetChange(index, 'id', e.target.value)}
                  >
                    <option value="">Select {target.type}</option>
                    {target.type === 'model' ? (
                      modelsQuery.data?.filter(m => m.status === 'ready').map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))
                    ) : (
                      lorasQuery.data?.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))
                    )}
                  </Select>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveTarget(index)}
                    disabled={targets.length === 1}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full border-dashed" onClick={handleAddTarget}>
                <Plus size={14} className="mr-2" /> Add Target
              </Button>
            </div>

            <Button
              className="w-full"
              variant="secondary"
              onClick={handleRun}
              disabled={runMutation.isPending || !selectedDatasetId}
            >
              {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Run Benchmark'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Datasets Table */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye size={18} /> Datasets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-900/50 text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold text-center">Samples</th>
                    <th className="px-4 py-2 font-semibold text-right">Created</th>
                    <th className="px-4 py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {datasetsQuery.data?.map(ds => (
                    <tr key={ds.id} className="hover:bg-slate-800/20">
                      <td className="px-4 py-3 font-medium text-white">{ds.name}</td>
                      <td className="px-4 py-3 text-center text-slate-400">{ds.samplesCount}</td>
                      <td className="px-4 py-3 text-right text-slate-500 text-xs">
                        {new Date(ds.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <Button size="sm" variant="secondary" onClick={() => showPreview(ds.id)}>Preview</Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(ds.id)}><Trash2 size={16} /></Button>
                      </td>
                    </tr>
                  ))}
                  {datasetsQuery.data?.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic">No datasets found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentRuns.map(run => (
                <div
                  key={run.id}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-900 cursor-pointer transition"
                  onClick={() => navigate(`/jobs/${run.id}`)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white truncate mr-2">{run.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                      run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                      run.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                      'bg-blue-500/10 text-blue-400'
                    }`}>
                      {run.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">{new Date(run.createdAt).toLocaleString()}</div>
                </div>
              ))}
              {recentRuns.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No runs yet</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Modal (Simplified for brevity) */}
      {isPreviewOpen && previewDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <Card className="w-full max-w-4xl max-h-[80vh] flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between shrink-0">
              <CardTitle>Dataset Preview: {previewDataset.name}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setIsPreviewOpen(false)}><X /></Button>
            </CardHeader>
            <CardContent className="overflow-y-auto space-y-4 p-6">
              {previewDataset.samples?.map((s, i) => (
                <div key={i} className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Sample #{i+1}</span>
                    <span className="text-xs font-bold text-emerald-400">Score: {s.referenceScore}/10</span>
                  </div>
                  <div className="text-xs"><span className="text-slate-500 font-semibold mr-2">Q:</span> {s.question}</div>
                  <div className="text-xs text-slate-300"><span className="text-slate-500 font-semibold mr-2">A:</span> {s.candidateAnswer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

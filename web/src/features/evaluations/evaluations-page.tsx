import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type EvalDataset, type EvalSample, type Job } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select } from '../../components/ui/select';
import { Trash2, Play, Upload, Eye, CheckCircle, AlertCircle, Loader2, Plus, X, Search, FileText, Clock, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

type TargetInput = {
  type: 'model' | 'lora';
  id: string;
};

export default function EvaluationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Import state
  const [importName, setImportName] = useState('');
  const [importContent, setImportContent] = useState('');
  const [validationResult, setValidationResult] = useState<{
    validCount: number;
    invalidCount: number;
    errors: any[];
    preview: EvalSample[];
  } | null>(null);

  // Run state
  const [runName, setRunName] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [targets, setTargets] = useState<TargetInput[]>([{ type: 'model', id: '' }]);

  // UI state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewDataset, setPreviewDataset] = useState<EvalDataset | null>(null);
  const [runSearch, setRunSearch] = useState('');

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
    refetchInterval: 5000,
  });

  const evalRuns = useMemo(() => {
    return (jobsQuery.data || [])
      .filter(j => j.type === 'eval-benchmark')
      .filter(j =>
        !runSearch ||
        j.name.toLowerCase().includes(runSearch.toLowerCase()) ||
        j.id.toLowerCase().includes(runSearch.toLowerCase())
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [jobsQuery.data, runSearch]);

  const validateMutation = useMutation({
    mutationFn: (content: string) => api.validateEvalDataset({ content }),
    onSuccess: (res) => {
      setValidationResult(res);
    },
    onError: (err: Error) => toast.error(`Validation failed: ${err.message}`),
  });

  const importMutation = useMutation({
    mutationFn: (payload: { name: string; content: string }) => api.importEvalDataset(payload),
    onSuccess: () => {
      toast.success('Dataset imported successfully');
      setImportName('');
      setImportContent('');
      setValidationResult(null);
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
        description="Сравнение моделей-оценщиков на контрольных датасетах."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Import Section */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload size={18} className="text-blue-400" /> Import Evaluation Dataset
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Dataset Name</label>
              <Input
                placeholder="e.g. JS Expert Benchmark"
                value={importName}
                onChange={e => setImportName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Content (TXT Format)</label>
              <Textarea
                placeholder="Вопрос: ...\nОтвет: ...\nОценка: 10/10\n\nВопрос: ..."
                className="font-mono text-[10px] h-48 bg-slate-950"
                value={importContent}
                onChange={e => setImportContent(e.target.value)}
              />
            </div>

            {importContent && (
              <Button
                className="w-full text-xs h-8 border border-slate-600 bg-transparent hover:bg-slate-800"
                onClick={() => validateMutation.mutate(importContent)}
                disabled={validateMutation.isPending}
              >
                {validateMutation.isPending ? <Loader2 size={12} className="animate-spin mr-2" /> : 'Validate Format'}
              </Button>
            )}

            {validationResult && (
              <div className={`p-3 rounded-lg border text-xs space-y-2 ${validationResult.invalidCount > 0 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1">
                    {validationResult.invalidCount > 0 ? <AlertCircle size={14} className="text-amber-500" /> : <CheckCircle size={14} className="text-emerald-500" />}
                    Validation Result
                  </span>
                  <span className="text-slate-400">
                    {validationResult.validCount} valid, {validationResult.invalidCount} invalid
                  </span>
                </div>
                {validationResult.errors.length > 0 && (
                  <ul className="space-y-1 text-[10px] text-amber-200/70 max-h-20 overflow-y-auto">
                    {validationResult.errors.map((err, i) => (
                      <li key={i}>• Block #{err.index + 1}: {err.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Button
              className="w-full bg-blue-600 hover:bg-blue-500 text-white"
              onClick={handleImport}
              disabled={importMutation.isPending || !importName || !importContent || (validationResult?.validCount === 0)}
            >
              {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Import Dataset'}
            </Button>
          </CardContent>
        </Card>

        {/* Run Section */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play size={18} className="text-emerald-400" /> Run New Evaluation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Run Name (Optional)</label>
              <Input
                placeholder="e.g. Qwen vs Llama comparison"
                value={runName}
                onChange={e => setRunName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Evaluation Dataset</label>
              <Select value={selectedDatasetId} onChange={e => setSelectedDatasetId(e.target.value)}>
                <option value="">Select Dataset</option>
                {datasetsQuery.data?.map(ds => (
                  <option key={ds.id} value={ds.id}>{ds.name} ({ds.samplesCount} samples)</option>
                ))}
              </Select>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-500 uppercase flex items-center justify-between">
                Target Models
                <span className="text-[10px] font-normal lowercase">({targets.length} selected)</span>
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {targets.map((target, index) => (
                  <div key={index} className="flex gap-2">
                    <Select
                      className="w-[100px] shrink-0"
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
                      className="h-9 w-9 text-slate-500 hover:text-rose-400 border border-slate-700 bg-transparent hover:bg-slate-800"
                      onClick={() => handleRemoveTarget(index)}
                      disabled={targets.length === 1}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="w-full border border-dashed border-slate-600 text-xs text-slate-400 bg-transparent hover:bg-slate-800"
                onClick={handleAddTarget}
              >
                <Plus size={14} className="mr-2" /> Add another model
              </Button>
            </div>

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white mt-auto"
              onClick={handleRun}
              disabled={runMutation.isPending || !selectedDatasetId || targets.some(t => !t.id)}
            >
              {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Start Evaluation Job'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Datasets List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText size={18} className="text-blue-400" /> Evaluation Datasets
          </CardTitle>
          <div className="text-xs text-slate-500">{datasetsQuery.data?.length || 0} datasets</div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900/50 text-slate-500 text-[10px] uppercase font-bold">
                <tr>
                  <th className="px-4 py-3">Dataset Name</th>
                  <th className="px-4 py-3 text-center">Samples</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {datasetsQuery.data?.map(ds => (
                  <tr key={ds.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{ds.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{ds.id}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-bold">
                        {ds.samplesCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(ds.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          className="h-8 text-xs bg-slate-700 hover:bg-slate-600"
                          onClick={() => showPreview(ds.id)}
                        >
                          <Eye size={14} className="mr-1" /> Preview
                        </Button>
                        <Button
                          className="h-8 w-8 p-0 text-slate-500 hover:text-rose-400 border border-slate-700 bg-transparent hover:bg-slate-800"
                          onClick={() => deleteMutation.mutate(ds.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {datasetsQuery.data?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic bg-slate-900/20">
                      No evaluation datasets found. Import one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Evaluation Job Runs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock size={18} className="text-amber-400" /> Evaluation History
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <Input
              className="pl-9 h-8 text-xs bg-slate-900 border-slate-800"
              placeholder="Search runs..."
              value={runSearch}
              onChange={e => setRunSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900/50 text-slate-500 text-[10px] uppercase font-bold">
                <tr>
                  <th className="px-4 py-3">Run Details</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Metrics</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {evalRuns.map(run => (
                  <tr key={run.id} className="hover:bg-slate-800/20 transition-colors cursor-pointer" onClick={() => navigate(`/jobs/${run.id}`)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{run.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(run.createdAt).toLocaleString()} • {run.paramsSnapshot?.targets?.length || 0} models
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        run.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                        run.status === 'running' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                        'bg-slate-500/10 text-slate-400'
                      }`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 w-48">
                      {run.status === 'running' ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>{run.progress?.totalProgressPercent || 0}%</span>
                            <span>{run.progress?.currentStage}</span>
                          </div>
                          <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                            <div
                              className="bg-blue-500 h-full transition-all duration-500"
                              style={{ width: `${run.progress?.totalProgressPercent || 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {run.status === 'completed' ? 'Completed' : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {run.summaryMetrics?.models ? (
                        <div className="flex gap-2">
                           {run.summaryMetrics.models.slice(0, 2).map((m, i) => (
                             <div key={i} className="text-[10px]">
                               <div className="text-slate-500 truncate max-w-[80px]">{m.modelLabel}</div>
                               <div className="text-white font-mono">MAE: {m.mae?.toFixed(3) || '—'}</div>
                             </div>
                           ))}
                           {(run.summaryMetrics.models.length > 2) && (
                             <div className="text-[10px] text-slate-500 flex items-end">+{run.summaryMetrics.models.length - 2}</div>
                           )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        className="h-8 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 border border-transparent bg-transparent"
                        onClick={(e) => { e.stopPropagation(); navigate(`/jobs/${run.id}`); }}
                      >
                        <BarChart3 size={14} className="mr-1" /> View Results
                      </Button>
                    </td>
                  </tr>
                ))}
                {evalRuns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500 bg-slate-900/20 italic">
                      No evaluation runs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Preview Dataset Modal */}
      {isPreviewOpen && previewDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <Card className="w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between shrink-0 border-b border-slate-800">
              <div>
                <CardTitle>Dataset Preview: {previewDataset.name}</CardTitle>
                <div className="text-xs text-slate-500 mt-1">{previewDataset.samplesCount} total samples</div>
              </div>
              <Button
                className="p-2 hover:bg-slate-800 rounded-md border border-slate-700 bg-transparent"
                onClick={() => setIsPreviewOpen(false)}
              >
                <X size={20} />
              </Button>
            </CardHeader>
            <CardContent className="overflow-y-auto space-y-4 p-6 bg-slate-950">
              {previewDataset.samples?.map((s, i) => (
                <div key={i} className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/50 pb-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Sample #{i+1}</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold">
                      Reference Score: {s.referenceScore}/10
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[80px_1fr]">
                    <div className="text-[10px] text-slate-500 uppercase font-bold pt-1">Question</div>
                    <div className="text-sm text-slate-200">{s.question}</div>

                    <div className="text-[10px] text-slate-500 uppercase font-bold pt-1">Answer</div>
                    <div className="text-sm text-slate-400 italic bg-slate-900/50 p-2 rounded">{s.candidateAnswer}</div>
                  </div>
                </div>
              ))}
            </CardContent>
            <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0 flex justify-end">
              <Button onClick={() => setIsPreviewOpen(false)} className="bg-slate-800 hover:bg-slate-700">
                Close Preview
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
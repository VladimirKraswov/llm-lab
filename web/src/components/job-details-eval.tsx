import { useQuery } from '@tanstack/react-query';
import type { Job, EvalBenchmarkResult, EvalSampleResult } from '../lib/api';
import { api, apiBase } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Download, MessageSquare, AlertTriangle, CheckCircle } from 'lucide-react';

export function JobDetailsEval({ job }: { job: Job }) {
  const isCompleted = job.status === 'completed';
  const [filterType, setFilterType] = useState<'all' | 'errors' | 'big-diff'>('all');
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  const resultQuery = useQuery({
    queryKey: ['eval-result', job.id],
    queryFn: () => api.getEvalBenchmarkResult(job.id),
    enabled: !!job.id && isCompleted,
  });

  // Исправлено: обращаемся к job.summaryMetrics?.models (теперь поле models есть в типе)
  const summary = job.summaryMetrics?.models || [];
  const bestModel = useMemo(() => {
    if (!summary.length) return null;
    return [...summary].sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity))[0];
  }, [summary]);

  const filteredResults = useMemo(() => {
    if (!resultQuery.data) return [];

    // Транспонирование из формата "модель→сэмплы" в "сэмпл→предсказания"
    const samples: Record<string, {
      id: string;
      question: string;
      candidateAnswer: string;
      referenceScore: number;
      predictions: Record<string, EvalSampleResult>;
    }> = {};

    resultQuery.data.forEach(modelResult => {
      modelResult.results.forEach(r => {
        if (!samples[r.sampleId]) {
          samples[r.sampleId] = {
            id: r.sampleId,
            question: r.question,
            candidateAnswer: r.candidateAnswer,
            referenceScore: r.referenceScore,
            predictions: {}
          };
        }
        samples[r.sampleId].predictions[modelResult.target.id] = r;
      });
    });

    return Object.values(samples).filter(s => {
      const preds = Object.values(s.predictions);
      if (filterType === 'errors') return preds.some(p => p.parseError);
      if (filterType === 'big-diff') return preds.some(p => (p.absoluteError ?? 0) > 2);
      return true;
    });
  }, [resultQuery.data, filterType]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  if (!isCompleted) {
    return (
      <div className="text-sm text-slate-500 py-8 text-center bg-slate-900/50 rounded-2xl border border-dashed border-slate-800">
        Results will appear once the benchmark is completed.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Сводная таблица */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Metric Summary</CardTitle>
          <div className="flex gap-2">
            <a href={`${apiBase}/evaluations/jobs/${job.id}/summary`} download>
              <Button className="bg-slate-800 text-xs px-3 py-1 rounded hover:bg-slate-700">
                <Download size={14} className="mr-1" /> Export Summary
              </Button>
            </a>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/80 text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-3 font-semibold">Model</th>
                  <th className="px-4 py-3 font-semibold text-center">Samples</th>
                  <th className="px-4 py-3 font-semibold text-center">Parse OK</th>
                  <th className="px-4 py-3 font-semibold text-center bg-blue-500/10 text-blue-300">MAE (lower better)</th>
                  <th className="px-4 py-3 font-semibold text-center">RMSE</th>
                  <th className="px-4 py-3 font-semibold text-center">Exact</th>
                  <th className="px-4 py-3 font-semibold text-center">±1</th>
                  <th className="px-4 py-3 font-semibold text-center">±2</th>
                  <th className="px-4 py-3 font-semibold text-center">Bias (MSE)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {summary.map(m => (
                  <tr key={m.modelId} className={`hover:bg-slate-800/20 ${m.modelId === bestModel?.modelId ? 'bg-emerald-500/5' : ''}`}>
                    <td className="px-4 py-3 font-medium text-white flex items-center gap-2">
                      {m.modelId === bestModel?.modelId && <CheckCircle size={14} className="text-emerald-400" />}
                      {m.modelLabel}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400">{m.samples}</td>
                    <td className="px-4 py-3 text-center text-slate-400">{(m.parseSuccessRate * 100).toFixed(1)}%</td>
                    <td className={`px-4 py-3 text-center font-bold ${m.modelId === bestModel?.modelId ? 'text-emerald-400' : 'text-blue-300'}`}>
                      {m.mae?.toFixed(3) || '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400">{m.rmse?.toFixed(3) || '—'}</td>
                    <td className="px-4 py-3 text-center text-slate-400">{(m.exactRate * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-center text-slate-400">{(m.within1Rate * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-center text-slate-400">{(m.within2Rate * 100).toFixed(1)}%</td>
                    <td className={`px-4 py-3 text-center ${Math.abs(m.meanSignedError ?? 0) > 0.5 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {m.meanSignedError?.toFixed(3) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Детальные результаты */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sample Comparison</CardTitle>
          <div className="flex gap-2">
            <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800 mr-2">
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1 rounded text-[10px] uppercase font-bold transition ${
                  filterType === 'all' ? 'bg-blue-600 text-white' : 'text-slate-500'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('big-diff')}
                className={`px-3 py-1 rounded text-[10px] uppercase font-bold transition ${
                  filterType === 'big-diff' ? 'bg-amber-600 text-white' : 'text-slate-500'
                }`}
              >
                Big Diff
              </button>
              <button
                onClick={() => setFilterType('errors')}
                className={`px-3 py-1 rounded text-[10px] uppercase font-bold transition ${
                  filterType === 'errors' ? 'bg-rose-600 text-white' : 'text-slate-500'
                }`}
              >
                Errors
              </button>
            </div>
            <a href={`${apiBase}/evaluations/jobs/${job.id}/result`} download>
              <Button className="bg-slate-800 text-xs px-3 py-1 rounded hover:bg-slate-700">
                <Download size={14} className="mr-1" /> Export Detailed
              </Button>
            </a>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredResults.map(sample => (
              <div key={sample.id} className="rounded-xl border border-slate-800 bg-slate-950/20 overflow-hidden">
                <div
                  className="px-4 py-3 bg-slate-900/50 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
                  onClick={() => toggleRow(sample.id)}
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">
                      Reference: {sample.referenceScore}/10
                    </div>
                    <div className="text-xs text-white truncate font-medium">{sample.question}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-1">
                      {Object.entries(sample.predictions).map(([mid, p]) => (
                        <div
                          key={mid}
                          title={p.modelLabel}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold border ${
                            p.parseError
                              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                              : (p.absoluteError ?? 0) <= 1
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                          }`}
                        >
                          {p.parseError ? 'ERR' : p.predictedScore?.toFixed(0)}
                        </div>
                      ))}
                    </div>
                    {expandedRows.includes(sample.id) ? (
                      <ChevronUp size={16} className="text-slate-500" />
                    ) : (
                      <ChevronDown size={16} className="text-slate-500" />
                    )}
                  </div>
                </div>

                {expandedRows.includes(sample.id) && (
                  <div className="p-4 border-t border-slate-800 bg-slate-950/50 space-y-4">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Question</div>
                          <div className="text-xs text-slate-200 bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                            {sample.question}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Candidate Answer</div>
                          <div className="text-xs text-slate-300 bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                            {sample.candidateAnswer}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Model Predictions</div>
                        {Object.values(sample.predictions).map(p => (
                          <div key={p.modelId} className="space-y-2 border-l-2 border-slate-800 pl-4 py-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-white">{p.modelLabel}</span>
                              <div className="flex items-center gap-2">
                                {p.parseError && <AlertTriangle size={12} className="text-rose-400" />}
                                <span
                                  className={`text-sm font-bold ${
                                    p.parseError
                                      ? 'text-rose-400'
                                      : (p.absoluteError ?? 0) <= 1
                                      ? 'text-emerald-400'
                                      : 'text-blue-400'
                                  }`}
                                >
                                  {p.parseError ? 'PARSE ERROR' : `${p.predictedScore}/10`}
                                </span>
                                {p.absoluteError !== null && (
                                  <span className="text-[10px] text-slate-500">(Err: {p.absoluteError.toFixed(1)})</span>
                                )}
                              </div>
                            </div>
                            {p.predictedFeedback && (
                              <details className="text-[10px]">
                                <summary className="cursor-pointer text-slate-500 hover:text-slate-300 flex items-center gap-1">
                                  <MessageSquare size={10} /> View Feedback
                                </summary>
                                <div className="mt-2 p-2 rounded bg-slate-900 text-slate-300 border border-slate-800 whitespace-pre-wrap">
                                  {p.predictedFeedback}
                                </div>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!filteredResults.length && (
              <div className="py-12 text-center text-slate-500 text-sm">No results matching filters.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
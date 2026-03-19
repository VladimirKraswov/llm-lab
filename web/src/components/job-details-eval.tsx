import { useQuery } from '@tanstack/react-query';
import type { Job, EvalBenchmarkResult, EvalSampleResult, LogEntry } from '../lib/api';
import { api, apiBase } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronUp, Download, MessageSquare, AlertTriangle,
  CheckCircle, Loader2, BarChart2, List, Activity, Terminal,
  ArrowUpDown, Filter, Search
} from 'lucide-react';
import { Input } from './ui/input';

export function JobDetailsEval({ job }: { job: Job }) {
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';

  const [filterType, setFilterType] = useState<'all' | 'errors' | 'big-diff'>('all');
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'summary' | 'details' | 'logs'>('summary');
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const resultQuery = useQuery({
    queryKey: ['eval-result', job.id],
    queryFn: () => api.getEvalBenchmarkResult(job.id),
    enabled: !!job.id && (isCompleted || isFailed), // Try even if failed to see partial results
    retry: false
  });

  const logsQuery = useQuery({
    queryKey: ['job-logs', job.id],
    queryFn: () => api.getJobLogs(job.id, 500),
    refetchInterval: isRunning ? 3000 : false,
  });

  const summary = job.summaryMetrics?.models || [];

  const bestModel = useMemo(() => {
    if (!summary.length) return null;
    return [...summary].sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity))[0];
  }, [summary]);

  const filteredResults = useMemo(() => {
    if (!resultQuery.data) return [];

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

    let list = Object.values(samples);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => s.question.toLowerCase().includes(q) || s.candidateAnswer.toLowerCase().includes(q));
    }

    if (filterType === 'errors') {
      list = list.filter(s => Object.values(s.predictions).some(p => p.parseError));
    } else if (filterType === 'big-diff') {
      list = list.filter(s => Object.values(s.predictions).some(p => (p.absoluteError ?? 0) > 2));
    }

    return list;
  }, [resultQuery.data, filterType, searchQuery]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedSummary = useMemo(() => {
    if (!sortConfig) return summary;
    return [...summary].sort((a, b) => {
      const aVal = (a as any)[sortConfig.key];
      const bVal = (b as any)[sortConfig.key];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      return sortConfig.direction === 'asc' ? (aVal < bVal ? -1 : 1) : (aVal > bVal ? -1 : 1);
    });
  }, [summary, sortConfig]);

  if (isRunning) {
    const progress = job.progress || {};
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-blue-500/5 border-blue-500/20">
            <CardContent className="pt-6">
              <div className="text-[10px] text-blue-400 uppercase font-bold mb-1">Overall Progress</div>
              <div className="text-2xl font-bold text-white mb-2">{progress.totalProgressPercent || 0}%</div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-500"
                  style={{ width: `${progress.totalProgressPercent || 0}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Model {progress.processedModels || 0} of {progress.totalModels || 0}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-emerald-500/5 border-emerald-500/20">
            <CardContent className="pt-6">
              <div className="text-[10px] text-emerald-400 uppercase font-bold mb-1">Current Model</div>
              <div className="text-sm font-bold text-white truncate mb-2">{progress.currentModelName || 'Initializing...'}</div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{ width: `${progress.modelProgressPercent || 0}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Samples {progress.processedSamples || 0} of {progress.totalSamples || 0} ({progress.modelProgressPercent || 0}%)
              </div>
            </CardContent>
          </Card>

          <Card className="bg-amber-500/5 border-amber-500/20">
            <CardContent className="pt-6">
              <div className="text-[10px] text-amber-400 uppercase font-bold mb-1">Current Stage</div>
              <div className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-amber-500" />
                {progress.currentStage || 'Starting...'}
              </div>
              <div className="text-[10px] text-slate-500">
                Started at: {new Date(job.startedAt!).toLocaleTimeString()}
              </div>
              <div className="mt-2 text-[10px] text-slate-600 truncate">
                Job ID: {job.id}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal size={16} /> Structured Logs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LogPanel logs={logsQuery.data?.content || ''} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isFailed && !resultQuery.data) {
    return (
      <div className="py-12 text-center space-y-4 bg-rose-500/5 rounded-2xl border border-dashed border-rose-500/20">
        <AlertTriangle size={48} className="mx-auto text-rose-500 opacity-50" />
        <div>
          <h3 className="text-lg font-bold text-white">Evaluation Failed</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">{job.error || 'Unknown error occurred during benchmark.'}</p>
        </div>
        <Button onClick={() => setActiveTab('logs')} className="bg-slate-800">Check Logs</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex bg-slate-900 p-1 rounded-xl w-fit border border-slate-800">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${activeTab === 'summary' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <BarChart2 size={14} /> Summary
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${activeTab === 'details' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <List size={14} /> Sample Details
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${activeTab === 'logs' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Terminal size={14} /> Logs
        </button>
      </div>

      {activeTab === 'summary' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Metric Leaderboard</CardTitle>
            <div className="flex gap-2">
              <a href={`${apiBase}/evaluations/jobs/${job.id}/summary`} download>
                {/* Исправлено: убран variant и size, добавлены классы для outline-стиля */}
                <Button className="h-8 text-xs border border-slate-600 bg-transparent hover:bg-slate-800">
                  <Download size={12} className="mr-1" /> Export CSV
                </Button>
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-[11px] text-left">
                <thead className="bg-slate-900/80 text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('modelLabel')}>
                      Model {sortConfig?.key === 'modelLabel' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" title="(v1^2 - v2^2)^2" onClick={() => handleSort('squaredDeltaSquaresMean')}>
                      sqΔsq {sortConfig?.key === 'squaredDeltaSquaresMean' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('mae')}>
                      MAE {sortConfig?.key === 'mae' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('rmse')}>
                      RMSE {sortConfig?.key === 'rmse' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('exactRate')}>
                      Exact {sortConfig?.key === 'exactRate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('within1Rate')}>
                      ±1 {sortConfig?.key === 'within1Rate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('within2Rate')}>
                      ±2 {sortConfig?.key === 'within2Rate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('meanSignedError')}>
                      Bias {sortConfig?.key === 'meanSignedError' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-3 text-center cursor-pointer hover:text-white" onClick={() => handleSort('parseSuccessRate')}>
                      Parse OK {sortConfig?.key === 'parseSuccessRate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {sortedSummary.map(m => (
                    <tr key={m.modelId} className={`hover:bg-slate-800/20 transition-colors ${m.modelId === bestModel?.modelId ? 'bg-emerald-500/5' : ''}`}>
                      <td className="px-4 py-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          {m.modelId === bestModel?.modelId && <CheckCircle size={14} className="text-emerald-400 shrink-0" />}
                          <span className="truncate">{m.modelLabel}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-400">
                        {m.squaredDeltaSquaresMean?.toFixed(3) || '—'}
                      </td>
                      <td className={`px-3 py-3 text-center font-bold ${m.modelId === bestModel?.modelId ? 'text-emerald-400' : 'text-blue-300'}`}>
                        {m.mae?.toFixed(3) || '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-slate-400">{m.rmse?.toFixed(3) || '—'}</td>
                      <td className="px-3 py-3 text-center text-slate-400">{(m.exactRate * 100).toFixed(1)}%</td>
                      <td className="px-3 py-3 text-center text-slate-400">{(m.within1Rate * 100).toFixed(1)}%</td>
                      <td className="px-3 py-3 text-center text-slate-400">{(m.within2Rate * 100).toFixed(1)}%</td>
                      <td className={`px-3 py-3 text-center ${Math.abs(m.meanSignedError ?? 0) > 0.5 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {m.meanSignedError?.toFixed(3) || '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-slate-500">{(m.parseSuccessRate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'details' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <Input
                  placeholder="Search in samples..."
                  className="pl-9 h-8 text-xs bg-slate-900 border-slate-800"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1 rounded text-[10px] uppercase font-bold transition ${filterType === 'all' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterType('big-diff')}
                  className={`px-3 py-1 rounded text-[10px] uppercase font-bold transition ${filterType === 'big-diff' ? 'bg-amber-600 text-white' : 'text-slate-500'}`}
                >
                  Big Diff
                </button>
                <button
                  onClick={() => setFilterType('errors')}
                  className={`px-3 py-1 rounded text-[10px] uppercase font-bold transition ${filterType === 'errors' ? 'bg-rose-600 text-white' : 'text-slate-500'}`}
                >
                  Errors
                </button>
              </div>
            </div>
            <a href={`${apiBase}/evaluations/jobs/${job.id}/result`} download>
              {/* Исправлено: убран size, оставлены классы */}
              <Button className="h-8 text-xs bg-slate-800 hover:bg-slate-700">
                <Download size={14} className="mr-1" /> Export detailed JSON
              </Button>
            </a>
          </div>

          <div className="space-y-2">
            {filteredResults.map(sample => (
              <div key={sample.id} className="rounded-xl border border-slate-800 bg-slate-950/20 overflow-hidden">
                <div
                  className="px-4 py-3 bg-slate-900/50 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
                  onClick={() => toggleRow(sample.id)}
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-slate-500 uppercase font-bold">Reference: {sample.referenceScore}/10</span>
                      {Object.values(sample.predictions).some(p => p.parseError) && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 text-[8px] font-bold uppercase">Parse Error</span>}
                    </div>
                    <div className="text-xs text-white truncate font-medium">{sample.question}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-1">
                      {Object.entries(sample.predictions).map(([mid, p]) => (
                        <div
                          key={mid}
                          title={`${p.modelLabel}: ${p.parseError ? 'Error' : p.predictedScore + '/10'}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold border ${
                            p.parseError
                              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                              : (p.absoluteError ?? 0) <= 1
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : (p.absoluteError ?? 0) > 2
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                              : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                          }`}
                        >
                          {p.parseError ? 'ERR' : p.predictedScore?.toFixed(0)}
                        </div>
                      ))}
                    </div>
                    {expandedRows.includes(sample.id) ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                  </div>
                </div>

                {expandedRows.includes(sample.id) && (
                  <div className="p-4 border-t border-slate-800 bg-slate-950/50 space-y-4">
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="space-y-4">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-bold mb-1.5">Question</div>
                          <div className="text-xs text-slate-200 bg-slate-900/50 p-4 rounded-xl border border-slate-800/50 leading-relaxed">
                            {sample.question}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-bold mb-1.5">Candidate Answer</div>
                          <div className="text-xs text-slate-400 bg-slate-900/50 p-4 rounded-xl border border-slate-800/50 leading-relaxed italic">
                            {sample.candidateAnswer}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Model Predictions</div>
                        {Object.values(sample.predictions).map(p => (
                          <div key={p.modelId} className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${p.parseError ? 'bg-rose-500' : 'bg-blue-500'}`} />
                                {p.modelLabel}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold ${p.parseError ? 'text-rose-400' : 'text-blue-400'}`}>
                                  {p.parseError ? 'PARSE ERROR' : `${p.predictedScore}/10`}
                                </span>
                                {p.absoluteError !== null && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${p.absoluteError <= 1 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-800 text-slate-400'}`}>
                                    Δ {p.absoluteError.toFixed(1)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {p.predictedFeedback ? (
                              <div className="text-[10px] text-slate-400 leading-relaxed bg-black/20 p-2 rounded border border-slate-800/50 whitespace-pre-wrap">
                                {p.predictedFeedback}
                              </div>
                            ) : (
                               p.rawResponse && (
                                 <details className="text-[10px]">
                                   <summary className="cursor-pointer text-slate-600 hover:text-slate-400 flex items-center gap-1">
                                      View Raw Output
                                   </summary>
                                   <div className="mt-2 p-2 rounded bg-black/40 text-slate-500 border border-slate-800/50 font-mono text-[9px] overflow-x-auto">
                                     {p.rawResponse}
                                   </div>
                                 </details>
                               )
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
              <div className="py-20 text-center space-y-2 bg-slate-900/10 rounded-2xl border border-dashed border-slate-800">
                <Filter size={32} className="mx-auto text-slate-700" />
                <div className="text-slate-500 text-sm">No samples match your filters.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Job Log Stream</CardTitle>
          </CardHeader>
          <CardContent>
            <LogPanel logs={logsQuery.data?.content || 'No logs found for this job.'} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogPanel({ logs }: { logs: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const lines = logs.split('\n').filter(Boolean);

  return (
    <div
      ref={scrollRef}
      className="max-h-[600px] overflow-y-auto bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[10px] space-y-0.5"
    >
      {lines.map((line, i) => {
        let tone = 'text-slate-400';
        if (line.includes('[ERROR]')) tone = 'text-rose-400';
        if (line.includes('[WARN]')) tone = 'text-amber-400';
        if (line.includes('[SUCCESS]') || line.includes('successfully')) tone = 'text-emerald-400';

        return (
          <div key={i} className={`${tone} border-l-2 border-transparent hover:border-slate-800 hover:bg-white/5 px-2`}>
            {line}
          </div>
        );
      })}
    </div>
  );
}
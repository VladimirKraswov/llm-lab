import { Job } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { formatSize } from '../../utils';
import { useState, useMemo } from 'react';
import { ArrowUpDown, Check, Trophy } from 'lucide-react';

interface MetricRow {
  id: string;
  name: string;
  status: string;
  dataset: string;
  baseModel: string;
  epochs: number;
  lr: number;
  loraR: number;
  loraAlpha: number;
  loraDropout: number;
  loss: number;
  duration: string;
  adapterSize: string;
  adapterSizeBytes: number;
  job: Job;
}

export function JobComparison({ jobs, onBack }: { jobs: Job[]; onBack: () => void }) {
  const [sortField, setSortField] = useState<keyof MetricRow>('loss');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const rows: MetricRow[] = useMemo(() => {
    return jobs.map((job) => {
      const p = job.paramsSnapshot || {};
      const q = p.qlora || job.qlora || {};
      const sm = job.summaryMetrics || {};

      const adapterArt = job.artifacts?.find(a => a.name.includes('adapter_model.bin') || a.name.includes('adapter_model.safetensors'));

      return {
        id: job.id,
        name: job.name,
        status: job.status,
        dataset: job.datasetId || '—',
        baseModel: job.baseModel || '—',
        epochs: q.numTrainEpochs ?? '—',
        lr: q.learningRate ?? '—',
        loraR: q.loraR ?? '—',
        loraAlpha: q.loraAlpha ?? '—',
        loraDropout: q.loraDropout ?? '—',
        loss: sm.final_loss ?? Infinity,
        duration: sm.duration_human || '—',
        adapterSize: adapterArt ? formatSize(adapterArt.size) : '—',
        adapterSizeBytes: adapterArt ? adapterArt.size : 0,
        job,
      };
    });
  }, [jobs]);

  const bestLoss = useMemo(() => {
    const validLosses = rows.map(r => r.loss).filter(l => l !== Infinity);
    return validLosses.length ? Math.min(...validLosses) : null;
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];

      if (valA === valB) return 0;
      if (valA === '—' || valA === Infinity) return 1;
      if (valB === '—' || valB === Infinity) return -1;

      const res = valA < valB ? -1 : 1;
      return sortOrder === 'asc' ? res : -res;
    });
  }, [rows, sortField, sortOrder]);

  const toggleSort = (field: keyof MetricRow) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const HeaderCell = ({ label, field, sortable = true }: { label: string, field?: keyof MetricRow, sortable?: boolean }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${sortable ? 'cursor-pointer hover:text-white' : ''}`}
      onClick={() => sortable && field && toggleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortable && field === sortField && (
          <ArrowUpDown size={12} className={sortOrder === 'asc' ? 'rotate-180' : ''} />
        )}
      </div>
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Run Comparison</h2>
          <p className="text-sm text-slate-400">Comparing {jobs.length} training runs</p>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Back to List
        </button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <HeaderCell label="Run Name" field="name" />
                  <HeaderCell label="Status" field="status" />
                  <HeaderCell label="Dataset" field="dataset" />
                  <HeaderCell label="Loss" field="loss" />
                  <HeaderCell label="Epochs" field="epochs" />
                  <HeaderCell label="LR" field="lr" />
                  <HeaderCell label="LoRA (r/α/dr)" sortable={false} />
                  <HeaderCell label="Duration" field="duration" />
                  <HeaderCell label="Adapter" field="adapterSizeBytes" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedRows.map((row) => (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-800/30 transition ${row.loss === bestLoss && bestLoss !== null ? 'bg-emerald-500/5' : ''}`}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {row.loss === bestLoss && bestLoss !== null && (
                          <Trophy size={14} className="text-amber-400" />
                        )}
                        <span className="font-medium text-white">{row.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">{row.id}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        row.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        row.status === 'failed' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-400 max-w-[120px] truncate">{row.dataset}</td>
                    <td className="px-4 py-4">
                      <span className={`font-mono ${row.loss === bestLoss && bestLoss !== null ? 'text-emerald-400 font-bold' : 'text-white'}`}>
                        {row.loss === Infinity ? '—' : row.loss.toFixed(6)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-300">{row.epochs}</td>
                    <td className="px-4 py-4 text-slate-300 font-mono text-xs">{row.lr}</td>
                    <td className="px-4 py-4 text-slate-300">
                      {row.loraR}/{row.loraAlpha}/{row.loraDropout}
                    </td>
                    <td className="px-4 py-4 text-slate-300 text-xs">{row.duration}</td>
                    <td className="px-4 py-4 text-slate-300 text-xs">{row.adapterSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="mb-4 text-lg font-medium text-white">Detailed Parameters</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sortedRows.map(row => (
            <div key={row.id} className={`rounded-xl border p-4 space-y-3 ${row.loss === bestLoss && bestLoss !== null ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800 bg-black/20'}`}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-white truncate mr-2">{row.name}</div>
                {row.loss === bestLoss && bestLoss !== null && <Trophy size={16} className="text-amber-400" />}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Base Model:</span>
                  <span className="text-slate-300 truncate ml-4 max-w-[150px]">{row.baseModel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Max Seq Length:</span>
                  <span className="text-slate-300">{(row.job.paramsSnapshot?.qlora || row.job.qlora)?.maxSeqLength || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Batch Size:</span>
                  <span className="text-slate-300">{(row.job.paramsSnapshot?.qlora || row.job.qlora)?.perDeviceTrainBatchSize || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Grad Accum:</span>
                  <span className="text-slate-300">{(row.job.paramsSnapshot?.qlora || row.job.qlora)?.gradientAccumulationSteps || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Warmup Ratio:</span>
                  <span className="text-slate-300">{(row.job.paramsSnapshot?.qlora || row.job.qlora)?.warmupRatio || '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

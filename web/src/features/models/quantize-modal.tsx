import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

interface QuantizeModelModalProps {
  modelId: string;
  modelName: string;
  onClose: () => void;
  onQuantize: (params: any) => void;
  isPending: boolean;
}

export function QuantizeModelModal({
  modelId,
  modelName,
  onClose,
  onQuantize,
  isPending,
}: QuantizeModelModalProps) {
  const [method, setMethod] = useState('awq');
  const [bits, setBits] = useState(4);
  const [groupSize, setGroupSize] = useState(128);
  const [numSamples, setNumSamples] = useState(128);
  const [maxSeqLen, setMaxSeqLen] = useState(2048);
  const [datasetPath, setDatasetPath] = useState('');
  const [sym, setSym] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onQuantize({
      modelId,
      method,
      bits,
      groupSize,
      numSamples,
      maxSeqLen,
      datasetPath: datasetPath || undefined,
      sym,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-xl font-semibold text-white mb-1">Quantize Model</h3>
        <p className="text-sm text-slate-400 mb-6">{modelName}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="awq">AWQ (Recommended)</option>
                <option value="fp8">FP8</option>
                <option value="int8">INT8</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Bits</label>
              <Input
                type="number"
                value={bits}
                onChange={(e) => setBits(Number(e.target.value))}
                min={2}
                max={16}
                className="bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Group Size</label>
              <Input
                type="number"
                value={groupSize}
                onChange={(e) => setGroupSize(Number(e.target.value))}
                className="bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Sym</label>
              <div className="flex items-center h-9">
                <input
                  type="checkbox"
                  checked={sym}
                  onChange={(e) => setSym(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-600"
                />
                <span className="ml-2 text-sm text-slate-300">Symmetric</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Samples</label>
              <Input
                type="number"
                value={numSamples}
                onChange={(e) => setNumSamples(Number(e.target.value))}
                className="bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Max Seq Len</label>
              <Input
                type="number"
                value={maxSeqLen}
                onChange={(e) => setMaxSeqLen(Number(e.target.value))}
                className="bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">Calibration Dataset (Optional)</label>
            <Input
              value={datasetPath}
              onChange={(e) => setDatasetPath(e.target.value)}
              placeholder="Path to JSONL or HF dataset name"
              className="bg-slate-950"
            />
            <p className="mt-1 text-[10px] text-slate-500">Defaults to "open-platypus" if empty.</p>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-amber-600 hover:bg-amber-500 text-white"
            >
              {isPending ? 'Starting...' : 'Start Quantization'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

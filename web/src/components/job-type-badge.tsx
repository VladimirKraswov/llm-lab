import { Boxes, BrainCircuit, Database, SplitSquareHorizontal, CheckCircle } from 'lucide-react';

export function JobTypeBadge({ type }: { type: string }) {
  if (type === 'synthetic-gen') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">
        <Database size={12} />
        Synthetic Dataset
      </span>
    );
  }

  if (type === 'eval-benchmark') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
        <CheckCircle size={12} />
        Evaluation
      </span>
    );
  }

  if (type === 'model-quantize') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
        <Boxes size={12} />
        Quantization
      </span>
    );
  }

  if (type === 'fine-tune') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-300">
        <BrainCircuit size={12} />
        Fine-tune
      </span>
    );
  }

  if (type === 'model-comparison') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300">
        <SplitSquareHorizontal size={12} />
        Comparison
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
      {type}
    </span>
  );
}
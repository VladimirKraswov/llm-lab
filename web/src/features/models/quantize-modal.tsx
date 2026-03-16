import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Zap, Gauge, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';

interface QuantizeModelModalProps {
  modelId: string;
  modelName: string;
  defaultRunner?: 'ml_env' | 'quant_env';
  onClose: () => void;
  onQuantize: (params: {
    modelId: string;
    method: string;
    name?: string;
    datasetPath?: string;
    numSamples?: number;
    maxSeqLen?: number;
    bits?: number;
    groupSize?: number;
    sym?: boolean;
    runner?: 'ml_env' | 'quant_env';
  }) => void;
  isPending: boolean;
}

type Preset = 'fast' | 'balanced' | 'quality';

const PRESET_VALUES: Record<Preset, { numSamples: number; maxSeqLen: number }> = {
  fast: { numSamples: 64, maxSeqLen: 1024 },
  balanced: { numSamples: 128, maxSeqLen: 2048 },
  quality: { numSamples: 256, maxSeqLen: 4096 },
};

function presetMeta(preset: Preset) {
  if (preset === 'fast') {
    return {
      icon: Zap,
      title: 'Fast',
      description: 'Быстрый старт, минимальная калибровка',
    };
  }
  if (preset === 'quality') {
    return {
      icon: Gauge,
      title: 'Quality',
      description: 'Больше сэмплов и контекста, медленнее',
    };
  }
  return {
    icon: Sparkles,
    title: 'Balanced',
    description: 'Рекомендуемый вариант для большинства моделей',
  };
}

export function QuantizeModelModal({
  modelId,
  modelName,
  defaultRunner = 'quant_env',
  onClose,
  onQuantize,
  isPending,
}: QuantizeModelModalProps) {
  const { data: datasets = [] } = useQuery({
    queryKey: ['datasets'],
    queryFn: api.getDatasets,
  });

  const [preset, setPreset] = useState<Preset>('balanced');
  const [customName, setCustomName] = useState('');
  const [selectedDatasetPath, setSelectedDatasetPath] = useState('');
  const [numSamples, setNumSamples] = useState(PRESET_VALUES.balanced.numSamples);
  const [maxSeqLen, setMaxSeqLen] = useState(PRESET_VALUES.balanced.maxSeqLen);
  const [bits, setBits] = useState(4);
  const [groupSize, setGroupSize] = useState(128);
  const [sym, setSym] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [runner, setRunner] = useState<'ml_env' | 'quant_env'>(defaultRunner);

  useEffect(() => {
    const values = PRESET_VALUES[preset];
    setNumSamples(values.numSamples);
    setMaxSeqLen(values.maxSeqLen);
  }, [preset]);

  const suggestedName = useMemo(() => {
    const base = modelName.trim() || 'Model';
    return `${base} AWQ`;
  }, [modelName]);

  const finalName = customName.trim() || suggestedName;

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.processedPath === selectedDatasetPath) || null,
    [datasets, selectedDatasetPath],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    onQuantize({
      modelId,
      method: 'awq',
      name: finalName,
      datasetPath: selectedDatasetPath || undefined,
      numSamples,
      maxSeqLen,
      bits,
      groupSize,
      sym,
      runner,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-800 px-6 py-5">
          <h3 className="text-xl font-semibold text-white">Convert model to AWQ</h3>
          <p className="mt-1 text-sm text-slate-400">{modelName}</p>
        </div>

        <form onSubmit={submit} className="space-y-6 p-6">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
              Output model name
            </label>
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={suggestedName}
              className="bg-slate-950"
            />
            <p className="mt-2 text-xs text-slate-500">
              Будет создана новая модель: <span className="text-slate-300">{finalName}</span>
            </p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
              Quantization runner
            </label>
            <select
              value={runner}
              onChange={(e) => setRunner(e.target.value as 'ml_env' | 'quant_env')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="quant_env">quant_env (isolated, recommended)</option>
              <option value="ml_env">ml_env</option>
            </select>
            <p className="mt-2 text-xs text-slate-500">
              quant_env позволяет позже подключить рабочий квантизатор без ломания основного ml_env.
            </p>
          </div>

          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Preset
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {(['fast', 'balanced', 'quality'] as Preset[]).map((key) => {
                const meta = presetMeta(key);
                const Icon = meta.icon;
                const active = preset === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPreset(key)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={16} className={active ? 'text-amber-300' : 'text-slate-400'} />
                      <div className="font-medium text-white">{meta.title}</div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">{meta.description}</div>
                    <div className="mt-3 text-[11px] text-slate-500">
                      {PRESET_VALUES[key].numSamples} samples · {PRESET_VALUES[key].maxSeqLen} seq
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
                Calibration dataset
              </label>
              <select
                value={selectedDatasetPath}
                onChange={(e) => setSelectedDatasetPath(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="">Default: open-platypus</option>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.processedPath}>
                    {ds.name} ({ds.rows} rows)
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Лучше выбрать свой dataset, если модель квантуется под ваш домен.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Summary
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Method</span>
                  <span className="text-white">AWQ</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Runner</span>
                  <span className="text-white">{runner}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Bits</span>
                  <span className="text-white">{bits}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Group size</span>
                  <span className="text-white">{groupSize}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Samples</span>
                  <span className="text-white">{numSamples}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Max seq len</span>
                  <span className="text-white">{maxSeqLen}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Dataset</span>
                  <span className="max-w-[180px] truncate text-right text-white">
                    {selectedDataset?.name || 'open-platypus'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-white"
            >
              <SlidersHorizontal size={16} />
              {advanced ? 'Hide advanced settings' : 'Show advanced settings'}
            </button>

            {advanced ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
                    Samples
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={numSamples}
                    onChange={(e) => setNumSamples(Number(e.target.value))}
                    className="bg-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
                    Max seq len
                  </label>
                  <Input
                    type="number"
                    min={128}
                    value={maxSeqLen}
                    onChange={(e) => setMaxSeqLen(Number(e.target.value))}
                    className="bg-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
                    Bits
                  </label>
                  <Input
                    type="number"
                    min={2}
                    max={8}
                    value={bits}
                    onChange={(e) => setBits(Number(e.target.value))}
                    className="bg-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">
                    Group size
                  </label>
                  <Input
                    type="number"
                    min={32}
                    step={32}
                    value={groupSize}
                    onChange={(e) => setGroupSize(Number(e.target.value))}
                    className="bg-slate-950"
                  />
                </div>

                <div className="md:col-span-2 flex items-center gap-3">
                  <input
                    id="awq-sym"
                    type="checkbox"
                    checked={sym}
                    onChange={(e) => setSym(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-600"
                  />
                  <label htmlFor="awq-sym" className="text-sm text-slate-300">
                    Symmetric quantization
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100">
            AWQ создаст новую квантизованную модель и добавит её в библиотеку. Исходная модель не изменяется.
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
            <Button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="border border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={isPending}
              className="bg-amber-600 text-white hover:bg-amber-500"
            >
              {isPending ? 'Starting…' : 'Start AWQ conversion'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
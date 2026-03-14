import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';

export default function TrainingPage() {
  const navigate = useNavigate();

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.getDatasets });
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: api.getModels });
  const lorasQuery = useQuery({ queryKey: ['loras'], queryFn: api.getLoras });

  const [datasetId, setDatasetId] = useState('');
  const [name, setName] = useState('');
  const [modelId, setModelId] = useState('');
  const [epochs, setEpochs] = useState('3');
  const [lr, setLr] = useState('0.0002');
  const [batchSize, setBatchSize] = useState('1');
  const [gradAcc, setGradAcc] = useState('8');
  const [maxSeqLength, setMaxSeqLength] = useState('4096');
  const [loraR, setLoraR] = useState('16');
  const [loraAlpha, setLoraAlpha] = useState('16');
  const [loraDropout, setLoraDropout] = useState('0');

  useEffect(() => {
    if (settingsQuery.data) {
      setEpochs(String(settingsQuery.data.qlora.numTrainEpochs));
      setLr(String(settingsQuery.data.qlora.learningRate));
      setBatchSize(String(settingsQuery.data.qlora.perDeviceTrainBatchSize));
      setGradAcc(String(settingsQuery.data.qlora.gradientAccumulationSteps));
      setMaxSeqLength(String(settingsQuery.data.qlora.maxSeqLength));
      setLoraR(String(settingsQuery.data.qlora.loraR));
      setLoraAlpha(String(settingsQuery.data.qlora.loraAlpha));
      setLoraDropout(String(settingsQuery.data.qlora.loraDropout));
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!datasetId && datasetsQuery.data?.[0]?.id) setDatasetId(datasetsQuery.data[0].id);
  }, [datasetsQuery.data, datasetId]);

  useEffect(() => {
    const firstReadyModel = modelsQuery.data?.find((m) => m.status === 'ready');
    if (!modelId && firstReadyModel?.id) setModelId(firstReadyModel.id);
  }, [modelsQuery.data, modelId]);

  const filteredLoras = useMemo(() => {
    return (lorasQuery.data || []).filter((x) => x.baseModelId === modelId);
  }, [lorasQuery.data, modelId]);

  const selectedModel = useMemo(() => {
    return (modelsQuery.data || []).find((x) => x.id === modelId) || null;
  }, [modelsQuery.data, modelId]);

  const startMutation = useMutation({
    mutationFn: api.startFineTune,
    onSuccess: (data) => {
      navigate(`/app/jobs?selected=${data.jobId}`);
    },
  });

  return (
    <div>
      <PageHeader title="Training" description="Выбери базовую модель, датасет и настройки обучения. Справа видно LoRA уже созданные под эту модель." />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>New fine-tune job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Base model</label>
              <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Select model</option>
                {(modelsQuery.data || []).map((m) => (
                  <option key={m.id} value={m.id} disabled={m.status !== 'ready'}>
                    {m.name} {m.status !== 'ready' ? `(${m.status})` : ''}
                  </option>
                ))}
              </Select>
              <div className="mt-2 text-xs text-slate-500">
                Сначала скачай модель на странице Models. Для обучения используется локальная модель из базы.
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-400">Dataset</label>
              <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                <option value="">Select dataset</option>
                {(datasetsQuery.data || []).map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} ({ds.rows})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-400">Job / LoRA name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-bot-v1" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Epochs</label>
                <Input value={epochs} onChange={(e) => setEpochs(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Learning rate</label>
                <Input value={lr} onChange={(e) => setLr(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Batch size</label>
                <Input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Grad accumulation</label>
                <Input value={gradAcc} onChange={(e) => setGradAcc(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Max seq length</label>
                <Input value={maxSeqLength} onChange={(e) => setMaxSeqLength(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">LoRA R</label>
                <Input value={loraR} onChange={(e) => setLoraR(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">LoRA Alpha</label>
                <Input value={loraAlpha} onChange={(e) => setLoraAlpha(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">LoRA Dropout</label>
                <Input value={loraDropout} onChange={(e) => setLoraDropout(e.target.value)} />
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">
              Подсказка: для smoke test используй 1 эпоху, маленький датасет и batch size = 1.
            </div>

            <Button
              onClick={() =>
                startMutation.mutate({
                  datasetId,
                  name,
                  modelId,
                  qlora: {
                    numTrainEpochs: Number(epochs),
                    learningRate: Number(lr),
                    perDeviceTrainBatchSize: Number(batchSize),
                    gradientAccumulationSteps: Number(gradAcc),
                    maxSeqLength: Number(maxSeqLength),
                    loraR: Number(loraR),
                    loraAlpha: Number(loraAlpha),
                    loraDropout: Number(loraDropout),
                  },
                })
              }
              disabled={!datasetId || !modelId || startMutation.isPending}
            >
              {startMutation.isPending ? 'Starting…' : 'Start fine-tune'}
            </Button>

            {startMutation.error ? <p className="text-sm text-rose-300">{(startMutation.error as Error).message}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-slate-400">Selected model</div>
              <div className="mt-1 text-white">{selectedModel?.name || '—'}</div>
            </div>

            <div>
              <div className="text-sm text-slate-400">Existing LoRAs under this model</div>
              <div className="mt-2 space-y-2">
                {!filteredLoras.length ? (
                  <div className="text-sm text-slate-500">No LoRAs yet for this model.</div>
                ) : (
                  filteredLoras.map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-950/40 p-3">
                      <div className="font-medium text-white">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">Job: {item.jobId}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-sm text-slate-400">
              После completed job LoRA автоматически появится в списке LoRAs и её можно будет запустить на инференс или упаковать.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

export default function SettingsPage() {
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [baseModel, setBaseModel] = useState('');
  const [inferenceModel, setInferenceModel] = useState('');
  const [port, setPort] = useState('8000');
  const [maxSeqLength, setMaxSeqLength] = useState('4096');

  useEffect(() => {
    if (settingsQuery.data) {
      setBaseModel(settingsQuery.data.baseModel);
      setInferenceModel(settingsQuery.data.inference.model);
      setPort(String(settingsQuery.data.inference.port));
      setMaxSeqLength(String(settingsQuery.data.qlora.maxSeqLength));
    }
  }, [settingsQuery.data]);

  const mutation = useMutation({ mutationFn: api.updateSettings });

  return (
    <div>
      <PageHeader title="Settings" description="Дефолтные параметры модели, inference и QLoRA." />
      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-slate-400">Base model</label>
            <Input value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Inference model</label>
            <Input value={inferenceModel} onChange={(e) => setInferenceModel(e.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Inference port</label>
              <Input value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Max seq length</label>
              <Input value={maxSeqLength} onChange={(e) => setMaxSeqLength(e.target.value)} />
            </div>
          </div>
          <Button onClick={() => mutation.mutate({ baseModel, qlora: { maxSeqLength: Number(maxSeqLength) }, inference: { model: inferenceModel, port: Number(port) } })} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save settings'}
          </Button>
          {mutation.data ? <p className="text-sm text-emerald-300">Saved.</p> : null}
          {mutation.error ? <p className="text-sm text-rose-300">{(mutation.error as Error).message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

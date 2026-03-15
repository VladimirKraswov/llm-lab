import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SyntheticGenType, type Job } from '../../lib/api';

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
        props.disabled
          ? 'cursor-not-allowed bg-slate-800 text-slate-500'
          : 'bg-blue-600 text-white hover:bg-blue-500'
      } ${props.className || ''}`}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 ${props.className || ''}`}
    />
  );
}

export function SyntheticGenWizard({ onComplete }: { onComplete: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [type, setType] = useState<SyntheticGenType>('qa');
  const [sourceFiles, setSourceFiles] = useState<{ filename: string; path: string }[]>([]);
  const [numPairs, setNumPairs] = useState(25);
  const [chunkSize, setChunkSize] = useState(4000);
  const [chunkOverlap, setChunkOverlap] = useState(200);
  const [curate, setCurate] = useState(true);
  const [curateThreshold, setCurateThreshold] = useState(7.0);
  const [jobId, setJobId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: runtime } = useQuery({
    queryKey: ['runtime'],
    queryFn: api.getRuntime,
    refetchInterval: 3000,
  });

  const { data: jobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.getJobs,
    refetchInterval: jobId ? 2000 : false,
  });

  const activeJob = jobId ? jobs?.find((j) => j.id === jobId) : null;

  const uploadMutation = useMutation({
    mutationFn: api.uploadSyntheticSource,
    onSuccess: (data) => {
      setSourceFiles((prev) => [...prev, { filename: data.filename, path: data.path }]);
    },
  });

  const startMutation = useMutation({
    mutationFn: api.startSyntheticGen,
    onSuccess: (data) => {
      setJobId(data.jobId);
      setStep(4);
    },
  });

  const isRuntimeReady = runtime?.inference?.probe?.ok;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const nextStep = () => setStep((s) => s + 1);
  const prevStep = () => setStep((s) => s - 1);

  useEffect(() => {
    if (activeJob?.status === 'completed') {
      setStep(5);
    }
  }, [activeJob?.status]);

  return (
    <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Create Synthetic Dataset</h2>
        <div className="text-sm text-slate-500">Step {step} of 5</div>
      </div>

      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= step ? 'bg-blue-600' : 'bg-slate-800'
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Dataset Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-synthetic-dataset" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Source Documents</label>
            <div className="space-y-2">
              {sourceFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-slate-950/50 p-3 text-sm">
                  <span className="text-white">{f.filename}</span>
                  <button
                    onClick={() => setSourceFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-6 text-slate-400 hover:bg-slate-950/50"
              >
                <span className="text-sm">Click to upload TXT, PDF, or JSON</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".txt,.pdf,.json,.jsonl,.md"
                  onChange={handleFileChange}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={nextStep} disabled={!name || sourceFiles.length === 0}>
              Next: Model & Runtime
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-950/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Inference Runtime</div>
                <div className="text-xs text-slate-400">Synthetic generation requires an active model</div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${isRuntimeReady ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="text-xs uppercase tracking-wider text-slate-300">
                  {isRuntimeReady ? 'Ready' : 'Not Running'}
                </span>
              </div>
            </div>
            {runtime?.inference?.model && (
              <div className="mt-3 text-sm text-slate-300">
                Active model: <span className="font-mono text-blue-400">{runtime.inference.model}</span>
              </div>
            )}
          </div>
          {!isRuntimeReady && (
            <div className="rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">
              Please start an inference model in the <span className="font-bold">Playground</span> or <span className="font-bold">Models</span> tab before continuing.
            </div>
          )}
          <div className="flex justify-between">
            <Button className="bg-slate-800 hover:bg-slate-700" onClick={prevStep}>
              Back
            </Button>
            <Button onClick={nextStep} disabled={!isRuntimeReady}>
              Next: Configuration
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Generation Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SyntheticGenType)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="qa">QA Pairs</option>
                <option value="summary">Summaries</option>
                <option value="cot">Chain of Thought</option>
                <option value="cot-enhance">CoT Enhance</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Target Samples</label>
              <Input type="number" value={numPairs} onChange={(e) => setNumPairs(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Chunk Size</label>
              <Input type="number" value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Chunk Overlap</label>
              <Input type="number" value={chunkOverlap} onChange={(e) => setChunkOverlap(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-slate-950/50 p-4">
            <input
              type="checkbox"
              id="curate"
              checked={curate}
              onChange={(e) => setCurate(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600"
            />
            <label htmlFor="curate" className="text-sm text-white">
              Enable Quality Curation (Llama-as-a-Judge)
            </label>
          </div>
          {curate && (
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Curation Threshold (1-10)</label>
              <Input
                type="number"
                step="0.1"
                min="1"
                max="10"
                value={curateThreshold}
                onChange={(e) => setCurateThreshold(Number(e.target.value))}
              />
            </div>
          )}
          <div className="flex justify-between pt-4">
            <Button className="bg-slate-800 hover:bg-slate-700" onClick={prevStep}>
              Back
            </Button>
            <Button
              onClick={() =>
                startMutation.mutate({
                  name,
                  type,
                  model: runtime?.inference?.model || '',
                  numPairs,
                  chunkSize,
                  chunkOverlap,
                  curate,
                  curateThreshold,
                  sourceFiles: sourceFiles.map((f) => f.path),
                })
              }
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? 'Starting...' : 'Start Generation Job'}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-950/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-medium text-white">Job Status: {activeJob?.status || 'queued'}</div>
                <div className="text-xs text-slate-400">Job ID: {jobId}</div>
              </div>
              {activeJob?.status === 'running' && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  <span className="text-xs uppercase tracking-wider text-blue-400">
                    {activeJob.progressStep || 'Processing'}
                  </span>
                </div>
              )}
            </div>

            <div className="h-64 overflow-auto rounded-lg bg-black p-3 font-mono text-xs text-slate-400">
              <pre className="whitespace-pre-wrap">
                {activeJob?.error ? (
                  <span className="text-rose-400">{activeJob.error}</span>
                ) : (
                  'Waiting for logs...\nInitializing pipeline...\n'
                )}
              </pre>
            </div>
          </div>
          {activeJob?.status === 'failed' && (
             <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => setStep(3)}>
                Try Again
             </Button>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="space-y-6 text-center">
          <div className="flex justify-center">
            <div className="rounded-full bg-emerald-500/10 p-4">
              <svg className="h-12 w-12 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">Generation Complete!</h3>
            <p className="mt-2 text-sm text-slate-400">
              Dataset "<span className="text-white font-medium">{name}</span>" has been created with{' '}
              <span className="text-white font-medium">{activeJob?.summaryMetrics?.rows || 0}</span> rows.
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <Button onClick={onComplete}>Back to Datasets</Button>
          </div>
        </div>
      )}
    </div>
  );
}

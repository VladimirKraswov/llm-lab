import { useQuery } from '@tanstack/react-query';
import type { Job } from '../lib/api';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

export function JobDetailsSynthetic({ job }: { job: Job }) {
  const meta = job.syntheticMeta;
  const imp = meta?.import;

  const previewQuery = useQuery({
    queryKey: ['synthetic-job-preview', job.id],
    queryFn: () => api.getSyntheticJobPreview(job.id, 10),
    enabled: !!job.id && !!meta?.finalPath,
    refetchInterval: job.status === 'running' ? 3000 : false,
  });

  return (
    <div className="space-y-4">
      <Card className="border-cyan-500/20 bg-cyan-500/5">
        <CardHeader>
          <CardTitle>Synthetic Dataset Job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Step</div>
            <div className="mt-1 text-white">{meta?.progressStep || job.progressStep || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Result dataset</div>
            <div className="mt-1 text-white">{job.resultDatasetId || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Valid rows</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {imp?.validCount ?? job.summaryMetrics?.validCount ?? job.summaryMetrics?.rows ?? 0}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Invalid rows</div>
            <div className="mt-1 text-lg font-semibold text-white">
              {imp?.invalidCount ?? job.summaryMetrics?.invalidCount ?? 0}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3 md:col-span-2">
            <div className="text-xs text-slate-500">Detected formats</div>
            <div className="mt-1 text-white">
              {imp?.detectedFormats?.length ? imp.detectedFormats.join(', ') : '—'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3 md:col-span-2">
            <div className="text-xs text-slate-500">Final file</div>
            <div className="mt-1 break-all font-mono text-xs text-slate-300">{meta?.finalPath || '—'}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sample row before import</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[320px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-200">
            {imp?.sampleParsed
              ? JSON.stringify(imp.sampleParsed, null, 2)
              : imp?.sampleLine || 'No sample available'}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview of final synthetic file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!meta?.finalPath ? (
            <div className="text-sm text-slate-500">Final synthetic file is not available yet.</div>
          ) : previewQuery.isLoading ? (
            <div className="text-sm text-slate-500">Loading preview…</div>
          ) : previewQuery.error ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
              {(previewQuery.error as Error).message}
            </div>
          ) : previewQuery.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-4 text-sm">
                <div className="rounded-xl bg-slate-950/40 p-3">
                  <div className="text-xs text-slate-500">Total lines</div>
                  <div className="mt-1 text-white">{previewQuery.data.totalLines}</div>
                </div>
                <div className="rounded-xl bg-slate-950/40 p-3">
                  <div className="text-xs text-slate-500">Valid</div>
                  <div className="mt-1 text-white">{previewQuery.data.validCount}</div>
                </div>
                <div className="rounded-xl bg-slate-950/40 p-3">
                  <div className="text-xs text-slate-500">Invalid</div>
                  <div className="mt-1 text-white">{previewQuery.data.invalidCount}</div>
                </div>
                <div className="rounded-xl bg-slate-950/40 p-3">
                  <div className="text-xs text-slate-500">Formats</div>
                  <div className="mt-1 text-white">
                    {previewQuery.data.detectedFormats?.join(', ') || '—'}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {previewQuery.data.preview.map((row, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <div className="mb-2 text-xs text-slate-500">
                      Line {row.line} · {row.sourceFormat}
                    </div>
                    <pre className="max-h-[220px] overflow-auto rounded-lg bg-black/20 p-3 text-xs text-slate-300">
                      {JSON.stringify(row.original, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">No preview available.</div>
          )}
        </CardContent>
      </Card>

      {job.error ? (
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader>
            <CardTitle>Import error</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-rose-500/20 bg-slate-950/60 p-3 text-sm text-rose-200">
              {job.error}
            </div>

            {imp?.invalidSamples?.length ? (
              <div className="space-y-3">
                <div className="text-sm font-medium text-white">First invalid rows</div>
                {imp.invalidSamples.map((sample, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="mb-2 text-xs text-slate-400">Line {sample.line}</div>
                    <div className="mb-2 text-sm text-rose-300">{sample.error}</div>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">
                      {sample.raw}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
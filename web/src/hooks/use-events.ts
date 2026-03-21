import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createEventsSource } from '../lib/api';

type LogCache = {
  id?: string;
  logFile?: string;
  content: string;
  offset?: number;
};

function mergeLogChunk(previous: string, incoming: string) {
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (previous.endsWith(incoming)) return previous;

  const maxOverlap = Math.min(previous.length, incoming.length, 4000);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === incoming.slice(0, overlap)) {
      return previous + incoming.slice(overlap);
    }
  }

  return previous + incoming;
}

export function useEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = createEventsSource();

    const invalidateAll = () => {
      queryClient.invalidateQueries();
    };

    const invalidateJob = (jobId?: string) => {
      if (!jobId) return;
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    };

    source.addEventListener('job_updated', invalidateAll);

    source.addEventListener('job_progress', (event: MessageEvent) => {
      try {
        const { payload } = JSON.parse(event.data) as { payload?: { jobId?: string } };
        invalidateJob(payload?.jobId);
      } catch (error) {
        console.error('Failed to handle job_progress event', error);
      }
    });

    source.addEventListener('job_finalized', (event: MessageEvent) => {
      try {
        const { payload } = JSON.parse(event.data) as { payload?: { id?: string; jobId?: string } };
        invalidateJob(payload?.id || payload?.jobId);
      } catch (error) {
        console.error('Failed to handle job_finalized event', error);
      }
    });

    source.addEventListener('job_log_chunk', (event: MessageEvent) => {
      try {
        const { payload } = JSON.parse(event.data) as {
          payload?: { jobId?: string; logs?: string; offset?: number; logFile?: string };
        };

        const jobId = payload?.jobId;
        const logs = payload?.logs || '';
        const offset = payload?.offset;
        const logFile = payload?.logFile;
        if (!jobId || !logs) return;

        queryClient.setQueryData(['job-logs', jobId], (old: LogCache | undefined) => {
          const previous = old?.content || '';
          const currentOffset = typeof old?.offset === 'number' ? old.offset : previous.length;

          if (typeof offset === 'number') {
            if (offset < currentOffset) {
              return old || { id: jobId, logFile, content: previous, offset: currentOffset };
            }

            if (offset === currentOffset) {
              const merged = mergeLogChunk(previous, logs);
              return {
                id: jobId,
                logFile: logFile || old?.logFile,
                content: merged,
                offset: offset + logs.length,
              };
            }
          }

          const merged = mergeLogChunk(previous, logs);
          return {
            id: jobId,
            logFile: logFile || old?.logFile,
            content: merged,
            offset: typeof offset === 'number' ? offset + logs.length : merged.length,
          };
        });
      } catch (error) {
        console.error('Failed to handle job_log_chunk event', error);
      }
    });

    source.addEventListener('dataset_created', invalidateAll);
    source.addEventListener('dataset_deleted', invalidateAll);
    source.addEventListener('runtime_started', invalidateAll);
    source.addEventListener('runtime_stopped', invalidateAll);
    source.addEventListener('model_updated', invalidateAll);
    source.addEventListener('model_deleted', invalidateAll);
    source.addEventListener('lora_created', invalidateAll);
    source.addEventListener('lora_updated', invalidateAll);
    source.addEventListener('lora_deleted', invalidateAll);
    source.addEventListener('lora_activated', invalidateAll);
    source.addEventListener('lora_deactivated', invalidateAll);

    source.onerror = (event) => {
      console.warn('Events stream disconnected, waiting for automatic reconnect.', event);
    };

    return () => {
      source.close();
    };
  }, [queryClient]);
}

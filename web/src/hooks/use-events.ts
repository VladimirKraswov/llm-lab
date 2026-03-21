import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createEventsSource } from '../lib/api';

function appendLogChunk(existing: string, chunk: string) {
  const current = String(existing || '');
  const addition = String(chunk || '');

  if (!addition) return current;
  if (!current) return addition;
  if (current.endsWith(addition)) return current;

  const maxOverlap = Math.min(current.length, addition.length, 4000);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (current.endsWith(addition.slice(0, size))) {
      return current + addition.slice(size);
    }
  }

  const recentTail = current.slice(-Math.min(current.length, addition.length * 2));
  if (recentTail.includes(addition)) {
    return current;
  }

  return current + addition;
}

export function useEvents(token?: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) {
      return;
    }

    const source = createEventsSource();

    const invalidate = () => {
      queryClient.invalidateQueries();
    };

    source.addEventListener('job_updated', invalidate);
    source.addEventListener('job_progress', (e: MessageEvent) => {
      try {
        const { payload } = JSON.parse(e.data) as { payload: { jobId: string } };
        queryClient.invalidateQueries({ queryKey: ['job', payload.jobId] });
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
      } catch (err) {
        console.error('Failed to handle job_progress event', err);
      }
    });

    source.addEventListener('job_finalized', (e: MessageEvent) => {
      try {
        const { payload } = JSON.parse(e.data) as { payload: { id: string } };
        queryClient.invalidateQueries({ queryKey: ['job', payload.id] });
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
      } catch (err) {
        console.error('Failed to handle job_finalized event', err);
      }
    });

    source.addEventListener('job_log_chunk', (e: MessageEvent) => {
      try {
        const { payload } = JSON.parse(e.data) as { payload: { jobId: string; logs: string } };
        const { jobId, logs } = payload;
        queryClient.setQueryData(['job-logs', jobId], (old: { id: string; content: string } | undefined) => {
          if (!old) {
            return { id: jobId, content: logs };
          }

          return {
            ...old,
            content: appendLogChunk(old.content || '', logs || ''),
          };
        });
      } catch (err) {
        console.error('Failed to handle job_log_chunk event', err);
      }
    });

    source.addEventListener('dataset_created', invalidate);
    source.addEventListener('dataset_deleted', invalidate);
    source.addEventListener('runtime_started', invalidate);
    source.addEventListener('runtime_stopped', invalidate);
    source.addEventListener('model_updated', invalidate);
    source.addEventListener('model_deleted', invalidate);
    source.addEventListener('lora_created', invalidate);
    source.addEventListener('lora_updated', invalidate);
    source.addEventListener('lora_deleted', invalidate);
    source.addEventListener('lora_activated', invalidate);
    source.addEventListener('lora_deactivated', invalidate);

    source.onerror = (err) => {
      console.warn('Events stream disconnected, waiting for automatic reconnect.', err);
    };

    return () => {
      source.close();
    };
  }, [queryClient, token]);
}

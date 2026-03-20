import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createEventsSource } from '../lib/api';

export function useEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
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
          if (!old) return { id: jobId, content: logs };
          return {
            ...old,
            content: (old.content || '') + logs,
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

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [queryClient]);
}
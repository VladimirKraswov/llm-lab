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
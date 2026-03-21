import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiBase } from '../lib/api';

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

type StreamEvent = {
  event: string;
  data: string;
};

function parseSseChunk(buffer: string): { events: StreamEvent[]; rest: string } {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() || '';
  const events: StreamEvent[] = [];

  for (const raw of parts) {
    const lines = raw.split(/\n/);
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      const normalized = line.replace(/\r$/, '');
      if (!normalized || normalized.startsWith(':')) continue;
      if (normalized.startsWith('event:')) {
        event = normalized.slice(6).trim() || 'message';
        continue;
      }
      if (normalized.startsWith('data:')) {
        dataLines.push(normalized.slice(5).trimStart());
      }
    }

    if (dataLines.length) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }

  return { events, rest };
}

export function useEvents(token?: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const invalidate = () => {
      queryClient.invalidateQueries();
    };

    const handleEvent = (eventName: string, data: string) => {
      try {
        if (eventName === 'job_updated') {
          invalidate();
          return;
        }

        if (eventName === 'job_progress') {
          const { payload } = JSON.parse(data) as { payload: { jobId: string } };
          queryClient.invalidateQueries({ queryKey: ['job', payload.jobId] });
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
          return;
        }

        if (eventName === 'job_finalized') {
          const { payload } = JSON.parse(data) as { payload: { id: string } };
          queryClient.invalidateQueries({ queryKey: ['job', payload.id] });
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
          return;
        }

        if (eventName === 'job_log_chunk') {
          const { payload } = JSON.parse(data) as { payload: { jobId: string; logs: string } };
          const { jobId, logs } = payload;
          queryClient.setQueryData(['job-logs', jobId], (old: { id: string; content: string } | undefined) => {
            if (!old) return { id: jobId, content: logs };
            return {
              ...old,
              content: appendLogChunk(old.content || '', logs || ''),
            };
          });
          return;
        }

        if (
          eventName === 'dataset_created' ||
          eventName === 'dataset_deleted' ||
          eventName === 'runtime_started' ||
          eventName === 'runtime_stopped' ||
          eventName === 'model_updated' ||
          eventName === 'model_deleted' ||
          eventName === 'lora_created' ||
          eventName === 'lora_updated' ||
          eventName === 'lora_deleted' ||
          eventName === 'lora_activated' ||
          eventName === 'lora_deactivated'
        ) {
          invalidate();
        }
      } catch (err) {
        console.error(`Failed to handle SSE event: ${eventName}`, err);
      }
    };

    const connect = async () => {
      try {
        const response = await fetch(`${apiBase}/events`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            console.warn('Events stream authorization failed. Falling back to polling-only mode.');
            return;
          }
          throw new Error(`Events stream HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Events stream body is empty');
        }

        attempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          for (const item of parsed.events) {
            handleEvent(item.event, item.data);
          }
        }

        if (!controller.signal.aborted) {
          attempt += 1;
          const delay = Math.min(10000, 1000 * Math.max(1, attempt));
          reconnectTimer = window.setTimeout(() => {
            void connect();
          }, delay);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        attempt += 1;
        const delay = Math.min(10000, 1000 * Math.max(1, attempt));
        console.warn('Events stream disconnected, retrying with fetch SSE.', err);
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, delay);
      }
    };

    void connect();

    return () => {
      controller.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [queryClient, token]);
}

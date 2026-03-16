import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ResponseRenderer } from '../../components/response-renderer';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
};

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

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 ${props.className || ''}`}
    />
  );
}

export default function PlaygroundPage() {
  const runtimeQuery = useQuery({
    queryKey: ['runtime'],
    queryFn: api.getRuntime,
    refetchInterval: 3000,
  });

  const healthQuery = useQuery({
    queryKey: ['runtime-health'],
    queryFn: api.getRuntimeHealth,
    refetchInterval: 3000,
  });

  const activeRuntime = useMemo(
    () => runtimeQuery.data?.inference || runtimeQuery.data?.vllm,
    [runtimeQuery.data]
  );

  const [input, setInput] = useState(
    'Напиши пример на Python с fibonacci, потом покажи SQL запрос и кратко объясни оба блока.'
  );
  const [temperature, setTemperature] = useState('0.2');
  const [maxTokens, setMaxTokens] = useState('512');
  const [messages, setMessages] = useState<Msg[]>([]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const nextMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setIsStreaming(true);
    setError(null);

    try {
      // Не передаём model принудительно.
      // Бэкенд сам выберет:
      // activeLoraName -> если LoRA активна
      // иначе base model.
      const stream = await api.chatStream({
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
      });

      if (!stream) throw new Error('No response body');

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let buffer = '';
      let doneReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              doneReceived = true;
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (!content) continue;

              assistantText += content;

              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  last.content = assistantText;
                }
                return next;
              });
            } catch (e) {
              console.error('Error parsing SSE:', e, data);
            }
          }
        }

        if (doneReceived) break;
      }

      if (!assistantText) {
        setError(
          'Model returned an empty response. Check that the active runtime is healthy and that the selected LoRA is actually loaded into vLLM.'
        );
      }
    } catch (err) {
      const errMsg = String((err as Error)?.message || err);
      setError(errMsg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Playground</h1>
        <p className="mt-1 text-sm text-slate-400">
          Проверяй base model или model + LoRA прямо в UI.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="text-sm font-semibold text-white">Runtime</div>

          <div className="flex gap-2">
            <div className="flex-1 rounded-xl bg-slate-950/40 p-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Health
              </div>
              <div className={`text-sm font-medium ${healthQuery.data?.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {healthQuery.data?.ok ? 'Healthy' : (activeRuntime?.pid ? 'Starting...' : 'Offline')}
              </div>
            </div>

            <div className="flex-1 rounded-xl bg-slate-950/40 p-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Provider
              </div>
              <div className="text-sm font-medium capitalize text-white">
                {activeRuntime?.providerResolved || '—'}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Active model
            </div>
            <div className="break-words text-sm text-white">
              {activeRuntime?.activeModelName || activeRuntime?.baseModel || '—'}
            </div>
            {activeRuntime?.activeLoraName && (
              <div className="mt-1 text-xs font-medium text-blue-400">
                + {activeRuntime.activeLoraName}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Serving path
            </div>
            <div className="mt-1 break-all text-[11px] font-mono text-slate-400">
              {activeRuntime?.model || 'None'}
            </div>
          </div>

          {activeRuntime?.probe && (
            <div
              className={`rounded-xl border p-3 ${
                activeRuntime.probe.ok
                  ? 'border-emerald-900/50 bg-emerald-950/20'
                  : 'border-rose-900/50 bg-rose-950/20'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Model Probe
                </span>
                {activeRuntime.probe.ok ? (
                  <CheckCircle2 size={12} className="text-emerald-500" />
                ) : (
                  <AlertCircle size={12} className="text-rose-500" />
                )}
              </div>

              <div className="text-sm font-medium text-white">
                {activeRuntime.probe.status === 'checking'
                  ? 'Checking...'
                  : activeRuntime.probe.ok
                    ? 'Verified'
                    : 'Failed'}
              </div>

              {activeRuntime.probe.error && (
                <div className="mt-1 text-[10px] leading-tight text-rose-400">
                  {activeRuntime.probe.error}
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Temperature
            </label>
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Max tokens
            </label>
            <input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs leading-relaxed text-slate-400">
            <span className="mb-1 block font-semibold text-slate-500">Test prompts:</span>
            • Create a profile card component in React
            <br />
            • Write a Dockerfile for a Python app
            <br />
            • Explain Fibonacci in 3 sentences
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Chat</div>
            {error && (
              <div className="flex items-center gap-1 text-xs font-medium text-rose-400">
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>

          <div className="mb-4 h-[560px] flex-1 overflow-auto rounded-2xl border border-slate-900 bg-slate-950 p-4 shadow-inner">
            {!messages.length ? (
              <div className="flex h-full items-center justify-center text-sm italic text-slate-600">
                No messages yet. Send a prompt to start.
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((m, idx) => (
                  <div key={idx} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    {m.role === 'user' ? (
                      <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-3 text-sm text-white shadow-md">
                        {m.content}
                      </div>
                    ) : (
                      <div className="inline-block max-w-[92%] rounded-2xl border border-slate-800 bg-slate-900 px-5 py-5 text-left align-top text-slate-100 shadow-xl shadow-black/40">
                        <ResponseRenderer content={m.content} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Textarea
              className="min-h-[110px] shadow-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message here..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  sendMessage();
                }
              }}
            />
            <div className="flex gap-3">
              <Button onClick={sendMessage} disabled={!activeRuntime?.pid || isStreaming}>
                {isStreaming ? 'Generating…' : 'Send Message'}
              </Button>

              <Button
                className="bg-slate-800 hover:bg-slate-700"
                onClick={() => setMessages([])}
                disabled={!messages.length}
              >
                Clear Chat
              </Button>

              <span className="ml-auto hidden self-center text-[10px] text-slate-600 md:block">
                Press Ctrl + Enter to send
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
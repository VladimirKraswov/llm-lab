import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

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

  const [input, setInput] = useState('Скажи привет');
  const [temperature, setTemperature] = useState('0.2');
  const [maxTokens, setMaxTokens] = useState('128');
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
      const stream = await api.chatStream({
        model: runtimeQuery.data?.vllm?.model || undefined,
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
      });

      if (!stream) throw new Error('No response body');
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.includes(': ping')) continue;
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
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
      }
    } catch (err) {
      const errMsg = String((err as Error)?.message || err);
      setError(errMsg);
      setMessages((prev) => prev.slice(0, -1)); // Remove the empty assistant message if error occurred
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

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Health</div>
            <div className="mt-1 text-sm text-white">{healthQuery.data?.ok ? 'healthy' : 'not ready'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Base model</div>
            <div className="mt-1 text-sm text-white">{runtimeQuery.data?.vllm.baseModel || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Active model</div>
            <div className="mt-1 text-sm text-white">{runtimeQuery.data?.vllm.activeModelName || '—'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Active LoRA</div>
            <div className="mt-1 text-sm text-white">{runtimeQuery.data?.vllm.activeLoraName || 'None'}</div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Serving path</div>
            <div className="mt-1 break-all text-sm text-white">{runtimeQuery.data?.vllm.model || 'No runtime model'}</div>
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Temperature</label>
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">Max tokens</label>
            <input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
            Для smoke test попробуй:
            <div className="mt-2 text-slate-300">Скажи привет</div>
            <div className="text-slate-300">2+2?</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Chat</div>
            {error && <div className="text-xs text-red-500 font-medium">Error: {error}</div>}
          </div>

          <div className="mb-4 h-[460px] overflow-auto rounded-2xl bg-slate-950 p-4">
            {!messages.length ? (
              <div className="text-sm text-slate-500">No messages yet.</div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, idx) => (
                  <div key={idx} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                    <div
                      className={`inline-block max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-100'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Textarea
              className="min-h-[110px]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Напиши сообщение модели..."
            />
            <div className="flex gap-3">
              <Button onClick={sendMessage} disabled={!runtimeQuery.data?.vllm?.model || isStreaming}>
                Send
              </Button>
              <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => setMessages([])}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
import { useState } from 'react';
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

      if (!assistantText) {
        setError('Model returned an empty response. This might be a compatibility issue with the current quantization or vLLM version.');
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
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Health</div>
              <div className={`text-sm font-medium ${healthQuery.data?.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {healthQuery.data?.ok ? 'Healthy' : (runtimeQuery.data?.vllm.pid ? 'Starting...' : 'Offline')}
              </div>
            </div>
            <div className="flex-1 rounded-xl bg-slate-950/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Provider</div>
              <div className="text-sm font-medium text-white capitalize">{runtimeQuery.data?.vllm.providerResolved || '—'}</div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Active model</div>
            <div className="text-sm text-white break-words">{runtimeQuery.data?.vllm.activeModelName || '—'}</div>
            {runtimeQuery.data?.vllm.activeLoraName && (
               <div className="mt-1 text-xs text-blue-400 font-medium">+ {runtimeQuery.data.vllm.activeLoraName}</div>
            )}
          </div>

          <div className="rounded-xl bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Serving path</div>
            <div className="mt-1 break-all text-[11px] font-mono text-slate-400">
              {runtimeQuery.data?.vllm.model || 'None'}
            </div>
          </div>

          {runtimeQuery.data?.vllm?.probe && (
            <div className={`rounded-xl p-3 border ${runtimeQuery.data.vllm.probe.ok ? 'bg-emerald-950/20 border-emerald-900/50' : 'bg-rose-950/20 border-rose-900/50'}`}>
               <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Model Probe</span>
                  {runtimeQuery.data.vllm.probe.ok ? <CheckCircle2 size={12} className="text-emerald-500" /> : <AlertCircle size={12} className="text-rose-500" />}
               </div>
               <div className="text-sm text-white font-medium">
                 {runtimeQuery.data.vllm.probe.status === 'checking' ? 'Checking...' : (runtimeQuery.data.vllm.probe.ok ? 'Verified' : 'Failed')}
               </div>
               {runtimeQuery.data.vllm.probe.error && <div className="mt-1 text-[10px] text-rose-400 leading-tight">{runtimeQuery.data.vllm.probe.error}</div>}
            </div>
          )}

          <div className="pt-2">
            <label className="mb-2 block text-[10px] uppercase tracking-wider font-bold text-slate-500">
              Temperature
            </label>
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-wider font-bold text-slate-500">
              Max tokens
            </label>
            <input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400 leading-relaxed">
            <span className="text-slate-500 font-semibold mb-1 block">Test prompts:</span>
            • Create a profile card component in React<br/>
            • Write a Dockerfile for a Python app<br/>
            • Explain Fibonacci in 3 sentences
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Chat</div>
            {error && <div className="text-xs font-medium text-rose-400 flex items-center gap-1"><AlertCircle size={14}/> {error}</div>}
          </div>

          <div className="mb-4 flex-1 h-[560px] overflow-auto rounded-2xl bg-slate-950 p-4 border border-slate-900 shadow-inner">
            {!messages.length ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-600 italic">
                No messages yet. Send a prompt to start.
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((m, idx) => (
                  <div key={idx} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    {m.role === 'user' ? (
                      <div className="inline-block max-w-[85%] rounded-2xl bg-blue-600 px-4 py-3 text-sm whitespace-pre-wrap text-white shadow-md">
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
              <Button onClick={sendMessage} disabled={!runtimeQuery.data?.vllm?.pid || isStreaming}>
                {isStreaming ? 'Generating…' : 'Send Message'}
              </Button>
              <Button className="bg-slate-800 hover:bg-slate-700" onClick={() => setMessages([])} disabled={!messages.length}>
                Clear Chat
              </Button>
              <span className="text-[10px] text-slate-600 self-center ml-auto hidden md:block">
                Press Ctrl + Enter to send
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

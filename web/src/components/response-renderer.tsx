import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

function detectLanguage(className?: string) {
  const match = /language-([\w-]+)/.exec(className || '');
  return match?.[1] || 'text';
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function CopyButton({
  value,
  label = 'Copy',
  className = '',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch (err) {
          console.error('Copy failed', err);
        }
      }}
      className={`inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 ${className}`}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function ResponseRenderer({ content }: { content: string }) {
  const normalized = useMemo(() => String(content || '').trim(), [content]);

  if (!normalized) {
    return <div className="text-sm text-slate-400">...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CopyButton value={normalized} label="Copy answer" />
      </div>

      <div className="prose prose-invert max-w-none prose-p:my-3 prose-pre:my-0 prose-code:text-slate-100 prose-strong:text-white prose-headings:text-white prose-a:text-blue-300 prose-li:marker:text-slate-500">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="whitespace-pre-wrap leading-7 text-slate-100">{children}</p>,
            ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-6 text-slate-100">{children}</ul>,
            ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-6 text-slate-100">{children}</ol>,
            li: ({ children }) => <li className="leading-7">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="my-4 border-l-4 border-slate-700 pl-4 italic text-slate-300">
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div className="my-4 overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-slate-900/80">{children}</thead>,
            th: ({ children }) => (
              <th className="border-b border-slate-800 px-3 py-2 text-left font-semibold text-slate-100">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-b border-slate-900 px-3 py-2 align-top text-slate-200">{children}</td>
            ),
            code(props) {
              const { className, children, ...rest } = props;
              const code = String(children ?? '');
              const isBlock = code.includes('\n') || Boolean(className);

              if (!isBlock) {
                return (
                  <code
                    {...rest}
                    className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[0.95em] text-cyan-300"
                  >
                    {code}
                  </code>
                );
              }

              const language = detectLanguage(className);
              const trimmed = code.replace(/\n$/, '');

              return (
                <div className="my-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {language}
                    </span>
                    <CopyButton value={trimmed} label="Copy code" />
                  </div>

                  <SyntaxHighlighter
                    {...rest}
                    language={language}
                    style={oneDark}
                    customStyle={{
                      margin: 0,
                      padding: '16px',
                      background: 'transparent',
                      fontSize: '0.875rem',
                      lineHeight: '1.6',
                    }}
                    wrapLongLines
                    PreTag="div"
                    codeTagProps={{
                      style: {
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                      },
                    }}
                  >
                    {trimmed}
                  </SyntaxHighlighter>
                </div>
              );
            },
          }}
        >
          {normalized}
        </ReactMarkdown>
      </div>
    </div>
  );
}
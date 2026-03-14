import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function classNameFromNode(node?: HastNode) {
  const className = node?.properties?.className;
  if (Array.isArray(className)) {
    return className.filter(Boolean).join(' ');
  }
  if (typeof className === 'string') {
    return className;
  }
  return '';
}

function detectLanguage(className: string) {
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] || 'text';
}

function extractText(node?: HastNode): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(extractText).join('');
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch (err) {
          console.error('Copy failed', err);
        }
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
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

      <div className="prose prose-invert max-w-none prose-headings:text-white prose-strong:text-white prose-p:text-slate-100 prose-li:text-slate-100 prose-a:text-blue-300 prose-blockquote:text-slate-300 prose-hr:border-slate-800">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            p: ({ children }) => (
              <p className="whitespace-pre-wrap leading-7 text-slate-100">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="my-3 list-disc space-y-2 pl-6 text-slate-100">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-3 list-decimal space-y-2 pl-6 text-slate-100">{children}</ol>
            ),
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
              <td className="border-b border-slate-900 px-3 py-2 align-top text-slate-200">
                {children}
              </td>
            ),
            pre: ({ children, node }) => {
              const codeNode = (node as HastNode | undefined)?.children?.[0];
              const className = classNameFromNode(codeNode);
              const language = detectLanguage(className);
              const rawCode = extractText(codeNode).replace(/\n$/, '');

              return (
                <div className="my-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {language}
                    </span>
                    <CopyButton value={rawCode} label="Copy code" />
                  </div>

                  <pre className="m-0 overflow-x-auto bg-transparent p-4 text-sm leading-6">
                    {children}
                  </pre>
                </div>
              );
            },
            code: ({ className, children }) => {
              const text = String(children ?? '');
              const isInline = !className;

              if (isInline) {
                return (
                  <code className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[0.95em] text-cyan-300">
                    {text}
                  </code>
                );
              }

              return (
                <code className={className}>
                  {children}
                </code>
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
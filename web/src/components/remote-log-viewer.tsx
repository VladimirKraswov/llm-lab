import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Pause, Play, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

type RemoteLogViewerProps = {
  title?: string;
  content: string;
  isLive?: boolean;
  onRefresh?: () => void;
};

function lineTone(line: string) {
  if (line.includes('[ERROR]') || /\berror\b/i.test(line)) return 'text-rose-300';
  if (line.includes('[WARN]') || /\bwarn\b/i.test(line)) return 'text-amber-300';
  if (line.includes('[SUCCESS]') || /success/i.test(line)) return 'text-emerald-300';
  return 'text-slate-300';
}

export function RemoteLogViewer({ title = 'Runtime logs', content, isLive = false, onRefresh }: RemoteLogViewerProps) {
  const [followTail, setFollowTail] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    const normalized = String(content || '').replace(/\r/g, '\n');
    return normalized.split('\n').filter((line, index, array) => line || index < array.length - 1);
  }, [content]);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element || !followTail) return;
    element.scrollTop = element.scrollHeight;
  }, [content, followTail]);

  const jumpToTail = () => {
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setFollowTail(true);
  };

  return (
    <Card className="flex min-h-[360px] flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
            {isLive ? 'Live stream' : 'History'} · {lines.length} lines
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setFollowTail((value) => !value)}>
            {followTail ? <Pause size={14} className="mr-1.5" /> : <Play size={14} className="mr-1.5" />}
            {followTail ? 'Pause tail' : 'Follow tail'}
          </Button>
          <Button size="sm" variant="outline" onClick={jumpToTail}>
            <ArrowDown size={14} className="mr-1.5" />
            Tail
          </Button>
          {onRefresh ? (
            <Button size="sm" variant="outline" onClick={onRefresh}>
              <RefreshCcw size={14} className="mr-1.5" />
              Refresh
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 bg-slate-950 p-0">
        <div ref={bodyRef} className="scrollbar-thin h-full max-h-[720px] overflow-auto px-3 py-3 font-mono text-[11px] leading-5">
          {!lines.length ? (
            <div className="px-2 py-1 text-slate-500">No logs yet.</div>
          ) : (
            lines.map((line, index) => (
              <div
                key={`${index}:${line.slice(0, 24)}`}
                className={cn('border-l border-transparent px-2 py-0.5 hover:border-slate-800 hover:bg-white/[0.03]', lineTone(line))}
              >
                {line || ' '}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

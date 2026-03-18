import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export function LogViewer({ title, content }: { title: string; content: string }) {
  return (
    <Card className="flex flex-col h-full overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between shrink-0">
        <CardTitle>{title}</CardTitle>
        <div className="text-[10px] text-slate-500 font-mono">Real-time output</div>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden bg-slate-950">
        <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-[11px] font-mono text-slate-300 leading-relaxed scrollbar-thin">
          {content || 'No logs yet.'}
        </pre>
      </CardContent>
    </Card>
  );
}

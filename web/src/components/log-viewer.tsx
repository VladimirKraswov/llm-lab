import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export function LogViewer({ title, content }: { title: string; content: string }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs text-slate-200">{content || 'No logs yet.'}</pre>
      </CardContent>
    </Card>
  );
}

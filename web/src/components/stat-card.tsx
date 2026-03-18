import { Card, CardContent } from './ui/card';

export function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <Card className="flex flex-col justify-center">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{title}</div>
        <div className="text-2xl font-bold tracking-tight text-white">{value}</div>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

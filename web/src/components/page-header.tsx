import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-white truncate">{title}</h1>
        <p className="mt-0.5 text-xs text-slate-500 truncate">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

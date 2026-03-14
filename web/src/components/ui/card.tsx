import type { PropsWithChildren } from 'react';
import { cn } from '../../lib/utils';

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl shadow-black/20', className)}>{children}</div>;
}

export function CardHeader({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('border-b border-slate-800 px-5 py-4', className)}>{children}</div>;
}

export function CardTitle({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <h3 className={cn('text-base font-semibold text-white', className)}>{children}</h3>;
}

export function CardContent({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

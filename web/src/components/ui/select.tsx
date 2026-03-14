import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-500', props.className)} />;
}

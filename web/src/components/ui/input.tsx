import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'default' | 'sm';
}

export function Input({ size = 'default', ...props }: InputProps) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-slate-500',
        size === 'sm' && 'px-2 py-1.5 text-xs rounded-lg',
        props.className
      )}
    />
  );
}

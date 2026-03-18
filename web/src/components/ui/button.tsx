import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  size?: 'default' | 'sm' | 'xs';
}

export function Button({ children, className, size = 'default', ...props }: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-3 py-1.5 text-xs rounded-lg',
        size === 'xs' && 'px-2 py-1 text-[10px] rounded-md',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  size?: 'default' | 'sm' | 'xs';
  variant?: 'default' | 'outline' | 'ghost' | 'danger';
}

export function Button({
  children,
  className,
  size = 'default',
  variant = 'default',
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-50',
        // Variants
        variant === 'default' && 'bg-white text-slate-950 hover:bg-slate-200 font-medium',
        variant === 'outline' && 'bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white',
        variant === 'ghost' && 'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-white',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-500',
        // Sizes
        size === 'default' && 'px-4 py-2 text-sm',
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

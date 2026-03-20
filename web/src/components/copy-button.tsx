import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface CopyButtonProps {
  text: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  children?: React.ReactNode;
}

export function CopyButton({ text, className, size = 'sm', showLabel = false, children }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const iconSize = size === 'sm' ? 12 : size === 'md' ? 16 : 20;

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2 py-1 text-slate-400 transition hover:bg-slate-700 hover:text-white',
        copied && 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      {showLabel && (
        <span className={cn('text-[10px] font-medium', size === 'md' && 'text-xs')}>
          {copied ? 'Copied' : (children || 'Copy')}
        </span>
      )}
    </button>
  );
}

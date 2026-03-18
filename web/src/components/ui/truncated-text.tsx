import { cn } from '../../lib/utils';

interface TruncatedTextProps {
  text: string;
  className?: string;
  showTooltip?: boolean;
}

export function TruncatedText({ text, className, showTooltip = true }: TruncatedTextProps) {
  return (
    <div
      className={cn("truncate min-w-0", className)}
      title={showTooltip ? text : undefined}
    >
      {text}
    </div>
  );
}

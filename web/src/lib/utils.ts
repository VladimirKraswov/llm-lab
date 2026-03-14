import clsx from 'clsx';

export function cn(...args: Array<string | false | null | undefined>) {
  return clsx(args);
}

export function fmtDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function truncate(value: string, max = 60) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

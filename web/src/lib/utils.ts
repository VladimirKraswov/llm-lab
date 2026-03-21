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

export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as T[];
    if (Array.isArray(record.data)) return record.data as T[];
    if (Array.isArray(record.results)) return record.results as T[];
  }

  return [];
}

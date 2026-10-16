import type { ReactNode } from 'react';
import type { Zone } from '../data/types';

export interface SegOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Segmented single-choice control (radio group). */
export function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
  wide,
  testId,
}: {
  label: string;
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <div className={`seg${wide ? ' wide' : ''}`} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} data-value={String(o.value)} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const ZONE_COLOR: Record<Zone, string> = {
  source: 'var(--c-euv)',
  scanner: 'var(--c-euv)',
  track: 'var(--c-track)',
  etch: 'var(--c-etch)',
};
export const ZONE_NAME: Record<Zone, string> = {
  source: 'EUV source module',
  scanner: 'EUV scanner',
  track: 'Track (outside scanner)',
  etch: 'Etch tool (outside scanner)',
};

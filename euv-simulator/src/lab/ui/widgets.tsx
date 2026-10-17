import { type ReactNode, useEffect, useId, useState } from 'react';

/** Number input with unit, slider and range validation. Out-of-range values are clamped when committed. */
export function NumberField(props: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  log?: boolean;
  slider?: boolean;
  hint?: string;
  testid?: string;
  onChange: (v: number) => void;
}) {
  const { label, unit, value, min, max, step, log, slider = true, hint, testid, onChange } = props;
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (s: string) => {
    const v = Number(s);
    if (!Number.isFinite(v)) {
      setText(String(value));
      return;
    }
    const c = Math.min(max, Math.max(min, v));
    setText(String(c));
    if (c !== value) onChange(c);
  };
  const toSlider = (v: number) => (log ? Math.log10(v) : v);
  const fromSlider = (s: number) => {
    if (!log) return s;
    const v = Math.pow(10, s);
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / mag) * mag;
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {unit && <span className="unit"> [{unit}]</span>}
      </label>
      <div className="field-row">
        {slider && (
          <input
            type="range"
            aria-label={`${label} slider`}
            min={toSlider(min)}
            max={toSlider(max)}
            step={log ? 0.01 : step}
            value={toSlider(value)}
            onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
          />
        )}
        <input
          id={id}
          data-testid={testid}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
        />
      </div>
      {hint && <div className="atl-hint">{hint}</div>}
    </div>
  );
}

export function SelectField<T extends string | number>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testid?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        data-testid={props.testid}
        value={String(props.value)}
        onChange={(e) => {
          const o = props.options.find((o) => String(o.value) === e.target.value);
          if (o) props.onChange(o.value);
        }}
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      {props.hint && <div className="atl-hint">{props.hint}</div>}
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" data-testid={props.testid} checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Section(props: { title: string; children: ReactNode; open?: boolean; testid?: string }) {
  return (
    <details className="section" open={props.open} data-testid={props.testid}>
      <summary>{props.title}</summary>
      <div className="section-body">{props.children}</div>
    </details>
  );
}

export function Stat(props: { label: string; value: ReactNode; unit?: string; testid?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`stat${props.tone ? ` ${props.tone}` : ''}`}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value" data-testid={props.testid}>
        {props.value}
        {props.unit && <span className="unit"> {props.unit}</span>}
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import type { EquationDef } from '../data/types';

/** Mini markup used in the content files: x_{sub}, x_sub, x^{sup}. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /([_^])(?:\{([^}]*)\}|([A-Za-z0-9]+))/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const body = m[2] ?? m[3];
    out.push(m[1] === '_' ? <sub key={k++}>{body}</sub> : <sup key={k++}>{body}</sup>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function EquationCard({ eq }: { eq: EquationDef }) {
  return (
    <div className="eq">
      <div className="eq-title">{eq.title}</div>
      <div className="eq-formula" role="math" aria-label={eq.tex.replace(/[_^{}]/g, '')}>
        <Rich text={eq.tex} />
      </div>
      {eq.vars.length > 0 && (
        <dl className="eq-vars">
          {eq.vars.map(([sym, meaning, unit], i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt>
                <Rich text={sym} />
              </dt>
              <dd>
                {meaning}
                {unit ? <span className="eq-unit">{unit}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {eq.example && (
        <p className="eq-example">
          <b>Example</b>
          {eq.example}
        </p>
      )}
      {eq.note && <p className="eq-note">{eq.note}</p>}
    </div>
  );
}

/** The design system's main-screen visuals, as its Datasets and Experiments screens draw them
 * (ADR-0061): solid bars, name–bar–value rows, key–value rows, SVG lines and parallel
 * coordinates. Values come from the design's own markup; see .sv-* in cockpit.css. */

/** Solid bars side by side, scaled to the tallest: grey, red where `warn` says. */
export function SolidBars({ name, values, warn, height = 120 }: { name: string; values: number[]; warn?: (i: number) => boolean; height?: number }) {
  const top = Math.max(...values, Number.MIN_VALUE);
  return (
    <div className="sv-bars" role="img" aria-label={name} style={{ height }}>
      {values.map((v, i) => (
        <div key={i} data-testid="bar" className={warn?.(i) ? "warn" : undefined} style={{ height: `${Math.round((v / top) * 100)}%` }} />
      ))}
    </div>
  );
}

export type MeterRow = { name: string; share: number; value: string; warn?: boolean };

/** One row per item: its name, a thin bar for its share, its value on the right. */
export function MeterRows({ label, rows }: { label: string; rows: MeterRow[] }) {
  return (
    <ul className="sv-meters" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} className={r.warn ? "warn" : undefined}>
          <span className="sv-meter-name" title={r.name}>
            {r.name}
          </span>
          <span className="sv-meter-track">
            <span data-testid="fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, r.share)) * 100)}%` }} />
          </span>
          <span className="sv-meter-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Settings as rows: the name in grey, the value on the right. */
export function KeyValues({ label, rows }: { label: string; rows: [string, string][] }) {
  return (
    <ul className="sv-keys" aria-label={label}>
      {rows.map(([k, v]) => (
        <li key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </li>
      ))}
    </ul>
  );
}

const W = 480;
const H = 200;
const L = 40;
const B = 24;
const T = 10;

/** Series as lines over shared x positions, the first bright, the others dimmer; the axis
 * spans the values, named at both ends. */
export function LineChart({ name, series, xLabel }: { name: string; series: { name: string; values: number[] }[]; xLabel: string }) {
  const all = series.flatMap((s) => s.values);
  const hi = Math.max(...all);
  const lo = Math.min(...all);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - 10);
  const y = (v: number) => T + (hi === lo ? 0.5 : 1 - (v - lo) / (hi - lo)) * (H - T - B);
  return (
    <div className="sv-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name}>
        <path d={`M${L} ${T}V${H - B}H${W - 10}`} className="sv-axis" />
        <text x={L - 6} y={T + 8} textAnchor="end" className="sv-tick">{fmt(hi)}</text>
        <text x={L - 6} y={H - B} textAnchor="end" className="sv-tick">{fmt(lo)}</text>
        <text x={(L + W) / 2} y={H - 6} textAnchor="middle" className="sv-tick">{xLabel}</text>
        {series.map((s, k) => (
          <polyline key={s.name} className={k === 0 ? "sv-line first" : "sv-line"} points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
        ))}
      </svg>
      <ul className="sv-legend" aria-label={`${name} legend`}>
        {series.map((s, k) => (
          <li key={s.name} className={k === 0 ? "first" : undefined}>
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The design's parallel coordinates: an axis per setting and the score, each trial a faint
 * line, the best bright with its points marked. `lines` hold values from 0 to 1. */
export function ParallelChart({ name, axes, lines, best }: { name: string; axes: string[]; lines: number[][]; best: number }) {
  const w = Math.max(320, 127 * axes.length);
  const h = 250;
  const x = (i: number) => 56 + i * ((w - 112) / Math.max(1, axes.length - 1));
  const y = (v: number) => 20 + (1 - v) * 200;
  const points = (line: number[]) => line.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="sv-scroll">
      <svg width={w} height={h} role="img" aria-label={name}>
        {axes.map((a, i) => (
          <g key={a}>
            <path d={`M${x(i)} 20V220`} className="sv-axis" />
            <text x={x(i)} y={240} textAnchor="middle" className="sv-tick">{a}</text>
          </g>
        ))}
        {lines.map((line, i) => (
          <polyline key={i} className={i === best ? "best" : undefined} points={points(line)} />
        ))}
        {lines[best]?.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} className="sv-point" />)}
      </svg>
    </div>
  );
}

function fmt(v: number): string {
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Number(v.toPrecision(3)));
}

import { formatMetric } from "../NodeFact.tsx";

/** One metric, with its change since the step's previous run. */
export function MetricTile({ name, value, before }: { name: string; value: number; before: number | undefined }) {
  const delta = before === undefined ? undefined : value - before;
  return (
    <div className="metric-tile" role="group" aria-label={name}>
      <span className="metric-name">{name}</span>
      <span className="metric-value">{formatMetric(value)}</span>
      <span className="metric-delta">
        {delta === undefined ? "first run" : delta === 0 ? "same as last run" : `${delta > 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta))} vs last run`}
      </span>
    </div>
  );
}

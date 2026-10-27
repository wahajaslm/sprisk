import { formatMetric } from "../NodeFact.tsx";

/** The headline metrics side by side, wrapping when the panel is narrow. */
export const METRIC_ROW = { display: "flex", flexWrap: "wrap", gap: "16px 40px" } as const;
/** The line under the metrics: what was scored, on how many rows. */
export const METRIC_CAPTION = { margin: "0", fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" } as const;

/** One metric as the design's page-header number, with its change since the step's previous run. */
export function MetricTile({ name, value, before }: { name: string; value: number; before: number | undefined }) {
  const delta = before === undefined ? undefined : value - before;
  return (
    <div role="group" aria-label={name} style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
      <span style={{ fontSize: "12.5px", color: "var(--t-label,#959595)" }}>{name}</span>
      <span style={{ fontSize: "26px", letterSpacing: "-0.025em", lineHeight: "1.1", fontVariantNumeric: "tabular-nums", color: "var(--t-primary,#f2f2f2)" }}>{formatMetric(value)}</span>
      <span style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums", color: "var(--t-faint,#8c8c8c)" }}>
        {delta === undefined ? "first run" : delta === 0 ? "same as last run" : `${delta > 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta))} vs last run`}
      </span>
    </div>
  );
}

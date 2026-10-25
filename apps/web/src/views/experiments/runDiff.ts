import { formatMetric } from "../NodeFact.tsx";

/** The metric a run is judged by, first found first. */
const HEADLINE = ["accuracy", "balanced_accuracy", "f1", "weighted_f1", "r2", "rmse", "mae"];
/** Metrics where a lower value is better. */
export const LOWER_IS_BETTER = new Set(["rmse", "mae", "mse", "log_loss", "calibration_error", "brier", "expected_cost"]);

export type Replace = { verdict: "replaces" | "worse" | "same" | "not_comparable" | "no_metrics"; text: string };

/** Whether `run` can replace `reference`, judged on the headline test metric both have. Runs
 * scored on different test rows are not weighed, and a change smaller than one test row is no
 * change. */
export function canReplace(
  reference: Record<string, number>,
  run: Record<string, number>,
  splitChanged: boolean,
  names: { reference: string; run: string },
): Replace {
  const ref = `run ${names.reference}`;
  const Run = `Run ${names.run}`;
  const metric = HEADLINE.find((m) => reference[m] !== undefined && run[m] !== undefined);
  if (metric === undefined) return { verdict: "no_metrics", text: `Run ${names.reference} and run ${names.run} share no test metric, so Sprisk cannot say whether run ${names.run} can replace ${ref}.` };
  const [a, b] = [reference[metric]!, run[metric]!];
  const what = metric.replaceAll("_", " ");
  if (splitChanged) return { verdict: "not_comparable", text: `${Run} was scored on different test rows (the split changed), so its ${what} of ${formatMetric(b)} cannot be weighed against ${formatMetric(a)}.` };
  const delta = b - a;
  const rows = Math.min(reference["n_rows"] ?? Infinity, run["n_rows"] ?? Infinity);
  const moved = `${what} ${formatMetric(a)} → ${formatMetric(b)}`;
  if (delta === 0 || (Number.isFinite(rows) && Math.abs(delta) < 1 / rows)) {
    return { verdict: "same", text: `${Run} scores the same as ${ref}${Number.isFinite(rows) ? ` within one test row: ${moved} on ${rows} rows` : `: ${moved}`}.` };
  }
  const better = LOWER_IS_BETTER.has(metric) ? delta < 0 : delta > 0;
  const change = `${delta > 0 ? "+" : "−"}${formatMetric(Math.abs(delta))}`;
  return better
    ? { verdict: "replaces", text: `${Run} can replace ${ref}: ${moved} (${change}) on the same test rows.` }
    : { verdict: "worse", text: `${Run} should not replace ${ref}: ${moved} (${change}) on the same test rows.` };
}

import { showValue } from "../../flow/diff.ts";

/** What the sweep views need of a trial: its node (the key to its score), model and settings. */
export type TrialLike = { node_id: string; candidate: string; settings: Record<string, unknown> };

/** Settings in the order the trials first name them. */
function settingsOf(trials: TrialLike[]): string[] {
  return [...new Set(trials.flatMap((t) => Object.keys(t.settings)))];
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Each setting the study searched: "100 – 800" for numbers, the values tried otherwise. */
export function searchSpace(trials: TrialLike[]): { setting: string; text: string }[] {
  return settingsOf(trials).map((setting) => {
    const values = trials.map((t) => t.settings[setting]).filter((v) => v !== undefined);
    if (values.every(isNumber)) return { setting, text: `${Math.min(...values)} – ${Math.max(...values)}` };
    const seen: string[] = [];
    for (const v of values) if (!seen.includes(showValue(v))) seen.push(showValue(v));
    return { setting, text: seen.join(", ") };
  });
}

/** Each scored trial as a line across its settings then its score, every axis scaled 0 to 1:
 * a number by its range, any other value by the order it was first tried. `best` is the
 * line of the highest score. */
export function parallelLines(trials: TrialLike[], scores: Map<string, number>, metric: string): { axes: string[]; lines: number[][]; best: number } {
  const settings = settingsOf(trials);
  const scored = trials.filter((t) => scores.has(t.node_id));
  const scale = (values: unknown[]) => {
    if (values.every(isNumber)) {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      return (v: unknown) => (hi === lo || !isNumber(v) ? 0.5 : (v - lo) / (hi - lo));
    }
    const order: string[] = [];
    for (const v of values) if (!order.includes(showValue(v))) order.push(showValue(v));
    return (v: unknown) => (order.length < 2 ? 0.5 : order.indexOf(showValue(v)) / (order.length - 1));
  };
  const scales = settings.map((s) => scale(scored.map((t) => t.settings[s])));
  const values = scored.map((t) => scores.get(t.node_id) ?? 0);
  const scoreScale = scale(values);
  const lines = scored.map((t, i) => [...settings.map((s, j) => scales[j]!(t.settings[s])), scoreScale(values[i])]);
  const best = values.indexOf(Math.max(...values));
  return { axes: [...settings, metric], lines, best };
}

/** The `n` best scored trials, best first. */
export function topTrials<T extends TrialLike>(trials: T[], scores: Map<string, number>, n: number): (T & { score: number })[] {
  return trials
    .filter((t) => scores.has(t.node_id))
    .map((t) => ({ ...t, score: scores.get(t.node_id)! }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

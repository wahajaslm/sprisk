import type { Attempt } from "@sprisk/contracts";

/** The newest attempt per node: retries are new attempts with a higher number. */
export function latestByNode(attempts: Attempt[]): Map<string, Attempt> {
  const latest = new Map<string, Attempt>();
  for (const a of attempts) {
    const seen = latest.get(a.node_id);
    if (!seen || a.number > seen.number) latest.set(a.node_id, a);
  }
  return latest;
}

/** Attempts of the methodology gate use this node id (ADR-0017). */
export const GATE_NODE = "gate_b";

/** A finished attempt with outputs: it ran and succeeded, or it reused a cached result. */
export const hasOutputs = (attempt: Attempt | undefined) =>
  attempt?.state === "succeeded" || attempt?.state === "cache_hit";

const STATUS: Record<string, { text: string; tone: string }> = {
  succeeded: { text: "succeeded", tone: "done" },
  cache_hit: { text: "cached", tone: "done" },
  running: { text: "Running…", tone: "live" },
  leased: { text: "Starting…", tone: "live" },
  queued: { text: "Queued", tone: "idle" },
  failed: { text: "failed", tone: "bad" },
  timed_out: { text: "timed out", tone: "bad" },
};

/** An attempt's state in plain words, and the tone it is drawn in. */
export const statusOf = (state: string) => STATUS[state] ?? { text: state, tone: "idle" };

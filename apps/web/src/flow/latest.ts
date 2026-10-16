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

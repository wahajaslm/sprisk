import type { Attempt, MethodologyCheck } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";

import { isGateNode, latestByNode } from "../flow/latest.ts";
import { artifactTextQuery, outputsQuery } from "./hooks.ts";

export type RunChecks =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; checks: MethodologyCheck[] };

/** The methodology checks every gate attempt of the run emitted: Gate B before the first
 *  step (ADR-0017) and each split's row check after it (ADR-0040). */
export function useRunChecks(attempts: Attempt[]): RunChecks {
  const gates = [...latestByNode(attempts.filter((a) => isGateNode(a.node_id))).values()].filter(
    (a) => a.state === "succeeded",
  );
  const outputs = useQueries({ queries: gates.map((g) => outputsQuery(g.id)) });
  const artifacts = outputs.map((o) => o.data?.find((out) => out.port === "checks")?.artifact.id);
  // A list of queries must not repeat a key; gates still loading share "no id".
  const ids = [...new Set(artifacts.filter((id): id is string => id !== undefined))];
  const texts = useQueries({ queries: ids.map(artifactTextQuery) });
  const failed = [...outputs, ...texts].find((q) => q.isError);
  if (failed?.error) return { status: "error", message: failed.error.message };
  if (gates.length === 0) return { status: "none" };
  if (ids.length < gates.length || texts.some((t) => t.data === undefined)) return { status: "loading" };
  try {
    const checks = texts.flatMap((t) => {
      const raw: unknown = JSON.parse(t.data ?? "");
      if (!Array.isArray(raw)) throw new Error("expected a list of checks");
      return raw.map((c) => parse("MethodologyCheck", c));
    });
    return { status: "ready", checks };
  } catch (e) {
    return { status: "error", message: `Unreadable methodology checks: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** How many failed or warning checks cite each step. A check that could not assess a step
 * found no problem, and red is for problems only (ADR-0061); it still shows in the step's
 * Methodology tab. */
export function concernsByNode(run: RunChecks): Map<string, number> {
  const counts = new Map<string, number>();
  if (run.status !== "ready") return counts;
  for (const check of run.checks) {
    if (check.verdict === "pass" || check.verdict === "not_assessed") continue;
    for (const node of check.cited_nodes) counts.set(node, (counts.get(node) ?? 0) + 1);
  }
  return counts;
}

/** "1 check" or "N checks", for a count of checks that did not pass. */
export const checkCount = (n: number) => (n === 1 ? "1 check" : `${n} checks`);

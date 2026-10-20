import type { Attempt, MethodologyCheck } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";

import { isGateNode, latestByNode } from "../flow/latest.ts";
import { getList, getText } from "./client.ts";

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
  const outputs = useQueries({
    queries: gates.map((g) => ({
      queryKey: ["outputs", g.id],
      queryFn: () => getList("AttemptOutput", `/attempts/${g.id}/outputs`),
      staleTime: Infinity, // outputs of an attempt never change
    })),
  });
  const artifacts = outputs.map((o) => o.data?.find((out) => out.port === "checks")?.artifact.id);
  const texts = useQueries({
    queries: artifacts.map((id) => ({
      queryKey: ["artifact-text", id],
      queryFn: () => getText(`/artifacts/${id ?? ""}/content`),
      enabled: id !== undefined,
      staleTime: Infinity,
    })),
  });
  const failed = [...outputs, ...texts].find((q) => q.isError);
  if (failed?.error) return { status: "error", message: failed.error.message };
  if (gates.length === 0) return { status: "none" };
  if (texts.some((t) => t.data === undefined)) return { status: "loading" };
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

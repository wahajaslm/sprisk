import type { Attempt, Run } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";

import { getList, getText } from "./client.ts";
import { isLive, useRuns } from "./hooks.ts";
import { MAX_INLINE_BYTES } from "./media.ts";

/** How many recent runs history covers. Bounded: three small reads per run. */
const HISTORY_RUNS = 8;

export type NodeRun = {
  run: Run;
  /** This node's attempts in the run, oldest first. Empty when it never started. */
  attempts: Attempt[];
  /** Numeric values of the node's JSON metrics output, when it has one. */
  metrics: Record<string, number> | undefined;
};

/** One step across the latest runs of a pipeline version, newest first. Finished runs never
 * change, so their reads are cached for good; a live run is re-read with the run list. */
export function useNodeHistory(pipelineVersionId: string | undefined, nodeId: string): NodeRun[] {
  const runs = (useRuns(pipelineVersionId).data ?? []).slice(0, HISTORY_RUNS);
  const attempts = useQueries({
    queries: runs.map((run) => ({
      queryKey: ["attempts", run.id],
      queryFn: () => getList("Attempt", `/runs/${run.id}/attempts`),
      staleTime: isLive(run) ? 0 : Infinity,
    })),
  });
  const mine = attempts.map((a) => (a.data ?? []).filter((x) => x.node_id === nodeId).sort((x, y) => x.number - y.number));
  const producers = mine.map((list) => list.filter((a) => a.state === "succeeded" || a.state === "cache_hit").at(-1)?.id);
  const outputs = useQueries({
    queries: producers.map((id) => ({
      queryKey: ["outputs", id],
      queryFn: () => getList("AttemptOutput", `/attempts/${id ?? ""}/outputs`),
      enabled: id !== undefined,
      staleTime: Infinity,
    })),
  });
  const metricIds = outputs.map((o) => {
    const a = o.data?.find((x) => x.artifact.media_type === "application/json")?.artifact;
    return a && a.size_bytes <= MAX_INLINE_BYTES ? a.id : undefined;
  });
  const texts = useQueries({
    queries: metricIds.map((id) => ({
      queryKey: ["artifact-text", id],
      queryFn: () => getText(`/artifacts/${id ?? ""}/content`),
      enabled: id !== undefined,
      staleTime: Infinity,
    })),
  });
  return runs.map((run, i) => ({ run, attempts: mine[i] ?? [], metrics: numbers(texts[i]?.data) }));
}

function numbers(text: string | undefined): Record<string, number> | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined; // not metrics; the Result tab shows the raw text
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const found = Object.entries(value).filter((e): e is [string, number] => typeof e[1] === "number");
  return found.length > 0 ? Object.fromEntries(found) : undefined;
}

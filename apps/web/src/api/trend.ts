import { useQueries } from "@tanstack/react-query";

import { headlineMetric } from "../views/NodeFact.tsx";
import { getList, getText } from "./client.ts";
import { isLive, useRuns } from "./hooks.ts";
import { MAX_INLINE_BYTES } from "./media.ts";

/** How many earlier runs a trend looks back over. Bounded: three small reads per run. */
const TREND_RUNS = 6;

/** The node's headline metric in the latest finished runs of this version, oldest first.
 * Finished runs never change, so every read is cached for good. */
export function useMetricTrend(pipelineVersionId: string | undefined, nodeId: string): number[] {
  const runs = useRuns(pipelineVersionId);
  const finished = (runs.data ?? []).filter((r) => !isLive(r)).slice(0, TREND_RUNS);
  const attempts = useQueries({
    queries: finished.map((run) => ({
      queryKey: ["attempts", run.id],
      queryFn: () => getList("Attempt", `/runs/${run.id}/attempts`),
      staleTime: Infinity,
    })),
  });
  const producers = attempts.map((a) => {
    const mine = (a.data ?? []).filter((x) => x.node_id === nodeId && (x.state === "succeeded" || x.state === "cache_hit"));
    return mine.at(-1)?.id;
  });
  const outputs = useQueries({
    queries: producers.map((id) => ({
      queryKey: ["outputs", id],
      queryFn: () => getList("AttemptOutput", `/attempts/${id ?? ""}/outputs`),
      enabled: id !== undefined,
      staleTime: Infinity,
    })),
  });
  const metrics = outputs.map((o) => {
    const artifact = o.data?.[0]?.artifact;
    return artifact && artifact.media_type === "application/json" && artifact.size_bytes <= MAX_INLINE_BYTES ? artifact.id : undefined;
  });
  const texts = useQueries({
    queries: metrics.map((id) => ({
      queryKey: ["artifact-text", id],
      queryFn: () => getText(`/artifacts/${id ?? ""}/content`),
      enabled: id !== undefined,
      staleTime: Infinity,
    })),
  });
  return texts
    .map((t) => (t.data === undefined ? undefined : headlineMetric(t.data)?.value))
    .filter((v): v is number => v !== undefined)
    .reverse();
}

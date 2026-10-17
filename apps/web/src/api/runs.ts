import type { Attempt, Run } from "@sprisk/contracts";
import { type Query, useQueries } from "@tanstack/react-query";

import { getList, getText } from "./client.ts";
import { isLive } from "./hooks.ts";
import { MAX_INLINE_BYTES } from "./media.ts";

/** Runs of several pipeline versions (one flow), newest first. Bounded by `limit`. */
export function useFlowRuns(versionIds: string[], limit: number): Run[] {
  const lists = useQueries({
    queries: versionIds.map((id) => ({
      queryKey: ["runs", id],
      refetchInterval: (query: Query<Run[]>) => (query.state.data?.some(isLive) ? 1000 : false),
      queryFn: () => getList("Run", `/runs?pipeline_version_id=${id}&limit=20`),
    })),
  });
  return lists
    .flatMap((l) => l.data ?? [])
    .sort((a, b) => (a.created_at === b.created_at ? b.id.localeCompare(a.id) : b.created_at.localeCompare(a.created_at)))
    .slice(0, limit);
}

export type NodeInRun = {
  /** The node's attempts in the run, oldest first. Empty when it never started. */
  attempts: Attempt[];
  /** Numeric values of the node's JSON output, when it has one. */
  metrics: Record<string, number> | undefined;
};

/** For each run, the given nodes' attempts and metrics. Finished runs never change, so their
 * reads are cached for good. Three small reads per run and node, so callers bound `runs`. */
export function useRunNodes(runs: Run[], nodeIds: string[]): Record<string, NodeInRun>[] {
  const attempts = useQueries({
    queries: runs.map((run) => ({
      // The status is part of the key, so a run that finishes is read once more, then kept.
      queryKey: ["attempts", run.id, run.status],
      queryFn: () => getList("Attempt", `/runs/${run.id}/attempts`),
      staleTime: isLive(run) ? 0 : Infinity,
    })),
  });
  const pairs = runs.flatMap((_, r) => nodeIds.map((node) => ({ r, node })));
  const mine = pairs.map(({ r, node }) =>
    (attempts[r]?.data ?? []).filter((a) => a.node_id === node).sort((a, b) => a.number - b.number),
  );
  const producers = mine.map((list) => list.filter((a) => a.state === "succeeded" || a.state === "cache_hit").at(-1)?.id);
  // Each id is read once: a list of queries must not repeat a key, and steps that have not run
  // all share "no id".
  const producerIds = unique(producers);
  const outputs = useQueries({
    queries: producerIds.map((id) => ({
      queryKey: ["outputs", id],
      queryFn: () => getList("AttemptOutput", `/attempts/${id}/outputs`),
      staleTime: Infinity,
    })),
  });
  const metricIds = producers.map((id) => {
    const found = id === undefined ? undefined : outputs[producerIds.indexOf(id)]?.data;
    const a = found?.find((x) => x.artifact.media_type === "application/json")?.artifact;
    return a && a.size_bytes <= MAX_INLINE_BYTES ? a.id : undefined;
  });
  const textIds = unique(metricIds);
  const texts = useQueries({
    queries: textIds.map((id) => ({
      queryKey: ["artifact-text", id],
      queryFn: () => getText(`/artifacts/${id}/content`),
      staleTime: Infinity,
    })),
  });
  const result: Record<string, NodeInRun>[] = runs.map(() => ({}));
  pairs.forEach(({ r, node }, i) => {
    const row = result[r];
    const id = metricIds[i];
    if (row) row[node] = { attempts: mine[i] ?? [], metrics: numbers(id === undefined ? undefined : texts[textIds.indexOf(id)]?.data) };
  });
  return result;
}

const unique = (ids: (string | undefined)[]): string[] => [...new Set(ids.filter((id): id is string => id !== undefined))];

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

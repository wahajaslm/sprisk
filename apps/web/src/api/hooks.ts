import type { PipelineVersion, Run } from "@sprisk/contracts";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { getList, getOne, getText, postOne } from "./client.ts";

/** While a run is live, attempts are re-read this often. */
const LIVE_MS = 1000;
const FINISHED: ReadonlySet<Run["status"]> = new Set(["succeeded", "failed", "cancelled"]);
export const isLive = (run: Run | undefined) => run !== undefined && !FINISHED.has(run.status);

export const usePipelineVersions = () =>
  useQuery({ queryKey: ["pipeline_versions"], queryFn: () => getList("PipelineVersion", "/pipeline_versions?limit=50") });

export const useOperators = () =>
  useQuery({ queryKey: ["operators"], queryFn: () => getList("Operator", "/operators"), staleTime: Infinity });

/** A built-in operator's code. It changes only when the API restarts with new plugins. */
export const operatorSourceQuery = (operatorRef: string) => ({
  queryKey: ["operator_source", operatorRef],
  queryFn: () => getOne("OperatorSource", `/operators/${encodeURIComponent(operatorRef)}/source`),
  staleTime: Infinity,
});

export const useOperatorSource = (operatorRef: string | undefined) =>
  useQuery({ ...operatorSourceQuery(operatorRef ?? ""), enabled: operatorRef !== undefined });

export const useOperatorSources = (operatorRefs: string[]) => useQueries({ queries: operatorRefs.map(operatorSourceQuery) });

export const useRuns = (pipelineVersionId: string | undefined) =>
  useQuery({
    queryKey: ["runs", pipelineVersionId],
    queryFn: () => getList("Run", `/runs?pipeline_version_id=${pipelineVersionId ?? ""}&limit=20`),
    enabled: pipelineVersionId !== undefined,
    refetchInterval: (query) => (query.state.data?.some(isLive) ? LIVE_MS : false),
  });

/** The selected run's attempts, re-read while the run is unfinished. */
export function useRunAttempts(pipelineVersionId: string | undefined, runId: string | undefined) {
  const runs = useRuns(pipelineVersionId);
  return useAttempts(runId, runs.data?.find((r) => r.id === runId));
}

// The run's status is part of the key: attempts read while a run was starting are read
// again once it finishes, even when it finished between two polls.
const useAttempts = (runId: string | undefined, run: Run | undefined) =>
  useQuery({
    queryKey: ["attempts", runId, run?.status],
    queryFn: () => getList("Attempt", `/runs/${runId ?? ""}/attempts`),
    enabled: runId !== undefined,
    refetchInterval: isLive(run) ? LIVE_MS : false,
    // Same run read again under a new status: keep its attempts on screen. Another run's
    // attempts are never shown in its place.
    placeholderData: (previous, query) => (query?.queryKey[1] === runId ? previous : undefined),
  });

export const outputsQuery = (attemptId: string) => ({
  queryKey: ["outputs", attemptId],
  queryFn: () => getList("AttemptOutput", `/attempts/${attemptId}/outputs`),
  staleTime: Infinity, // outputs of an attempt never change
});

export const useOutputs = (attemptId: string | undefined) =>
  useQuery({ ...outputsQuery(attemptId ?? ""), enabled: attemptId !== undefined });

/** Small JSON artifacts only (metrics, checks). Tables are never pulled into the browser. */
export const artifactTextQuery = (artifactId: string) => ({
  queryKey: ["artifact-text", artifactId],
  queryFn: () => getText(`/artifacts/${artifactId}/content`),
  staleTime: Infinity,
});

export const useArtifactText = (artifactId: string | undefined) =>
  useQuery({ ...artifactTextQuery(artifactId ?? ""), enabled: artifactId !== undefined });

/** One page of a table artifact's rows. Artifacts are immutable, so a page never goes stale. */
export const tablePageQuery = (artifactId: string, offset: number, limit: number) => ({
  queryKey: ["table-page", artifactId, offset, limit],
  queryFn: () => getOne("TablePage", `/artifacts/${artifactId}/rows?offset=${offset}&limit=${limit}`),
  staleTime: Infinity,
});

export const useTablePage = (artifactId: string | undefined, offset: number, limit: number) =>
  useQuery({
    ...tablePageQuery(artifactId ?? "", offset, limit),
    enabled: artifactId !== undefined,
    placeholderData: keepPreviousData,
  });

export function useStartRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pipelineVersionId: string) =>
      postOne("Run", "/runs", { pipeline_version_id: pipelineVersionId }),
    onSuccess: (run) => client.invalidateQueries({ queryKey: ["runs", run.pipeline_version_id] }),
  });
}

/** Save an edited flow as a new pipeline version, then run it. Rust compiles and checks
 * the version; the UI never does (rule 3). */
/** Save a new version without running it: a flow made from someone's notebook runs only when
 * the person presses Run graph (ADR-0031). */
export function useSavePipelineVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: PipelineVersion) => postOne("PipelineVersion", "/pipeline_versions", version),
    onSuccess: (saved) => {
      client.setQueryData<PipelineVersion[]>(["pipeline_versions"], (list) => [saved, ...(list ?? [])]);
      void client.invalidateQueries({ queryKey: ["pipeline_versions"] });
    },
  });
}

/** Save an edited version and run it from the edited step onwards: every unchanged step
 * reuses `onScreen`, the run being looked at (ADR-0026). Run graph (useStartRun) runs from
 * the start. */
export function useSaveAndRun(onScreen: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (version: PipelineVersion) => {
      const saved = await postOne("PipelineVersion", "/pipeline_versions", version);
      // Known at once, so the screen can switch to it without a gap while the list refreshes.
      client.setQueryData<PipelineVersion[]>(["pipeline_versions"], (list) => [saved, ...(list ?? [])]);
      return postOne("Run", "/runs", { pipeline_version_id: saved.id, ...(onScreen ? { reuse_run_id: onScreen } : {}) });
    },
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ["pipeline_versions"] });
      void client.invalidateQueries({ queryKey: ["runs", run.pipeline_version_id] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getList, getText, postOne } from "./client.ts";

/** While a run is live, attempts are re-read this often. */
const LIVE_MS = 1000;
const FINISHED = new Set(["succeeded", "failed", "cancelled"]);

export const usePipelineVersions = () =>
  useQuery({ queryKey: ["pipeline_versions"], queryFn: () => getList("PipelineVersion", "/pipeline_versions?limit=50") });

export const useOperators = () =>
  useQuery({ queryKey: ["operators"], queryFn: () => getList("Operator", "/operators"), staleTime: Infinity });

export const useRuns = (pipelineVersionId: string | undefined) =>
  useQuery({
    queryKey: ["runs", pipelineVersionId],
    queryFn: () => getList("Run", `/runs?pipeline_version_id=${pipelineVersionId ?? ""}&limit=20`),
    enabled: pipelineVersionId !== undefined,
    refetchInterval: (query) => (query.state.data?.some((r) => !FINISHED.has(r.status)) ? LIVE_MS : false),
  });

export const useAttempts = (runId: string | undefined, live: boolean) =>
  useQuery({
    queryKey: ["attempts", runId],
    queryFn: () => getList("Attempt", `/runs/${runId ?? ""}/attempts`),
    enabled: runId !== undefined,
    refetchInterval: live ? LIVE_MS : false,
  });

export const useOutputs = (attemptId: string | undefined) =>
  useQuery({
    queryKey: ["outputs", attemptId],
    queryFn: () => getList("AttemptOutput", `/attempts/${attemptId ?? ""}/outputs`),
    enabled: attemptId !== undefined,
    staleTime: Infinity, // outputs of an attempt never change
  });

/** Small JSON artifacts only (metrics, checks). Tables are never pulled into the browser. */
export const useArtifactText = (artifactId: string | undefined) =>
  useQuery({
    queryKey: ["artifact-text", artifactId],
    queryFn: () => getText(`/artifacts/${artifactId ?? ""}/content`),
    enabled: artifactId !== undefined,
    staleTime: Infinity,
  });

export function useStartRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pipelineVersionId: string) =>
      postOne("Run", "/runs", { pipeline_version_id: pipelineVersionId }),
    onSuccess: (run) => client.invalidateQueries({ queryKey: ["runs", run.pipeline_version_id] }),
  });
}

import type { CreateStudy, StudyDetail } from "@sprisk/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";

import { getList, getOne, postOne } from "./client.ts";

/** A running study is re-read this often; a finished one never changes again. */
const LIVE_MS = 1000;
const STUDIES_SHOWN = 20;

/** A version's studies, newest first (ADR-0052). */
export const useStudies = (pipelineVersionId: string | undefined) =>
  useQuery({
    queryKey: ["studies", pipelineVersionId],
    queryFn: () => getList("Study", `/pipeline_versions/${pipelineVersionId ?? ""}/studies?limit=${STUDIES_SHOWN}`),
    enabled: pipelineVersionId !== undefined,
    refetchInterval: (query) => (query.state.data?.some((s) => s.status === "running") ? LIVE_MS : false),
  });

/** One study with its trials and run, re-read while it runs. */
export const useStudy = (id: string) =>
  useQuery({
    queryKey: ["study", id],
    queryFn: () => getOne("StudyDetail", `/studies/${id}`),
    refetchInterval: (query) => (query.state.data?.study.status === "running" ? LIVE_MS : false),
    staleTime: (query) => (query.state.data && query.state.data.study.status !== "running" ? Infinity : 0),
  });

export type StudyRequest = Omit<CreateStudy, "idempotency_key">;

/** Starts a study of a model step. Each submit is its own request, so its own key. */
export function useCreateStudy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, nodeId, request }: { pipelineId: string; nodeId: string; request: StudyRequest }) =>
      postOne("StudyDetail", `/pipeline_versions/${pipelineId}/studies/${nodeId}`, {
        ...request,
        idempotency_key: `study-${ulid()}`,
      } satisfies CreateStudy),
    onSuccess: (detail: StudyDetail) => {
      client.setQueryData(["study", detail.study.id], detail);
      void client.invalidateQueries({ queryKey: ["studies", detail.study.pipeline_version_id] });
      void client.invalidateQueries({ queryKey: ["pipeline_versions"] });
    },
  });
}

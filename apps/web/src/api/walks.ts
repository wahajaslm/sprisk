import type { CreateWalk, Walk } from "@sprisk/contracts";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { ulid } from "ulid";

import { getOne, postOne } from "./client.ts";

/** A walking walk is re-read this often; a stopped one never changes again. */
const LIVE_MS = 1000;

export type WalkRequest = Omit<CreateWalk, "idempotency_key">;

/** Starts the engine on a question and its sources (ADR-0060). Each submit is its own request, so its own key. */
export const useStartWalk = () =>
  useMutation({
    mutationFn: (request: WalkRequest): Promise<Walk> =>
      postOne("Walk", "/walks", { ...request, idempotency_key: `walk-${ulid()}` } satisfies CreateWalk),
  });

/** One walk with its steps, re-read while it walks. */
export const useWalk = (id: string | undefined) =>
  useQuery({
    queryKey: ["walk", id],
    queryFn: () => getOne("WalkDetail", `/walks/${id ?? ""}`),
    enabled: id !== undefined,
    refetchInterval: (query) => (query.state.data?.walk.status === "stopped" ? false : LIVE_MS),
    staleTime: (query) => (query.state.data?.walk.status === "stopped" ? Infinity : 0),
  });

const flowDecisionsQuery = (pipelineVersionId: string) => ({
  queryKey: ["flow_decisions", pipelineVersionId],
  queryFn: () => getOne("FlowDecisions", `/pipeline_versions/${pipelineVersionId}/decisions`),
});

/** What decided a flow version, and each promise's standing on it (ADR-0063). A walk still
 * walking may add checks, so it is read again when the flow is shown again. */
export const useFlowDecisions = (pipelineVersionId: string | undefined) =>
  useQuery({ ...flowDecisionsQuery(pipelineVersionId ?? ""), enabled: pipelineVersionId !== undefined });

/** The decisions of several flow versions, one query each, in the order given. */
export const useFlowDecisionsOf = (pipelineVersionIds: string[]) => useQueries({ queries: pipelineVersionIds.map(flowDecisionsQuery) });

/** What a completed walk found (ADR-0064). One per walk and immutable, so read once. */
export const useWalkReport = (walkId: string | undefined) =>
  useQuery({
    queryKey: ["walk_report", walkId],
    queryFn: () => getOne("Report", `/walks/${walkId ?? ""}/report`),
    enabled: walkId !== undefined,
    staleTime: Infinity,
  });

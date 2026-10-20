import type { AppliedMethodologyDecision, ApplyMethodologyDecision, PipelineVersion } from "@sprisk/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";

import { getList, postOne } from "./client.ts";

export function useResolveSplit() {
  return useMutation({
    mutationFn: ({ pipelineId, nodeId }: { pipelineId: string; nodeId: string }) =>
      postOne("DecisionProposal", `/pipeline_versions/${pipelineId}/methodology/split/${nodeId}/proposals`, {}),
  });
}

export function useResolveMethodology() {
  return useMutation({
    mutationFn: ({ pipelineId, nodeId }: { pipelineId: string; nodeId: string }) =>
      postOne("DecisionProposal", `/pipeline_versions/${pipelineId}/methodology/proposals/${nodeId}`, {}),
  });
}

export function useApplyMethodology() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, alternativeId, reason }: { proposalId: string; alternativeId: string; reason?: string }) =>
      postOne("AppliedMethodologyDecision", `/methodology_proposals/${proposalId}/apply`, {
        alternative_id: alternativeId,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
        idempotency_key: `apply-${ulid()}`,
      } satisfies ApplyMethodologyDecision),
    onSuccess: (applied: AppliedMethodologyDecision) => {
      client.setQueryData<PipelineVersion[]>(["pipeline_versions"], (versions) => [applied.pipeline, ...(versions ?? [])]);
      void client.invalidateQueries({ queryKey: ["pipeline_versions"] });
      void client.invalidateQueries({ queryKey: ["methodology_decisions"] });
    },
  });
}

export const useMethodologyDecisions = () =>
  useQuery({ queryKey: ["methodology_decisions"], queryFn: () => getList("MethodologyDecision", "/methodology_decisions") });

import type { AppliedMethodologyDecision, ApplyMethodologyDecision, PipelineVersion } from "@sprisk/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";

import { getList, getOne, postOne } from "./client.ts";

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

/** Build the version that cross-validates a shortlist's models (ADR-0046), then run it. A
 * proposal has one comparison, so pressing Compare again runs the same one again. */
export function useCompareModels() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const comparison = await postOne("PipelineVersion", `/methodology_proposals/${proposalId}/compare`, {});
      client.setQueryData<PipelineVersion[]>(["pipeline_versions"], (versions) => [
        comparison,
        ...(versions ?? []).filter((v) => v.id !== comparison.id),
      ]);
      return postOne("Run", "/runs", { pipeline_version_id: comparison.id });
    },
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ["pipeline_versions"] });
      void client.invalidateQueries({ queryKey: ["runs", run.pipeline_version_id] });
    },
  });
}

/** Rule manifests change only when the API restarts with new packs. */
export const useMethodologyRules = () =>
  useQuery({ queryKey: ["methodology_rules"], queryFn: () => getList("MethodologyRule", "/methodology_rules"), staleTime: Infinity });

export const useMethodologyRuleSource = (ruleRef: string) =>
  useQuery({
    queryKey: ["methodology_rule_source", ruleRef],
    queryFn: () => getOne("MethodologyRuleSource", `/methodology_rules/${encodeURIComponent(ruleRef)}/source`),
    staleTime: Infinity,
  });

/** A decision never changes once applied (ADR-0042). */
export const useMethodologyDecision = (id: string | undefined) =>
  useQuery({
    queryKey: ["methodology_decision", id],
    queryFn: () => getOne("MethodologyDecision", `/methodology_decisions/${id}`),
    enabled: id !== undefined,
    staleTime: Infinity,
  });

/** A proposal never changes once made; it holds the evidence its decision weighed. */
export const useMethodologyProposal = (id: string | undefined) =>
  useQuery({
    queryKey: ["methodology_proposal", id],
    queryFn: () => getOne("DecisionProposal", `/methodology_proposals/${id}`),
    enabled: id !== undefined,
    staleTime: Infinity,
  });

/** Several proposals at once, e.g. the ones the flow's comparisons compare. */
export const useMethodologyProposals = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({
      queryKey: ["methodology_proposal", id],
      queryFn: () => getOne("DecisionProposal", `/methodology_proposals/${id}`),
      staleTime: Infinity,
    })),
  });

import type {
  AppliedMethodologyDecision,
  ApplyMethodologyDecision,
  MethodologyDecision,
  MethodologyDecisionByRule,
  PipelineVersion,
} from "@sprisk/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";

import { getList, getOne, postOne } from "./client.ts";

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

/** How Sprisk is choosing a model step's model (ADR-0050): it resolves the shortlist, builds
 * the comparison and starts its run, or returns those it has. It changes nothing in the flow. */
export function useSelectModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, nodeId }: { pipelineId: string; nodeId: string }) =>
      postOne("ModelSelection", `/pipeline_versions/${pipelineId}/model_selection/${nodeId}`, {}),
    onSuccess: (selection) => {
      client.setQueryData<PipelineVersion[]>(["pipeline_versions"], (versions) => [
        selection.comparison,
        ...(versions ?? []).filter((v) => v.id !== selection.comparison.id),
      ]);
      client.setQueryData(["methodology_proposal", selection.proposal.id], selection.proposal);
      void client.invalidateQueries({ queryKey: ["runs", selection.comparison.id] });
    },
  });
}

/** Rule manifests change only when the API restarts with new packs. */
export const useMethodologyRules = () =>
  useQuery({ queryKey: ["methodology_rules"], queryFn: () => getList("MethodologyRule", "/methodology_rules"), staleTime: Infinity });

/** Every method, in the order the engine decides them; they change only with the packs. */
export const useMethods = () => useQuery({ queryKey: ["methods"], queryFn: () => getList("Method", "/methods"), staleTime: Infinity });

/** The meanings a question can bind to a column (ADR-0063); they change only with the packs. */
export const useConcepts = () =>
  useQuery({ queryKey: ["concepts"], queryFn: () => getOne("ConceptSet", "/concepts"), staleTime: Infinity });

export const useMethodologyRuleSource = (ruleRef: string) =>
  useQuery({
    queryKey: ["methodology_rule_source", ruleRef],
    queryFn: () => getOne("MethodologyRuleSource", `/methodology_rules/${encodeURIComponent(ruleRef)}/source`),
    staleTime: Infinity,
  });

/** A rule's decision comes from a proposal; a method's does not (ADR-0064). */
export const byRule = (decision: MethodologyDecision | undefined): decision is MethodologyDecisionByRule =>
  decision !== undefined && "proposal_id" in decision;

/** A decision never changes once applied (ADR-0042). */
export const useMethodologyDecision = (id: string | undefined) =>
  useQuery({
    queryKey: ["methodology_decision", id],
    queryFn: () => getOne("MethodologyDecision", `/methodology_decisions/${id}`),
    enabled: id !== undefined,
    staleTime: Infinity,
  });

/** A proposal never changes once made; it holds the evidence its decision weighed. */
const proposalQuery = (id: string) => ({
  queryKey: ["methodology_proposal", id],
  queryFn: () => getOne("DecisionProposal", `/methodology_proposals/${id}`),
  staleTime: Infinity,
});

export const useMethodologyProposal = (id: string | undefined) =>
  useQuery({ ...proposalQuery(id ?? ""), enabled: id !== undefined });

/** Several proposals at once, e.g. the ones the flow's comparisons compare. */
export const useMethodologyProposals = (ids: string[]) => useQueries({ queries: ids.map(proposalQuery) });

/** A method's method.yaml and method.py, as the packs loaded them (ADR-0063). They change
 * only when the API restarts with new packs. */
export const useMethodFiles = (methodRef: string) =>
  useQuery({
    queryKey: ["method_files", methodRef],
    queryFn: () => getOne("MethodFiles", `/methods/${encodeURIComponent(methodRef)}/files`),
    staleTime: Infinity,
  });

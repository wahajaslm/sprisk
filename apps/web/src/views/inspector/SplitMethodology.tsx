import type { MethodologyRule, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useApplyMethodology, useResolveMethodology, useResolveSplit } from "../../api/methodology.ts";
import { useSelection } from "../../workbench/selection.ts";

/** One rule's choice for a step. With `rule`, the panel is titled by it and asks for its decision
 * only, since a step may have one rule per decision (ADR-0053). */
export function SplitMethodology({ pipeline, nodeId, rule }: {
  pipeline: PipelineVersion;
  nodeId: string;
  rule?: Pick<MethodologyRule, "name" | "decides">;
}) {
  const current = pipeline.nodes.find((node) => node.id === nodeId);
  const isSplit = current?.operator.includes("split@") ?? false;
  const resolveSplit = useResolveSplit();
  const resolveGeneral = useResolveMethodology();
  const resolve = isSplit ? resolveSplit : resolveGeneral;
  const apply = useApplyMethodology();
  const selectPipeline = useSelection((state) => state.selectPipelineVersion);
  const setNav = useSelection((state) => state.setNav);
  const [selected, setSelected] = useState<string>();
  const [reason, setReason] = useState("");
  const proposal = resolve.data;
  const chosen = proposal?.alternatives.find((alternative) => alternative.id === selected);

  const headline = rule
    ? rule.name
    : isSplit
    ? "How should validation be separated?"
    : current?.operator.includes("clustering.") || current?.operator.includes("kmeans")
      ? "Which clustering algorithm fits the data topology?"
      : current?.operator.includes("impute@") || current?.operator.includes("drop_missing@")
        ? "How should missing data values be handled?"
        : current?.operator.includes("scale@")
          ? "How should continuous features be rescaled?"
          : current?.operator.includes("clip_outliers@")
            ? "How should extreme outliers be treated?"
            : current?.operator.includes(".ml.")
              ? "Which models are worth comparing?"
              : "Which methodology rule should be applied?";

  const eyebrow = proposal?.rule
    ? `Methodology · ${proposal.rule}`
    : isSplit
      ? "Methodology · split method"
      : "Methodology · recommendation";

  return <section className="method-choice" aria-label={rule?.name ?? "Split methodology"}>
    <header>
      <div><p className="eyebrow">{eyebrow}</p><h3>{headline}</h3></div>
      <span className="ledger-tag">{current?.methodology_decision_id ? "applied decision" : "hand authored"}</span>
    </header>
    <p className="muted">Current: {current?.operator}. The resolver reads the linked question revision and changes nothing until Apply.</p>
    {!pipeline.question_version_id ? <p role="alert" className="error">Link a question revision in Atlas before choosing a method.</p> : !proposal ? (
      <button type="button" className="run-code" disabled={resolve.isPending} onClick={() => resolve.mutate({ pipelineId: pipeline.id, nodeId, ...(rule ? { decides: rule.decides } : {}) })}>{resolve.isPending ? "Resolving…" : isSplit ? "Review split choices" : "Review methodology choices"}</button>
    ) : <>
      <div className="method-evidence"><strong>Evidence</strong>{proposal.evidence.map((item) => <span key={`${item.label}/${item.value}`}>{item.label}: {item.value} <small>({item.origin})</small></span>)}</div>
      {proposal.shortlist && <p className="muted">Sprisk cross-validates the shortlisted models on its own and recommends one on the Experiments page.</p>}
      <div className="method-alternatives">
        {proposal.alternatives.map((alternative) => <label key={alternative.id} className={`method-alternative ${alternative.applicability}`}>
          <input type="radio" name={`method-choice-${nodeId}`} checked={selected === alternative.id} disabled={alternative.applicability !== "applicable"} onChange={() => setSelected(alternative.id)} />
          <span><strong>{alternative.label}{proposal.recommended_alternative_id === alternative.id ? " · recommended" : ""}{proposal.shortlist?.includes(alternative.id) ? " · shortlisted" : ""}</strong><small>{alternative.description}</small><small>{alternative.reason}</small></span>
        </label>)}
      </div>
      {chosen?.effect && <div className="method-preview"><strong>Preview</strong>{chosen.effect.kind === "remove_node"
        ? <p>Remove <code>{chosen.effect.node_id}</code>. The steps after it read its inputs directly.</p>
        : chosen.effect.kind === "insert_node"
        ? <><p>Add <code>{chosen.effect.node_id}</code> ({chosen.effect.operator}) before <code>{chosen.effect.before}</code>.</p><pre>{JSON.stringify(chosen.effect.params, null, 2)}</pre></>
        : <><p>{chosen.effect.operator === current?.operator
          ? <>Change the settings of <code>{chosen.effect.node_id}</code>.</>
          : <>Replace <code>{chosen.effect.node_id}</code> with <code>{chosen.effect.operator}</code>.</>}</p><pre>{JSON.stringify(chosen.effect.params, null, 2)}</pre></>}</div>}
      {chosen && proposal.recommended_alternative_id !== chosen.id && <label className="method-reason">{proposal.shortlist ? "Reason for choosing without comparing" : "Reason for choosing another method"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      <div className="settings-actions"><button type="button" className="page-btn" onClick={() => resolve.reset()}>Refresh</button><span className="spacer" />{proposal.shortlist && <button type="button" className="page-btn" onClick={() => setNav("Experiments")}>See the comparison</button>}<button type="button" className="run-code" disabled={!chosen || apply.isPending || (proposal.recommended_alternative_id !== chosen?.id && !reason.trim())} onClick={() => chosen && apply.mutate({ proposalId: proposal.id, alternativeId: chosen.id, reason }, { onSuccess: (result) => selectPipeline(result.pipeline.id) })}>{apply.isPending ? "Applying…" : "Apply to new flow version"}</button></div>
    </>}
    {(resolve.isError || apply.isError) && <p role="alert" className="error">{resolve.error?.message ?? apply.error?.message}</p>}
  </section>;
}

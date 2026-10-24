import type { GraphEffect, MethodologyRule, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import type { RunChecks } from "../../api/checks.ts";
import { useApplyMethodology, useMethodologyRules, useResolveStep } from "../../api/methodology.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { ChecksTab } from "./ChecksTab.tsx";

/** A step's methodology, as the design's main screen lays it out: each rule that decides the
 * step, with its decision, then the checks of the last run that cite the step. */
export function MethodologyTab({ pipeline, nodeId, checks }: { pipeline: PipelineVersion; nodeId: string; checks: RunChecks }) {
  const rules = useMethodologyRules();
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const unversioned = node.operator.split("@")[0] ?? node.operator;
  // A step has one decision per active rule that decides its operator (ADR-0045, ADR-0053).
  const deciding = (rules.data ?? [])
    .filter((r) => r.status === "active" && r.applies_to?.includes(unversioned))
    .sort(inWorkflowOrder);
  return (
    <div className="method-tab">
      {rules.isError && <p role="alert" className="error">Methodology rules could not be read: {rules.error.message}</p>}
      {rules.isPending && <Loading />}
      {rules.isSuccess && deciding.length === 0 && <p className="muted">No methodology rule decides this step.</p>}
      {deciding.map((rule) => (
        <RuleDecision key={`${pipeline.id}/${nodeId}/${rule.decides}`} pipeline={pipeline} nodeId={nodeId} rule={rule} />
      ))}
      <ChecksTab run={checks} nodeId={nodeId} />
    </div>
  );
}

/** The schema's stage order, so a step's rules read as the work goes: the model, then its threshold. */
const STAGE_ORDER: Record<MethodologyRule["stage"], number> = {
  question: 0, data: 1, cleaning: 2, split: 3, features: 4, models: 5, evaluation: 6, reporting: 7,
};

function inWorkflowOrder(a: MethodologyRule, b: MethodologyRule): number {
  return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.id.localeCompare(b.id);
}

/** One rule's decision for a step, in four columns: the rule and its pick, the evidence it
 * decided on, the alternatives, and the thresholds it decided with. A person asks for the
 * decision (resolving stores a proposal); nothing in the flow changes until Apply. */
export function RuleDecision({ pipeline, nodeId, rule }: {
  pipeline: PipelineVersion;
  nodeId: string;
  rule: Pick<MethodologyRule, "name" | "decides" | "question" | "policy_thresholds" | "provenance">;
}) {
  const current = pipeline.nodes.find((node) => node.id === nodeId);
  const isSplit = current?.operator.includes("split@") ?? false;
  const linked = pipeline.question_version_id !== undefined;
  const proposal = useResolveStep();
  const apply = useApplyMethodology();
  const selectPipeline = useSelection((state) => state.selectPipelineVersion);
  const openExperiments = useSelection((state) => state.openExperiments);
  const [picked, setPicked] = useState<string>();
  const [reason, setReason] = useState("");
  const decided = proposal.data;
  const recommended = decided?.alternatives.find((a) => a.id === decided.recommended_alternative_id);
  const selected = picked ?? decided?.recommended_alternative_id;
  const chosen = decided?.alternatives.find((a) => a.id === selected);
  const overridden = chosen !== undefined && chosen.id !== decided?.recommended_alternative_id;
  const thresholds = Object.entries(rule.policy_thresholds ?? {});

  return (
    <section className="rule-decision" aria-label={rule.name}>
      <div className="rd-col">
        <p className="rd-label">Rule</p>
        <h3 className="rd-title">{rule.name}</h3>
        {recommended ? (
          <>
            <p>Chooses: {recommended.label}</p>
            <p className="muted">{recommended.reason}</p>
          </>
        ) : decided?.shortlist ? (
          <p className="muted">Sprisk cross-validates the shortlisted models on its own and recommends one on the Experiments page.</p>
        ) : (
          <p className="muted">{rule.question}</p>
        )}
        <span className="rd-tag">{current?.methodology_decision_id ? "Applied decision" : "Not applied yet"}</span>
      </div>

      <div className="rd-col">
        <p className="rd-label">Decision</p>
        {!linked ? (
          <p role="alert" className="error">Link a question revision on the Objective page before a rule can decide.</p>
        ) : proposal.isIdle ? (
          <button type="button" className="page-btn rd-review" onClick={() => proposal.mutate({ pipelineId: pipeline.id, nodeId, decides: rule.decides, isSplit })}>
            Review choices
          </button>
        ) : proposal.isPending ? (
          <Loading />
        ) : proposal.isError ? (
          <p role="alert" className="error">{proposal.error.message}</p>
        ) : (
          <dl className="rd-facts">
            {decided?.evidence.map((item) => (
              <div key={`${item.label}/${item.value}`}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="rd-col">
        <p className="rd-label">Alternatives</p>
        {decided && (
          <div className="rd-alternatives" role="radiogroup" aria-label={`${rule.name} alternatives`}>
            {decided.alternatives.map((alternative) => (
              <label key={alternative.id} className={`rd-alternative${selected === alternative.id ? " selected" : ""}`}>
                <input
                  type="radio"
                  name={`rule-${nodeId}-${rule.decides}`}
                  checked={selected === alternative.id}
                  disabled={alternative.applicability !== "applicable"}
                  onChange={() => setPicked(alternative.id)}
                />
                <span>
                  <span className="rd-alt-label">{alternative.label}</span>
                  {decided.recommended_alternative_id === alternative.id && <small>Rule's pick</small>}
                  {decided.shortlist?.includes(alternative.id) && <small>Shortlisted</small>}
                  {alternative.applicability !== "applicable" && <small>{alternative.reason}</small>}
                </span>
              </label>
            ))}
          </div>
        )}
        {chosen?.effect && <EffectPreview effect={chosen.effect} currentOperator={current?.operator} />}
        {overridden && (
          <label className="method-reason">
            {decided?.shortlist ? "Reason for choosing without comparing" : "Reason for choosing another method"}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        )}
        {decided && (
          <div className="rd-actions">
            {decided.shortlist && <button type="button" className="page-btn" onClick={() => openExperiments("Compare")}>See the comparison</button>}
            <button
              type="button"
              className="page-btn"
              disabled={!chosen?.effect || apply.isPending || (overridden && !reason.trim())}
              onClick={() => chosen && apply.mutate({ proposalId: decided.id, alternativeId: chosen.id, reason }, { onSuccess: (result) => selectPipeline(result.pipeline.id) })}
            >
              {apply.isPending ? "Applying…" : "Apply to new flow version"}
            </button>
          </div>
        )}
        {apply.isError && <p role="alert" className="error">{apply.error.message}</p>}
      </div>

      <div className="rd-col">
        <p className="rd-label">Thresholds</p>
        {thresholds.length === 0 ? (
          <p className="muted">This rule decides with no threshold.</p>
        ) : (
          <dl className="rd-facts">
            {thresholds.map(([name, value]) => (
              <div key={name}>
                <dt>{name.replaceAll("_", " ")}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="rd-source muted">{rule.provenance.standard}</p>
      </div>
    </section>
  );
}

/** What Apply would change in the flow, before anything changes. */
function EffectPreview({ effect, currentOperator }: { effect: GraphEffect; currentOperator: string | undefined }) {
  const settings = "params" in effect ? <pre>{JSON.stringify(effect.params, null, 2)}</pre> : null;
  const said =
    effect.kind === "remove_node" ? <p>Remove <code>{effect.node_id}</code>. The steps after it read its inputs directly.</p>
    : effect.kind === "insert_node" ? <p>Add <code>{effect.node_id}</code> ({effect.operator}) before <code>{effect.before}</code>.</p>
    : effect.kind === "add_node" ? <p>Add <code>{effect.node_id}</code> ({effect.operator}) beside the flow.</p>
    : effect.kind === "set_input" ? <p>Feed <code>{effect.node_id}.{effect.port}</code> from <code>{effect.from}</code>.</p>
    : effect.operator === currentOperator ? <p>Change the settings of <code>{effect.node_id}</code>.</p>
    : <p>Replace <code>{effect.node_id}</code> with <code>{effect.operator}</code>.</p>;
  return <div className="method-preview"><strong>Preview</strong>{said}{settings}</div>;
}

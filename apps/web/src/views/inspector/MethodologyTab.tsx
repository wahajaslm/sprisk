import type { Attempt, GraphEffect, MethodologyRule, Operator, PipelineVersion } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import type { RunChecks } from "../../api/checks.ts";
import { useApplyMethodology, useMethodologyRules, useResolveStep } from "../../api/methodology.ts";
import { useFlowDecisions } from "../../api/walks.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { hasOutputs, statusOf } from "../../flow/latest.ts";
import { readersOf } from "../../flow/edit.ts";
import { metricsPort, stepType } from "../../flow/stages.ts";
import { ink, P } from "../../styles/palette.ts";
import { useSelection } from "../../workbench/selection.ts";
import { NodeFact } from "../NodeFact.tsx";
import { ChecksTab } from "./ChecksTab.tsx";
import { MethodDecision } from "./MethodDecision.tsx";

/** The design's Methodology tab grid: up to three columns that stack when the panel is narrow. */
const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: "20px 40px", alignItems: "start" } as const;
/** With only the step's facts, they keep one column's width instead of filling the panel. */
const ONE_COLUMN = { ...GRID, gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,240px),1fr))" } as const;
const COLUMN = { display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" } as const;
const LABEL = { fontSize: "12.5px", color: "var(--t-label,#959595)" } as const;
const BUTTON = { alignSelf: "flex-start", height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.14)", display: "flex", alignItems: "center", fontSize: "12.5px", fontWeight: "500", color: "var(--t-secondary,#d4d4d4)", cursor: "pointer" } as const;

/** One fact row, as the design lists a step's measurements. */
function Fact({ k, v, warn = false }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "6px 0", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.05)", fontSize: "13px" }}>
      <span style={{ color: "var(--t-label,#959595)" }}>{k}</span>
      <span className="dx-fact" style={{ fontVariantNumeric: "tabular-nums", textAlign: "right", color: warn ? P.red : P.t0, minWidth: "0" }}>{v}</span>
    </div>
  );
}

/** What the step is and what it measured: its type, what it does, and its facts. */
function StepFacts({ pipeline, nodeId, operator, latest }: { pipeline: PipelineVersion; nodeId: string; operator?: Operator | undefined; latest?: Attempt | undefined }) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const readers = readersOf(pipeline, nodeId).length;
  const status = latest ? statusOf(latest.state) : undefined;
  const metrics = operator ? metricsPort(operator) : undefined;
  return (
    <>
      <span style={LABEL}>{stepType(node, operator)}</span>
      {operator?.description && <span style={{ fontSize: "12.5px", color: "var(--t-muted,#ababab)", lineHeight: "1.5", textWrap: "pretty" }}>{operator.description}</span>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Fact k="Status" v={status?.text ?? "Not run"} warn={status?.tone === "bad"} />
        {latest && hasOutputs(latest) && <Fact k="Output" v={<NodeFact attemptId={latest.id} operator={node.operator} metricsPort={metrics} status="saved" />} />}
        <Fact k="Downstream" v={`${readers} ${readers === 1 ? "step" : "steps"}`} />
      </div>
    </>
  );
}

/** A step's methodology, as the design's main screen lays it out: each rule that decides the
 * step with what it chose, its alternatives and thresholds, beside the step's own facts; then
 * each method that shaped the step (ADR-0063) and the checks of the last run that cite it. */
export function MethodologyTab({ pipeline, nodeId, checks, operator, latest }: { pipeline: PipelineVersion; nodeId: string; checks: RunChecks; operator?: Operator | undefined; latest?: Attempt | undefined }) {
  const rules = useMethodologyRules();
  const decided = useFlowDecisions(pipeline.id);
  const methods = (decided.data?.decisions ?? []).filter((d) => d.steps.includes(nodeId));
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const unversioned = node.operator.split("@")[0] ?? node.operator;
  // A step has one decision per active rule that decides its operator (ADR-0045, ADR-0053).
  const deciding = (rules.data ?? [])
    .filter((r) => r.status === "active" && r.applies_to?.includes(unversioned))
    .sort(inWorkflowOrder);
  const facts = <StepFacts pipeline={pipeline} nodeId={nodeId} operator={operator} latest={latest} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px", padding: "18px 24px" }}>
      {rules.isError && <p role="alert" className="error">Methodology rules could not be read: {rules.error.message}</p>}
      {decided.isError && <p role="alert" className="error">The pipeline's decisions could not be read: {decided.error.message}</p>}
      {(rules.isPending || decided.isPending) && <Loading />}
      {deciding.length === 0 ? (
        <div style={ONE_COLUMN}>
          <div style={COLUMN}>
            {facts}
            {rules.isSuccess && decided.isSuccess && methods.length === 0 && <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", paddingTop: "4px" }}>No methodology rule decides this step.</span>}
          </div>
        </div>
      ) : (
        deciding.map((rule, i) => <RuleDecision key={`${pipeline.id}/${nodeId}/${rule.decides}`} pipeline={pipeline} nodeId={nodeId} rule={rule} facts={i === 0 ? facts : undefined} />)
      )}
      {methods.map((decision) => (
        <MethodDecision key={decision.decides} decision={decision} />
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

/** One rule's decision for a step in the design's columns: the rule, what it chose and why, and
 * the step's facts; the alternatives; the thresholds it decides with. A person asks for the
 * decision (resolving stores a proposal); nothing in the flow changes until Apply. */
export function RuleDecision({ pipeline, nodeId, rule, facts }: {
  pipeline: PipelineVersion;
  nodeId: string;
  rule: Pick<MethodologyRule, "name" | "decides" | "question" | "policy_thresholds" | "provenance">;
  facts?: ReactNode;
}) {
  const current = pipeline.nodes.find((node) => node.id === nodeId);
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
    <section aria-label={rule.name} style={GRID}>
      <div style={COLUMN}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", paddingBottom: "6px" }}>
          <span style={LABEL}>Rule</span>
          <span style={{ fontSize: "14px", fontWeight: "550" }}>{rule.name}</span>
          <span style={{ fontSize: "13px", color: P.t1 }}>
            {recommended ? `Chooses: ${recommended.label}` : decided?.shortlist ? "Sprisk cross-validates the shortlisted models on its own and recommends one on the Experiments page." : rule.question}
          </span>
          {recommended?.reason && <span style={{ fontSize: "12.5px", color: "var(--t-muted,#ababab)", lineHeight: "1.5", textWrap: "pretty", marginTop: "2px" }}>{recommended.reason}</span>}
          <span style={{ fontSize: "11.5px", color: "var(--t-faint,#8c8c8c)", marginTop: "2px" }}>{current?.methodology_decision_id ? "Applied decision" : "Not applied yet"}</span>
        </div>
        {facts}
        {decided && decided.evidence.length > 0 && (
          <>
            <span style={{ ...LABEL, paddingTop: "6px" }}>Decision</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {decided.evidence.map((item) => (
                <Fact key={`${item.label}/${item.value}`} k={item.label} v={item.value} />
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
        <span style={{ ...LABEL, paddingBottom: "4px" }}>Alternatives</span>
        {!linked ? (
          <p role="alert" className="error">Link a question revision on the Objective page before a rule can decide.</p>
        ) : proposal.isIdle ? (
          <button type="button" className="dx-btn dx-h-06" onClick={() => proposal.mutate({ pipelineId: pipeline.id, nodeId, decides: rule.decides })} style={BUTTON}>
            Review choices
          </button>
        ) : proposal.isPending ? (
          <Loading />
        ) : proposal.isError ? (
          <p role="alert" className="error">{proposal.error.message}</p>
        ) : null}
        {decided && (
          <div role="radiogroup" aria-label={`${rule.name} alternatives`} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {decided.alternatives.map((alternative) => {
              const on = selected === alternative.id;
              const usable = alternative.applicability === "applicable";
              return (
                <label key={alternative.id} className={usable && !on ? "dx-field dx-h-03" : "dx-field"} style={{ position: "relative", padding: "7px 10px", borderRadius: "var(--r-sm,6px)", display: "flex", gap: "10px", alignItems: "flex-start", cursor: usable ? "pointer" : "default", background: on ? ink(0.05) : "transparent", opacity: usable ? 1 : 0.5 }}>
                  <input type="radio" name={`rule-${nodeId}-${rule.decides}`} checked={on} disabled={!usable} onChange={() => setPicked(alternative.id)} style={{ position: "absolute", opacity: "0", width: "1px", height: "1px", margin: "0" }} />
                  <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "6px", marginTop: "3px", flexShrink: "0", border: `1px solid ${on ? P.t0 : ink(0.3)}`, boxShadow: on ? `inset 0 0 0 3px ${P.surf}, inset 0 0 0 6px ${P.t0}` : "none" }} />
                  <span style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}>
                    <span style={{ fontSize: "13px", fontWeight: "500", lineHeight: "1.4" }}>{alternative.label}</span>
                    {decided.recommended_alternative_id === alternative.id && <span style={{ fontSize: "11.5px", color: "var(--t-faint,#8c8c8c)" }}>Rule's pick</span>}
                    {decided.shortlist?.includes(alternative.id) && <span style={{ fontSize: "11.5px", color: "var(--t-faint,#8c8c8c)" }}>Shortlisted</span>}
                    {!usable && <span style={{ fontSize: "11.5px", color: "var(--t-faint,#8c8c8c)" }}>{alternative.reason}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {chosen?.effect && <EffectPreview effect={chosen.effect} currentOperator={current?.operator} />}
        {overridden && (
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "8px", fontSize: "12.5px", color: "var(--t-label,#959595)" }}>
            {decided?.shortlist ? "Reason for choosing without comparing" : "Reason for choosing another method"}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} style={{ minHeight: "56px", padding: "8px 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.12)", background: "transparent", color: "var(--t-primary,#f2f2f2)", font: "inherit", fontSize: "13px", resize: "vertical" }} />
          </label>
        )}
        {decided && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingTop: "10px" }}>
            {decided.shortlist && (
              <button type="button" className="dx-btn dx-h-06" onClick={() => openExperiments("Compare")} style={BUTTON}>
                See the comparison
              </button>
            )}
            <button
              type="button"
              className="dx-btn"
              disabled={!chosen?.effect || apply.isPending || (overridden && !reason.trim())}
              onClick={() => chosen && apply.mutate({ proposalId: decided.id, alternativeId: chosen.id, reason }, { onSuccess: (result) => selectPipeline(result.pipeline.id) })}
              style={{ ...BUTTON, border: "1px solid transparent", background: "var(--t-primary,#f2f2f2)", color: "var(--bg-app,#0a0a0a)", fontWeight: "550" }}
            >
              {apply.isPending ? "Applying…" : "Apply to new pipeline version"}
            </button>
          </div>
        )}
        {apply.isError && <p role="alert" className="error">{apply.error.message}</p>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={LABEL}>Thresholds</span>
          {thresholds.length === 0 ? (
            <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" }}>This rule decides with no threshold.</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {thresholds.map(([name, value]) => (
                <Fact key={name} k={name.replaceAll("_", " ")} v={String(value)} />
              ))}
            </div>
          )}
          <span style={{ fontSize: "12px", color: "var(--t-faint,#8c8c8c)", lineHeight: "1.5" }}>{rule.provenance.standard}</span>
        </div>
      </div>
    </section>
  );
}

/** What Apply would change in the flow, before anything changes. */
function EffectPreview({ effect, currentOperator }: { effect: GraphEffect; currentOperator: string | undefined }) {
  const settings = "params" in effect ? <pre style={{ margin: "6px 0 0", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--t-secondary,#d4d4d4)", whiteSpace: "pre-wrap" }}>{JSON.stringify(effect.params, null, 2)}</pre> : null;
  const said =
    effect.kind === "remove_node" ? <p style={{ margin: "0" }}>Remove <code>{effect.node_id}</code>. The steps after it read its inputs directly.</p>
    : effect.kind === "insert_node" ? <p style={{ margin: "0" }}>Add <code>{effect.node_id}</code> ({effect.operator}) before <code>{effect.before}</code>.</p>
    : effect.kind === "add_node" ? <p style={{ margin: "0" }}>Add <code>{effect.node_id}</code> ({effect.operator}) beside the pipeline.</p>
    : effect.kind === "set_input" ? <p style={{ margin: "0" }}>Feed <code>{effect.node_id}.{effect.port}</code> from <code>{effect.from}</code>.</p>
    : effect.operator === currentOperator ? <p style={{ margin: "0" }}>Change the settings of <code>{effect.node_id}</code>.</p>
    : <p style={{ margin: "0" }}>Replace <code>{effect.node_id}</code> with <code>{effect.operator}</code>.</p>;
  return (
    <div style={{ marginTop: "10px", padding: "10px 12px", borderRadius: "var(--r-sm,6px)", background: ink(0.04), fontSize: "12.5px", color: "var(--t-secondary,#d4d4d4)", lineHeight: "1.5" }}>
      <strong style={{ display: "block", fontWeight: "500", color: "var(--t-primary,#f2f2f2)", paddingBottom: "2px" }}>Preview</strong>
      {said}
      {settings}
    </div>
  );
}

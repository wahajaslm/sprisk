import type { Attempt, DecisionProposal, PipelineVersion, SelectionDecision } from "@sprisk/contracts";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { isLive, useOperators, useOperatorSource, useRuns } from "../api/hooks.ts";
import { useApplyMethodology, useMethodologyDecision, useMethodologyProposals, useMethodologyRules, useSelectModel } from "../api/methodology.ts";
import { useFlowRuns, useSelectionDecision } from "../api/runs.ts";
import { settingChanges, showValue } from "../flow/diff.ts";
import { useSelection } from "../workbench/selection.ts";
import { CodeInput } from "./CodeInput.tsx";
import { FigurePort } from "./inspector/FiguresTab.tsx";
import { formatMetric } from "./NodeFact.tsx";

const METRIC_LABEL: Record<SelectionDecision["metric"], string> = { balanced_accuracy: "balanced accuracy", rmse: "RMSE" };
type Candidate = SelectionDecision["candidates"][number];

/** How Sprisk chose this flow's models and preparation steps (ADR-0047). For the flow's head it
 * starts each choice itself; every comparison of the flow's versions is shown. */
export function ModelComparisons({ flowIds, head, versions }: { flowIds: string[]; head: PipelineVersion; versions: PipelineVersion[] }) {
  const comparisons = versions.flatMap((v) => (v.compares === undefined ? [] : [{ version: v, proposalId: v.compares }]));
  const proposals = useMethodologyProposals(comparisons.map((c) => c.proposalId));
  const mine = comparisons.flatMap((c, i) => {
    const proposal = proposals[i]?.data;
    const base = versions.find((v) => v.id === proposal?.pipeline_version_id);
    return proposal && base && flowIds.includes(base.id) ? [{ version: c.version, proposal, base }] : [];
  });
  const failed = proposals.find((p) => p.isError)?.error;
  return (
    <>
      <AutoSelect head={head} />
      {failed && <p role="alert" className="error pad">A model comparison cannot be shown: {failed.message}</p>}
      {mine.map(({ version, proposal, base }) => (
        <Comparison key={version.id} comparison={version} proposal={proposal} base={base} />
      ))}
      <TestRowsCautions head={head} />
    </>
  );
}

/** The head's steps Sprisk compares, each once the head has run: model steps a shortlist rule
 * decides, and steps a recommend rule decides that fit on train rows (ADR-0047). The server
 * says when such a step has nothing to compare. A step its own decision just chose is not
 * selected again: the head is that choice. */
function AutoSelect({ head }: { head: PipelineVersion }) {
  const rules = useMethodologyRules();
  const operators = useOperators();
  const active = (rules.data ?? []).filter((r) => r.status === "active");
  const shortlisted = new Set(active.filter((r) => r.selection === "shortlist").flatMap((r) => r.applies_to ?? []));
  const recommended = new Set(active.filter((r) => r.selection !== "shortlist").flatMap((r) => r.applies_to ?? []));
  const fitsOnTrain = (operator: string) => operators.data?.find((o) => o.id === operator)?.fits_on_train === true;
  const name = (operator: string) => operator.split("@")[0] ?? "";
  const steps = head.nodes.filter((n) => shortlisted.has(name(n.operator)) || (recommended.has(name(n.operator)) && fitsOnTrain(n.operator)));
  return steps.map((n) => (
    <AutoSelectStep key={`${head.id}/${n.id}`} head={head} nodeId={n.id} decisionId={n.methodology_decision_id} models={shortlisted.has(name(n.operator))} />
  ));
}

function AutoSelectStep({ head, nodeId, decisionId, models }: { head: PipelineVersion; nodeId: string; decisionId: string | undefined; models: boolean }) {
  const runs = useRuns(head.id);
  const decision = useMethodologyDecision(decisionId);
  const select = useSelectModel();
  const hasRun = (runs.data ?? []).some((r) => r.status === "succeeded");
  const chosenHere = decision.data?.pipeline_version_id === head.id;
  const waiting = decisionId !== undefined && decision.isPending;
  const due = hasRun && !chosenHere && !waiting;
  const { mutate } = select;
  // Once per mount: the server shares one selection between requests anyway (ADR-0047).
  const fired = useRef(false);
  useEffect(() => {
    if (!due || fired.current) return;
    fired.current = true;
    mutate({ pipelineId: head.id, nodeId });
  }, [due, head.id, nodeId, mutate]);
  const nothing = select.error instanceof ApiError ? select.error.errors.find((e) => e.code === "nothing_to_compare") : undefined;
  if (nothing) return <p className="muted pad">{nodeId}: {nothing.message}</p>;
  if (select.isError) return <p role="alert" className="error pad">Sprisk could not compare the choices for {nodeId}: {select.error.message}</p>;
  if (!hasRun && !runs.isPending && !chosenHere) {
    return <p className="muted pad">Run the flow, and Sprisk will compare {models ? "models" : "its choices"} for {nodeId}.</p>;
  }
  return null;
}

function Comparison({ comparison, proposal, base }: { comparison: PipelineVersion; proposal: DecisionProposal; base: PipelineVersion }) {
  const [latest] = useFlowRuns([comparison.id], 1);
  const selectNode = comparison.nodes.find((n) => n.operator.startsWith("sprisk.ml.select_model@"))?.id;
  const result = useSelectionDecision(latest, selectNode);
  const models = (proposal.shortlist ?? []).length > 0;
  const trials = comparison.nodes.filter((n) => n.operator.startsWith("sprisk.ml.cross_validate@")).length;
  return (
    <section className="model-comparison" aria-label={models ? "Model comparison" : "Preparation comparison"}>
      <p className="eyebrow">{models ? "Model selection" : "Preparation"} · {proposal.subject_node_id}</p>
      {result.status === "decided" ? (
        <Decided decision={result.decision} artifactId={result.artifactId} attempts={result.attempts} proposal={proposal} comparison={comparison} base={base} />
      ) : result.status === "failed" ? (
        <p role="alert" className="error">The comparison failed: {result.message}</p>
      ) : (
        <p className="muted">
          {result.status === "not_run" ? "Not run yet." : result.status === "running" || isLive(latest) ? `Cross-validating ${trials} ${models ? "models" : "choices"}…` : "Loading…"}
        </p>
      )}
    </section>
  );
}

function Decided({ decision, artifactId, attempts, proposal, comparison, base }: {
  decision: SelectionDecision;
  artifactId: string;
  attempts: Attempt[];
  proposal: DecisionProposal;
  comparison: PipelineVersion;
  base: PipelineVersion;
}) {
  const [picked, setPicked] = useState<string[]>(() => defaultPair(decision));
  const [choosing, setChoosing] = useState<string>();
  const why = (id: string) => proposal.alternatives.find((a) => a.id === id)?.reason;
  const reference = decision.baseline_role === "reference";
  const notCompared = decision.not_compared ?? [];
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2));
  const cvAttempt = (id: string) => attempts.filter((a) => a.node_id === `cv_${id}` && (a.state === "succeeded" || a.state === "cache_hit")).at(-1);
  return (
    <>
      <p className="muted">
        {decision.repeats && decision.repeats > 1 ? `${decision.repeats} × ` : ""}{decision.folds}-fold cross-validation, seed {decision.seed}, scored by {METRIC_LABEL[decision.metric]}, fixed before any score was seen. Train rows only: the test rows were not used.
      </p>
      <table className="exp-table" aria-label="Candidates">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Measure</span></th>
            {decision.candidates.map((c) => (
              <th key={c.id} scope="col" className={c.id === decision.winner ? "picked" : undefined}>
                <label>
                  <input type="checkbox" aria-label={`Compare ${c.id} in detail`} checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /> <span className="mono">{c.id}</span>
                </label>
                <div className="muted">{standing(c.id, decision)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label={reference ? "Why the rule offers it" : "Why on the shortlist"} cells={decision.candidates.map((c) => why(c.id) ?? "—")} />
          <Row label={`Mean ± spread (${METRIC_LABEL[decision.metric]})`} mono cells={decision.candidates.map((c) => `${formatMetric(c.mean)} ± ${formatMetric(c.spread)}`)} />
          <Row label="Fold scores" mono cells={decision.candidates.map(foldRange)} />
          <Row label={`Gain over ${reference ? "the recommendation" : "baseline"} ± corrected SE`} mono cells={decision.candidates.map(gain)} />
          <Row label="Verdict" cells={decision.candidates.map((c) => verdict(c, decision))} />
          <tr>
            <th scope="row"><span className="sr-only">Use</span></th>
            {decision.candidates.map((c) => (
              <td key={c.id}>
                <button type="button" className={c.id === decision.winner ? "run-code" : "page-btn"} onClick={() => setChoosing(c.id)}>Use {c.id}</button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {notCompared.length > 0 && (
        <p className="muted">
          {reference ? "Not measurable here" : "Not compared"}: {notCompared.map((n) => `${n.id} (${n.reason})`).join("; ")}
        </p>
      )}
      <p>{decision.reason}</p>
      {decision.limitations.length > 0 && (
        <div className="cautions">
          {decision.limitations.map((l) => (
            <p key={l}>⚠ {l}</p>
          ))}
        </div>
      )}
      {choosing && <UseModel key={choosing} id={choosing} recommended={choosing === decision.winner} winner={decision.winner} artifactId={artifactId} proposal={proposal} onCancel={() => setChoosing(undefined)} />}
      {picked.length > 0 && (
        <section className="compare" aria-label="Detail">
          {picked.map((id) => (
            <section key={id} className="compare-col" aria-label={`Detail of ${id}`}>
              <p className="eyebrow">{id} · from held-out folds of the train rows</p>
              <p className="mono">Fold scores: {decision.candidates.find((c) => c.id === id)?.fold_scores.map(formatMetric).join(" · ")}</p>
              <ChoiceSteps comparison={comparison} proposal={proposal} base={base} id={id} />
              <FigurePort attempt={cvAttempt(id)} port="figures" />
            </section>
          ))}
        </section>
      )}
    </>
  );
}

type Step = { operator: string; params: Record<string, unknown> };

/** What a choice ran in every fold, read from its cross-validate step: the split's train rows,
 * each preparation step refit, then the model (ADR-0047). The compiler checked these params
 * against the step's schema. How it differs from the flow is its effect, as Apply would make it. */
function ChoiceSteps({ comparison, proposal, base, id }: { comparison: PipelineVersion; proposal: DecisionProposal; base: PipelineVersion; id: string }) {
  const [open, setOpen] = useState<string>();
  const node = comparison.nodes.find((n) => n.id === `cv_${id}`);
  if (!node) return <p role="alert" className="error">{comparison.id} has no step cv_{id}.</p>;
  const rows = comparison.edges.find((e) => e.to === `${node.id}.train`)?.from;
  if (!rows) return <p role="alert" className="error">{node.id} has no train rows input.</p>;
  const steps = [...(node.params.prepare as Step[]), { operator: node.params.candidate as string, params: node.params.candidate_params as Step["params"] }];
  const effect = proposal.alternatives.find((a) => a.id === id)?.effect;
  return (
    <>
      <ol className="choice-steps" aria-label={`Steps of ${id}`}>
        <li className="mono">{rows}: train rows only</li>
        {steps.map((step, i) => (
          <li key={i}>
            <span className="mono">{step.operator.replace(/^sprisk\./, "").split("@")[0]}</span> ·{" "}
            {Object.entries(step.params).map(([k, v]) => `${k}: ${showValue(v)}`).join(", ")}{" "}
            <button type="button" className="page-btn" aria-label={`Code of ${step.operator}`} onClick={() => setOpen(open === step.operator ? undefined : step.operator)}>
              Code
            </button>
          </li>
        ))}
      </ol>
      {open && <StepCode operator={open} />}
      {effect && <p className="muted">Differs from the flow: {differences(base, effect)}</p>}
    </>
  );
}

function StepCode({ operator }: { operator: string }) {
  const source = useOperatorSource(operator);
  if (source.isPending) return <p className="muted">Loading code…</p>;
  if (source.isError) return <p role="alert" className="error">{source.error.message}</p>;
  return <CodeInput value={source.data.text} label={`Code of ${source.data.path}`} onChange={() => undefined} onRun={() => undefined} readOnly fit />;
}

/** How applying `effect` would change `base`, setting by setting. */
function differences(base: PipelineVersion, effect: NonNullable<DecisionProposal["alternatives"][number]["effect"]>): string {
  if (effect.kind === "remove_node") return `${effect.node_id} removed`;
  const before = base.nodes.find((n) => n.id === effect.node_id);
  if (!before) return `${effect.node_id} is not in the flow`;
  const after = { ...before, operator: effect.operator, params: effect.params };
  const changes = settingChanges({ ...base, nodes: [before] }, { ...base, nodes: [after] }).map(
    (c) => `${c.node} · ${c.key}: ${showValue(c.before)} → ${showValue(c.after)}`,
  );
  // The flow's step may run its own code (ADR-0028); every choice runs its operator's.
  const own = before.code ? [`${effect.node_id} · its own code → ${effect.operator}'s code`] : [];
  const all = [...own, ...changes];
  return all.length === 0 ? "nothing" : all.join("; ");
}

function Row({ label, cells, mono }: { label: string; cells: string[]; mono?: boolean }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {cells.map((cell, i) => (
        <td key={i} className={mono ? "mono" : undefined}>{cell}</td>
      ))}
    </tr>
  );
}

/** Applying the recommendation needs no reason; any other choice does (ADR-0047). Each choice is
 * a new version branched from the compared one. */
function UseModel({ id, recommended, winner, artifactId, proposal, onCancel }: {
  id: string;
  recommended: boolean;
  winner: string | undefined;
  artifactId: string;
  proposal: DecisionProposal;
  onCancel: () => void;
}) {
  const apply = useApplyMethodology();
  const selectPipelineVersion = useSelection((s) => s.selectPipelineVersion);
  const [reason, setReason] = useState("");
  const run = () =>
    apply.mutate(
      { proposalId: proposal.id, alternativeId: id, ...(recommended ? {} : { reason }) },
      { onSuccess: (applied) => selectPipelineVersion(applied.pipeline.id) },
    );
  return (
    <div className="method-choice" role="group" aria-label={`Use ${id}`}>
      {recommended ? (
        <p>Use {id}, as the comparison ({artifactId}) recommends. The flow gets a new version with it; run it to score the test rows once.</p>
      ) : (
        <label className="method-reason">
          {winner ? `Why ${id} instead of the recommended ${winner}?` : `Why ${id}, although no model beats the baseline?`}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <div className="settings-actions">
        <button type="button" className="page-btn" onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        <button type="button" className="run-code" disabled={apply.isPending || (!recommended && !reason.trim())} onClick={run}>
          {apply.isPending ? "Applying…" : `Apply ${id} to a new version`}
        </button>
      </div>
      {apply.isError && <p role="alert" className="error">{apply.error.message}</p>}
    </div>
  );
}

/** One caution per step of the head whose choice was made after the test rows had been
 * scored: its test score is then no longer an unbiased estimate (arch doc §11). */
function TestRowsCautions({ head }: { head: PipelineVersion }) {
  const decided = head.nodes.flatMap((n) => (n.methodology_decision_id ? [n.methodology_decision_id] : []));
  return decided.map((id) => <TestRowsCaution key={id} decisionId={id} />);
}

function TestRowsCaution({ decisionId }: { decisionId: string }) {
  const decision = useMethodologyDecision(decisionId);
  const seen = decision.data?.test_rows_seen_by ?? [];
  if (seen.length === 0) return null;
  return (
    <div className="cautions pad">
      <p>⚠ {decision.data?.subject_node_id} was chosen after {seen.join(", ")} had already scored the same test rows. Its test score is no longer an unbiased estimate.</p>
    </div>
  );
}

/** Under a candidate's name: whether it is recommended, and what its baseline is for. */
function standing(id: string, decision: SelectionDecision): string {
  const baseline = id === decision.baseline;
  if (decision.baseline_role === "reference" && baseline) return id === decision.winner ? "recommended, as the rule's reference" : "the rule's reference";
  if (id === decision.winner) return "recommended";
  return baseline ? "baseline (the floor)" : "";
}

/** The recommendation and the best other model that is not the baseline. */
function defaultPair(decision: SelectionDecision): string[] {
  const sign = decision.metric === "rmse" ? -1 : 1;
  const others = decision.candidates
    .filter((c) => c.id !== decision.winner && c.id !== decision.baseline)
    .sort((a, b) => sign * (b.mean - a.mean));
  return [decision.winner, others[0]?.id].filter((id): id is string => id !== undefined).slice(0, 2);
}

function gain(c: Candidate): string {
  const versus = c.versus_baseline;
  if (!versus) return "—";
  const p = versus.p_value === undefined ? "" : `, p = ${formatMetric(versus.p_value)}`;
  return `${versus.mean_difference >= 0 ? "+" : "−"}${formatMetric(Math.abs(versus.mean_difference))} ± ${formatMetric(versus.corrected_se)}${p}`;
}

/** Where a candidate stands, claiming no more than was tested: with a p value the corrected
 * t-test decided; without one (older decisions) the one-SE screen did. */
function verdict(c: Candidate, decision: SelectionDecision): string {
  const reference = decision.baseline_role === "reference";
  if (c.id === decision.baseline) return reference ? (c.id === decision.winner ? "stands: none beats it" : "beaten") : "the floor";
  if (c.id === decision.winner) return "recommended";
  const versus = c.versus_baseline;
  if (!versus) return "—";
  const against = reference ? "the recommendation" : "the baseline";
  if (versus.p_value !== undefined) return versus.beats_baseline ? `beats ${against} (tested)` : `not shown to beat ${against}`;
  if (versus.beats_baseline) return "clears the 1-SE bar";
  if (versus.mean_difference < -versus.corrected_se) return "worse than baseline";
  return "within 1 SE of baseline";
}

/** How many fold scores a model has, and their range; its detail lists every one. */
function foldRange(c: Candidate): string {
  const scores = c.fold_scores;
  if (scores.length === 0) return "—";
  return `${scores.length} scores, ${formatMetric(Math.min(...scores))} to ${formatMetric(Math.max(...scores))}`;
}

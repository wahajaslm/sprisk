import type { Attempt, DecisionProposal, PipelineVersion, SelectionDecision } from "@sprisk/contracts";
import { useEffect, useRef, useState } from "react";

import { isLive, useRuns } from "../api/hooks.ts";
import { useApplyMethodology, useMethodologyDecision, useMethodologyProposals, useMethodologyRules, useSelectModel } from "../api/methodology.ts";
import { useFlowRuns, useSelectionDecision } from "../api/runs.ts";
import { useSelection } from "../workbench/selection.ts";
import { FigurePort } from "./inspector/FiguresTab.tsx";
import { formatMetric } from "./NodeFact.tsx";

const METRIC_LABEL: Record<SelectionDecision["metric"], string> = { balanced_accuracy: "balanced accuracy", rmse: "RMSE" };
type Candidate = SelectionDecision["candidates"][number];

/** How Sprisk chose this flow's models (ADR-0047). For the flow's head it starts the choice
 * itself; every comparison of the flow's versions is shown. */
export function ModelComparisons({ flowIds, head, versions }: { flowIds: string[]; head: PipelineVersion; versions: PipelineVersion[] }) {
  const comparisons = versions.flatMap((v) => (v.compares === undefined ? [] : [{ version: v, proposalId: v.compares }]));
  const proposals = useMethodologyProposals(comparisons.map((c) => c.proposalId));
  const mine = comparisons.flatMap((c, i) => {
    const proposal = proposals[i]?.data;
    return proposal && flowIds.includes(proposal.pipeline_version_id) ? [{ version: c.version, proposal }] : [];
  });
  const failed = proposals.find((p) => p.isError)?.error;
  return (
    <>
      <AutoSelect head={head} />
      {failed && <p role="alert" className="error pad">A model comparison cannot be shown: {failed.message}</p>}
      {mine.map(({ version, proposal }) => (
        <Comparison key={version.id} comparison={version} proposal={proposal} />
      ))}
      <TestRowsCautions head={head} />
    </>
  );
}

/** The head's model steps that a shortlist rule decides, each selected once the head has run.
 * A step its own decision just chose is not selected again: the head is that choice. */
function AutoSelect({ head }: { head: PipelineVersion }) {
  const rules = useMethodologyRules();
  const shortlisted = new Set(
    (rules.data ?? []).filter((r) => r.status === "active" && r.selection === "shortlist").flatMap((r) => r.applies_to ?? []),
  );
  const steps = head.nodes.filter((n) => shortlisted.has(n.operator.split("@")[0] ?? ""));
  return steps.map((n) => <AutoSelectStep key={`${head.id}/${n.id}`} head={head} nodeId={n.id} decisionId={n.methodology_decision_id} />);
}

function AutoSelectStep({ head, nodeId, decisionId }: { head: PipelineVersion; nodeId: string; decisionId: string | undefined }) {
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
  if (select.isError) return <p role="alert" className="error pad">Sprisk could not choose a model for {nodeId}: {select.error.message}</p>;
  if (!hasRun && !runs.isPending && !chosenHere) return <p className="muted pad">Run the flow, and Sprisk will compare models for {nodeId}.</p>;
  return null;
}

function Comparison({ comparison, proposal }: { comparison: PipelineVersion; proposal: DecisionProposal }) {
  const [latest] = useFlowRuns([comparison.id], 1);
  const selectNode = comparison.nodes.find((n) => n.operator.startsWith("sprisk.ml.select_model@"))?.id;
  const result = useSelectionDecision(latest, selectNode);
  return (
    <section className="model-comparison" aria-label="Model comparison">
      <p className="eyebrow">Model selection · {proposal.subject_node_id}</p>
      {result.status === "decided" ? (
        <Decided decision={result.decision} artifactId={result.artifactId} attempts={result.attempts} proposal={proposal} />
      ) : result.status === "failed" ? (
        <p role="alert" className="error">The comparison failed: {result.message}</p>
      ) : (
        <p className="muted">
          {result.status === "not_run" ? "Not run yet." : result.status === "running" || isLive(latest) ? `Cross-validating ${proposal.shortlist?.length ?? 0} models…` : "Loading…"}
        </p>
      )}
    </section>
  );
}

function Decided({ decision, artifactId, attempts, proposal }: { decision: SelectionDecision; artifactId: string; attempts: Attempt[]; proposal: DecisionProposal }) {
  const ids = decision.candidates.map((c) => c.id);
  const [picked, setPicked] = useState<string[]>(() => defaultPair(decision));
  const [choosing, setChoosing] = useState<string>();
  const why = (id: string) => proposal.alternatives.find((a) => a.id === id)?.reason;
  const leftOff = proposal.alternatives.filter((a) => !ids.includes(a.id));
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
                <div className="muted">{c.id === decision.winner ? "recommended" : c.id === decision.baseline ? "baseline (the floor)" : ""}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Why on the shortlist" cells={decision.candidates.map((c) => why(c.id) ?? "—")} />
          <Row label={`Mean ± spread (${METRIC_LABEL[decision.metric]})`} mono cells={decision.candidates.map((c) => `${formatMetric(c.mean)} ± ${formatMetric(c.spread)}`)} />
          <Row label="Fold scores" mono cells={decision.candidates.map(foldRange)} />
          <Row label="Gain over baseline ± corrected SE" mono cells={decision.candidates.map(gain)} />
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
      {leftOff.length > 0 && (
        <p className="muted">Left off the shortlist: {leftOff.map((a) => `${a.id} (${a.reason})`).join("; ")}</p>
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
              <FigurePort attempt={cvAttempt(id)} port="figures" />
            </section>
          ))}
        </section>
      )}
    </>
  );
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
  if (c.id === decision.baseline) return "the floor";
  if (c.id === decision.winner) return "recommended";
  const versus = c.versus_baseline;
  if (!versus) return "—";
  if (versus.p_value !== undefined) return versus.beats_baseline ? "beats the baseline (tested)" : "not shown to beat the baseline";
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

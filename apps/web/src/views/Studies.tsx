import type { PipelineVersion, Study, StudyDetail } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";

import { useMethodologyProposal } from "../api/methodology.ts";
import { type StudyRequest, useCreateStudy, useStudy } from "../api/studies.ts";
import { tablePageQuery } from "../api/hooks.ts";
import { Button } from "../components/ui/Button.tsx";
import { KeyValues, ParallelChart } from "../components/ui/StudioVisuals.tsx";
import { parallelLines, searchSpace } from "./experiments/sweep.ts";
import { Comparison, showSettings, useComparedSteps } from "./ModelComparison.tsx";
import { formatMetric } from "./NodeFact.tsx";

/** The head's studies (ADR-0052), newest first, as the design's Sweep: a way to start one per
 * model step, then each study's search. */
export function Studies({ head, versions, studies }: { head: PipelineVersion; versions: PipelineVersion[]; studies: Study[] }) {
  const steps = useComparedSteps(head).filter((s) => s.models);
  return (
    <div className="exp-body">
      {steps.length > 0 && (
        <div className="exp-toolbar">
          {steps.map(({ node }) => (
            <NewStudy key={`${head.id}/${node.id}`} pipelineId={head.id} nodeId={node.id} />
          ))}
        </div>
      )}
      {studies.map((study) => (
        <StudyCard key={study.id} id={study.id} versions={versions} siblings={studies.filter((s) => s.node_id === study.node_id && s.id !== study.id)} />
      ))}
    </div>
  );
}

/** What makes two studies of one step not directly comparable (ADR-0052, SCI-10). */
const PROTOCOL: { field: keyof Study; label: string }[] = [
  { field: "strategy", label: "strategy" },
  { field: "seed", label: "seed" },
  { field: "max_trials", label: "trial budget" },
  { field: "max_wall_seconds", label: "wall-time budget" },
  { field: "guardrails", label: "guardrails" },
];

function StudyCard({ id, versions, siblings }: { id: string; versions: PipelineVersion[]; siblings: Study[] }) {
  const detail = useStudy(id);
  const scores = useTrialScores(detail.data?.trials ?? []);
  if (detail.isError) return <p role="alert" className="error pad">Study {id} cannot be shown: {detail.error.message}</p>;
  if (!detail.data) return <p className="muted pad">Loading study {id}…</p>;
  const { study, trials } = detail.data;
  const finished = trials.filter((t) => t.state === "succeeded").length;
  const tuned = trials.filter((t) => Object.keys(t.settings).length > 0);
  const lines = parallelLines(tuned, scores, "score");
  return (
    <section className="exp-study" aria-label={`Study of ${study.node_id}`}>
      <header className="exp-study-head">
        <h3>{`Study of ${study.node_id}`}</h3>
        <span className={`status-${study.status}`}>{study.status.replaceAll("_", " ")}</span>
      </header>
      <p className="muted">
        {study.strategy} search{study.strategy === "random" ? `, seed ${study.seed}` : ""} · {finished} of {trials.length} trials finished · budget{" "}
        {study.max_trials} trials, wall time {study.max_wall_seconds} s{study.deadline ? `, until ${study.deadline}` : ""}
      </p>
      {study.guardrails.map((g, i) => (
        <p key={i} className="muted">
          Guardrail: recall of {g.label} at least {g.at_least}, declared before this study's scores.
        </p>
      ))}
      {siblings.length > 0 && <Siblings study={study} siblings={siblings} />}
      <div className="sv-split">
        <div className="sv-chart">
          <span className="sv-caption">Parallel coordinates · each line is one trial; the bright line is the best so far</span>
          {lines.lines.length >= 2 ? <ParallelChart name={`Trials of ${study.node_id}`} axes={lines.axes} lines={lines.lines} best={lines.best} /> : <p className="muted">Drawn once two tuned trials have scores.</p>}
        </div>
        <div className="sv-chart">
          <span className="sv-caption">Search space</span>
          <Searched trials={trials} />
          <span className="sv-caption">Trials, best first</span>
          <TrialTable trials={trials} scores={scores} />
        </div>
      </div>
      {study.status === "budget_reached" && (
        <p className="exp-caution">
          The wall-time budget ran out: {finished} finished trials are kept and nothing was decided. A study with more time reuses them.
        </p>
      )}
      {study.status === "completed" && <StudyDecision study={study} versions={versions} />}
      {study.status === "failed" && <p role="alert" className="error">The study failed: a step failed after its retries.</p>}
    </section>
  );
}

/** Each trial's mean fold score, read from its scores table (at most a few dozen folds). A
 * trial with no scores yet has none. */
function useTrialScores(trials: StudyDetail["trials"]): Map<string, number> {
  const scored = trials.filter((t): t is typeof t & { scores: string } => t.scores !== undefined);
  const pages = useQueries({ queries: scored.map((t) => tablePageQuery(t.scores, 0, MAX_FOLD_ROWS)) });
  const means = new Map<string, number>();
  scored.forEach((t, i) => {
    const page = pages[i]?.data;
    const at = page?.columns.findIndex((c) => c.name === "score") ?? -1;
    if (!page || at < 0) return;
    const values = page.rows.map((r) => Number(r.values[at])).filter(Number.isFinite);
    if (values.length > 0) means.set(t.node_id, values.reduce((a, b) => a + b, 0) / values.length);
  });
  return means;
}

/** Most fold rows read per trial: folds times repeats stays well under it. */
const MAX_FOLD_ROWS = 100;

/** The settings the study searched, as the design's search space: each with its range or the
 * values tried. */
function Searched({ trials }: { trials: StudyDetail["trials"] }) {
  if (trials.length === 0) return null;
  const space = searchSpace(trials.filter((t) => Object.keys(t.settings).length > 0));
  if (space.length === 0) return <p className="muted">Searched: nothing; no shortlisted model declares settings to tune.</p>;
  return <KeyValues label="Search space" rows={space.map((s) => [s.setting, s.text])} />;
}

/** Every trial, the best scored first; a trial with no score yet keeps its place after them. */
function TrialTable({ trials, scores }: { trials: StudyDetail["trials"]; scores: Map<string, number> }) {
  const ranked = [...trials].sort((a, b) => (scores.get(b.node_id) ?? Number.NEGATIVE_INFINITY) - (scores.get(a.node_id) ?? Number.NEGATIVE_INFINITY));
  return (
    <table className="exp-table" aria-label="Trials">
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Settings</th>
          <th scope="col">State</th>
          <th scope="col" className="num">Mean score</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((t) => (
          <tr key={t.node_id}>
            <td className="mono">{t.candidate}</td>
            <td className="mono">{Object.keys(t.settings).length === 0 ? "the flow's settings" : showSettings(t.settings)}</td>
            <td className={`mono status-${t.state}`}>{t.state.replaceAll("_", " ")}</td>
            <td className="num mono">{scores.has(t.node_id) ? formatMetric(scores.get(t.node_id)!) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The decision, read and applied like every comparison's. */
function StudyDecision({ study, versions }: { study: Study; versions: PipelineVersion[] }) {
  const proposal = useMethodologyProposal(study.proposal_id);
  const comparison = versions.find((v) => v.id === study.comparison_id);
  const base = versions.find((v) => v.id === study.pipeline_version_id);
  if (proposal.isError) return <p role="alert" className="error">The study's proposal cannot be read: {proposal.error.message}</p>;
  if (!proposal.data || !comparison || !base) return <p className="muted">Loading the decision…</p>;
  return <Comparison comparison={comparison} proposal={proposal.data} base={base} label={`Decision of study ${study.id}`} />;
}

/** Starts a study: a strategy and a budget, both stated; settings come from model manifests. */
function NewStudy({ pipelineId, nodeId }: { pipelineId: string; nodeId: string }) {
  const [open, setOpen] = useState(false);
  const create = useCreateStudy();
  const [strategy, setStrategy] = useState<StudyRequest["strategy"]>("grid");
  const [seed, setSeed] = useState("0");
  const [trials, setTrials] = useState("20");
  const [seconds, setSeconds] = useState("600");
  const [label, setLabel] = useState("");
  const [atLeast, setAtLeast] = useState("");
  if (!open) {
    return <Button onClick={() => setOpen(true)}>{`Study ${nodeId}`}</Button>;
  }
  const request: StudyRequest = {
    strategy,
    seed: Number(seed),
    max_trials: Number(trials),
    max_wall_seconds: Number(seconds),
    guardrails: label.trim() ? [{ metric: "recall", label: label.trim(), at_least: Number(atLeast) }] : [],
  };
  return (
    <form
      className="method-choice"
      aria-label={`New study of ${nodeId}`}
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ pipelineId, nodeId, request }, { onSuccess: () => setOpen(false) });
      }}
    >
      <fieldset>
        <legend>Search</legend>
        <label>
          <input type="radio" name="strategy" checked={strategy === "grid"} onChange={() => setStrategy("grid")} /> Grid
        </label>
        <label>
          <input type="radio" name="strategy" checked={strategy === "random"} onChange={() => setStrategy("random")} /> Random
        </label>
        <label>
          Seed <input type="number" required min={0} step={1} value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
      </fieldset>
      <fieldset>
        <legend>Budget</legend>
        <label>
          Most trials <input type="number" required min={1} step={1} value={trials} onChange={(e) => setTrials(e.target.value)} />
        </label>
        <label>
          Most seconds <input type="number" required min={1} step={1} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        </label>
      </fieldset>
      <fieldset>
        <legend>Guardrail (optional)</legend>
        <label>
          Minimum recall of class <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          At least <input type="number" min={0} max={1} step="0.01" value={atLeast} onChange={(e) => setAtLeast(e.target.value)} />
        </label>
      </fieldset>
      <div className="settings-actions">
        <button type="button" className="page-btn" onClick={() => setOpen(false)}>Cancel</button>
        <span className="spacer" />
        <button type="submit" className="run-code" disabled={create.isPending || (label.trim() === "") !== (atLeast === "")}>
          {create.isPending ? "Starting…" : "Start the study"}
        </button>
      </div>
      {create.isError && <p role="alert" className="error">{create.error.message}</p>}
    </form>
  );
}

/** Other studies of the same step look at the same folds: keeping the best of them favours
 * luck, and those that differ are not directly comparable. */
function Siblings({ study, siblings }: { study: Study; siblings: Study[] }) {
  const differ = PROTOCOL.filter(({ field }) => siblings.some((s) => JSON.stringify(s[field]) !== JSON.stringify(study[field])));
  return (
    <div className="exp-caution">
      <p>
        {study.node_id} has {siblings.length + 1} studies on the same folds. Keeping the best of several favours luck.
        {differ.length > 0 && ` Not directly comparable with the others: they differ in ${differ.map((d) => d.label).join(", ")}.`}
      </p>
    </div>
  );
}

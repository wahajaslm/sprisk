import type { PipelineVersion, Study, StudyDetail } from "@sprisk/contracts";
import { useState } from "react";

import { useMethodologyProposal } from "../api/methodology.ts";
import { type StudyRequest, useCreateStudy, useStudy } from "../api/studies.ts";
import { showValue } from "../flow/diff.ts";
import { Comparison, showSettings, useComparedSteps } from "./ModelComparison.tsx";

/** The head's studies (ADR-0051), newest first, and a way to start one per model step. */
export function Studies({ head, versions, studies }: { head: PipelineVersion; versions: PipelineVersion[]; studies: Study[] }) {
  const steps = useComparedSteps(head).filter((s) => s.models);
  return (
    <>
      {steps.map(({ node }) => (
        <NewStudy key={`${head.id}/${node.id}`} pipelineId={head.id} nodeId={node.id} />
      ))}
      {studies.map((study) => (
        <StudyCard key={study.id} id={study.id} versions={versions} siblings={studies.filter((s) => s.node_id === study.node_id && s.id !== study.id)} />
      ))}
    </>
  );
}

/** What makes two studies of one step not directly comparable (ADR-0051, SCI-10). */
const PROTOCOL: { field: keyof Study; label: string }[] = [
  { field: "strategy", label: "strategy" },
  { field: "seed", label: "seed" },
  { field: "max_trials", label: "trial budget" },
  { field: "max_wall_seconds", label: "wall-time budget" },
  { field: "guardrails", label: "guardrails" },
];

function StudyCard({ id, versions, siblings }: { id: string; versions: PipelineVersion[]; siblings: Study[] }) {
  const detail = useStudy(id);
  if (detail.isError) return <p role="alert" className="error pad">Study {id} cannot be shown: {detail.error.message}</p>;
  if (!detail.data) return <p className="muted pad">Loading study {id}…</p>;
  const { study, trials } = detail.data;
  const finished = trials.filter((t) => t.state === "succeeded").length;
  return (
    <section className="model-comparison" aria-label={`Study of ${study.node_id}`}>
      <p className="eyebrow">Study · {study.node_id} · {study.status.replaceAll("_", " ")}</p>
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
      <Searched trials={trials} />
      <TrialTable trials={trials} />
      {study.status === "budget_reached" && (
        <div className="cautions">
          <p>
            ⚠ The wall-time budget ran out: {finished} finished trials are kept and nothing was decided. A study with more time
            reuses them.
          </p>
        </div>
      )}
      {study.status === "completed" && <StudyDecision study={study} versions={versions} />}
      {study.status === "failed" && <p role="alert" className="error">The study failed: a step failed after its retries.</p>}
    </section>
  );
}

/** Each tuned model's settings and the values its trials tried, in trial order. */
function Searched({ trials }: { trials: StudyDetail["trials"] }) {
  const tried = new Map<string, Map<string, unknown[]>>();
  for (const t of trials) {
    for (const [setting, value] of Object.entries(t.settings)) {
      const settings = tried.get(t.candidate) ?? new Map<string, unknown[]>();
      const values = settings.get(setting) ?? [];
      if (!values.some((v) => showValue(v) === showValue(value))) values.push(value);
      settings.set(setting, values);
      tried.set(t.candidate, settings);
    }
  }
  if (trials.length === 0) return null;
  if (tried.size === 0) return <p className="muted">Searched: nothing; no shortlisted model declares settings to tune.</p>;
  return (
    <p className="muted">
      Searched:{" "}
      {[...tried]
        .map(([candidate, settings]) => `${candidate} · ${[...settings].map(([k, vs]) => `${k}: ${vs.map(showValue).join(", ")}`).join("; ")}`)
        .join(" — ")}
    </p>
  );
}

function TrialTable({ trials }: { trials: StudyDetail["trials"] }) {
  return (
    <table className="exp-table" aria-label="Trials">
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Settings</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {trials.map((t) => (
          <tr key={t.node_id}>
            <td className="mono">{t.candidate}</td>
            <td className="mono">{Object.keys(t.settings).length === 0 ? "the flow's settings" : showSettings(t.settings)}</td>
            <td className={`mono status-${t.state}`}>{t.state.replaceAll("_", " ")}</td>
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
    return (
      <p className="pad">
        <button type="button" className="page-btn" onClick={() => setOpen(true)}>
          Study {nodeId}
        </button>
      </p>
    );
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
    <div className="cautions">
      <p>
        ⚠ {study.node_id} has {siblings.length + 1} studies on the same folds. Keeping the best of several favours luck.
        {differ.length > 0 && ` Not directly comparable with the others: they differ in ${differ.map((d) => d.label).join(", ")}.`}
      </p>
    </div>
  );
}

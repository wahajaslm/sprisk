import type { Fact, PipelineVersion, QuestionVersion, TaskType } from "@sprisk/contracts";
import { useState } from "react";
import { ulid } from "ulid";
import { usePipelineVersions, useSavePipelineVersion } from "../api/hooks.ts";
import { useQuestionVersions, useSaveQuestionVersion } from "../api/questions.ts";
import { timestamp } from "../flow/edit.ts";
import { useSelection } from "../workbench/selection.ts";
import { PageHeader } from "../components/ui/PageHeader.tsx";
import { Loading } from "../components/ui/Loading.tsx";

const EXAMPLE = {
  objective: "Predict which orders will be returned within 30 days.",
  task: "classification" as TaskType,
  target: "returned_within_30d",
  unit: "order",
  entity: "order_id",
  time: "order_date",
  horizon: "P30D",
  assumptions: "Return labels are complete after 30 days.",
  unknowns: "Are exchanges counted as returns?",
  criteria: "Average precision beats the dummy baseline on temporal validation.",
  positive: "",
  falseNegative: "",
  falsePositive: "",
  interpretability: "" as Interpretability | "",
};

type Draft = typeof EXAMPLE;
type Interpretability = NonNullable<QuestionVersion["interpretability"]>["value"];
const fact = (value: string): Fact => ({ value: value.trim(), origin: "explicit" });
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

/** The draft's misclassification costs (ADR-0053): the positive class and both costs as
 * positive numbers, or none of them. Only a classification question has costs. */
function costsOf(draft: Draft): QuestionVersion["costs"] | "incomplete" | undefined {
  const positive = draft.positive.trim();
  const given = [positive, draft.falseNegative.trim(), draft.falsePositive.trim()];
  if (draft.task !== "classification" || given.every((part) => !part)) return undefined;
  const [falseNegative, falsePositive] = [Number(given[1]), Number(given[2])];
  const valid = (cost: number) => Number.isFinite(cost) && cost > 0;
  if (!positive || !given[1] || !given[2] || !valid(falseNegative) || !valid(falsePositive)) return "incomplete";
  return { value: { positive, false_negative: falseNegative, false_positive: falsePositive }, origin: "explicit" };
}

/** The investigation's immutable question revisions. This is the context methodology reads. */
export function QuestionLedger() {
  const questions = useQuestionVersions();
  const pipelines = usePipelineVersions();
  const pipelineId = useSelection((state) => state.pipelineVersionId);
  const current = pipelines.data?.find((pipeline) => pipeline.id === pipelineId);
  const selected = questions.data?.find((question) => question.id === current?.question_version_id);
  const [editing, setEditing] = useState<QuestionVersion | "new" | undefined>();

  return (
    <main className="ledger">
      <PageHeader
        eyebrow="Investigation Atlas"
        title="Question ledger"
        description="What this analysis is trying to establish, preserved as immutable revisions."
        actions={<button type="button" className="page-btn" onClick={() => setEditing("new")}>New question</button>}
      />
      {questions.isError && <p role="alert" className="error pad">{questions.error.message}</p>}
      {pipelines.isError && <p role="alert" className="error pad">{pipelines.error.message}</p>}
      {questions.isPending ? <Loading text="Loading question ledger…" pad /> : (
        <div className="ledger-body">
          {current && <section className="ledger-current" aria-label="Current flow question">
            <h2>Current flow</h2>
            {selected ? <QuestionCard question={selected} current pipeline={current} onRevise={() => setEditing(selected)} /> : (
              <p>This flow has no question revision. Link one below before methodology makes recommendations.</p>
            )}
          </section>}
          <section aria-label="Question revisions">
            <h2>Ledger entries</h2>
            {(questions.data ?? []).length === 0 ? (
              <div className="ledger-empty">
                <p>No question has been recorded yet.</p>
                <button type="button" className="page-btn" onClick={() => setEditing("new")}>Start with the returns example</button>
              </div>
            ) : (
              <div className="ledger-list">
                {(questions.data ?? []).map((question) => (
                  <QuestionCard key={question.id} question={question} pipeline={current} current={question.id === current?.question_version_id} onRevise={() => setEditing(question)} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {editing && <QuestionEditor base={editing === "new" ? undefined : editing} pipeline={current} onClose={() => setEditing(undefined)} />}
    </main>
  );
}

function QuestionCard({ question, pipeline, current = false, onRevise }: {
  question: QuestionVersion; pipeline: PipelineVersion | undefined; current?: boolean; onRevise: () => void;
}) {
  const savePipeline = useSavePipelineVersion();
  const selectPipeline = useSelection((state) => state.selectPipelineVersion);
  const link = () => {
    if (!pipeline) return;
    const version: PipelineVersion = {
      ...pipeline,
      id: `plv_${ulid()}`,
      parent_id: pipeline.id,
      question_version_id: question.id,
      created_at: timestamp(),
    };
    savePipeline.mutate(version, { onSuccess: (saved) => selectPipeline(saved.id) });
  };
  return <article className={`ledger-entry${current ? " current" : ""}`}>
    <header><h3>{question.objective.value}</h3>{current && <span className="ledger-tag">current flow</span>}</header>
    <dl>
      <dt>Task</dt><dd>{question.task.value}</dd>
      <dt>Target</dt><dd>{question.target?.value ?? "not defined"}</dd>
      <dt>Unit</dt><dd>{question.unit_of_analysis?.value ?? "unknown"}</dd>
      <dt>Entity key</dt><dd>{question.entity_column?.value ?? "not defined"}</dd>
      <dt>Time</dt><dd>{question.time_column?.value ?? "not defined"}</dd>
      <dt>Horizon</dt><dd>{question.prediction_horizon?.value ?? "not defined"}</dd>
      <dt>Interpretability</dt><dd>{question.interpretability?.value ?? "not stated"}</dd>
      {question.costs && <>
        <dt>Misclassification costs</dt>
        <dd>{question.costs.value.positive} · false negative {question.costs.value.false_negative} · false positive {question.costs.value.false_positive}</dd>
      </>}
    </dl>
    {question.unknowns.length > 0 && <p className="ledger-unknown">Open: {question.unknowns.map((item) => item.question).join(" · ")}</p>}
    <p className="tech">{question.id}{question.parent_id ? ` · revises ${question.parent_id}` : " · first revision"}</p>
    <div className="ledger-actions">
      <button type="button" className="page-btn" onClick={onRevise}>Revise</button>
      {pipeline && !current && <button type="button" className="page-btn" disabled={savePipeline.isPending} onClick={link}>{savePipeline.isPending ? "Linking…" : "Use for current flow"}</button>}
      {savePipeline.isError && <span role="alert" className="error">{savePipeline.error.message}</span>}
    </div>
  </article>;
}

function QuestionEditor({ base, pipeline, onClose }: { base: QuestionVersion | undefined; pipeline: PipelineVersion | undefined; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => base ? {
    objective: base.objective.value, task: base.task.value, target: base.target?.value ?? "",
    unit: base.unit_of_analysis?.value ?? "", entity: base.entity_column?.value ?? "",
    time: base.time_column?.value ?? "", horizon: base.prediction_horizon?.value ?? "",
    assumptions: base.assumptions.map((item) => item.value).join("\n"),
    unknowns: base.unknowns.map((item) => item.question).join("\n"),
    criteria: base.acceptance_criteria.map((item) => item.value).join("\n"),
    positive: base.costs?.value.positive ?? "",
    falseNegative: base.costs ? String(base.costs.value.false_negative) : "",
    falsePositive: base.costs ? String(base.costs.value.false_positive) : "",
    interpretability: base.interpretability?.value ?? "",
  } : EXAMPLE);
  const save = useSaveQuestionVersion();
  const savePipeline = useSavePipelineVersion();
  const selectPipeline = useSelection((state) => state.selectPipelineVersion);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const costs = costsOf(draft);
  const submit = () => {
    if (costs === "incomplete") return;
    const question: QuestionVersion = {
      schema_version: "sprisk.question_version/v1",
      id: `qv_${ulid()}`,
      investigation_id: base?.investigation_id ?? `inv_${ulid()}`,
      ...(base ? { parent_id: base.id } : {}),
      objective: fact(draft.objective),
      task: { value: draft.task, origin: "explicit" },
      ...(draft.target.trim() ? { target: fact(draft.target) } : {}),
      ...(draft.unit.trim() ? { unit_of_analysis: fact(draft.unit) } : {}),
      ...(draft.entity.trim() ? { entity_column: fact(draft.entity) } : {}),
      ...(draft.time.trim() ? { time_column: fact(draft.time) } : {}),
      ...(draft.horizon.trim() ? { prediction_horizon: fact(draft.horizon) } : {}),
      assumptions: lines(draft.assumptions).map(fact),
      unknowns: lines(draft.unknowns).map((question) => ({ question, blocks: "release" as const })),
      acceptance_criteria: lines(draft.criteria).map(fact),
      ...(costs ? { costs } : {}),
      ...(draft.interpretability ? { interpretability: { value: draft.interpretability, origin: "explicit" as const } } : {}),
      created_at: timestamp(),
    };
    save.mutate(question, {
      onSuccess: (saved) => {
        if (!pipeline) { onClose(); return; }
        const linked: PipelineVersion = { ...pipeline, id: `plv_${ulid()}`, parent_id: pipeline.id, question_version_id: saved.id, created_at: timestamp() };
        savePipeline.mutate(linked, { onSuccess: (version) => { selectPipeline(version.id); onClose(); } });
      },
    });
  };
  const pending = save.isPending || savePipeline.isPending;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ledger-editor" role="dialog" aria-modal="true" aria-label={base ? "Revise question" : "New question"}>
      <header><div><p className="eyebrow">Immutable ledger entry</p><h2>{base ? "Revise question" : "New question"}</h2></div><button type="button" className="page-btn" onClick={onClose}>Close</button></header>
      <label>Objective<textarea value={draft.objective} onChange={(event) => set("objective", event.target.value)} /></label>
      <div className="ledger-fields">
        <label>Task<select value={draft.task} onChange={(event) => set("task", event.target.value as TaskType)}><option value="undetermined">Undetermined</option><option value="exploration">Exploration</option><option value="classification">Classification</option><option value="regression">Regression</option></select></label>
        <label>Target<input value={draft.target} onChange={(event) => set("target", event.target.value)} /></label>
        <label>Unit of analysis<input value={draft.unit} onChange={(event) => set("unit", event.target.value)} /></label>
        <label>Entity column<input value={draft.entity} onChange={(event) => set("entity", event.target.value)} /></label>
        <label>Time column<input value={draft.time} onChange={(event) => set("time", event.target.value)} /></label>
        <label>Prediction horizon<input value={draft.horizon} onChange={(event) => set("horizon", event.target.value)} placeholder="P30D" /></label>
        <label>Interpretability<select value={draft.interpretability} onChange={(event) => set("interpretability", event.target.value as Interpretability | "")}><option value="">Not stated</option><option value="high">High: a person follows each prediction</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
      </div>
      {draft.task === "classification" && <fieldset className="ledger-fields">
        <legend>Misclassification costs</legend>
        <label>Positive class<input value={draft.positive} onChange={(event) => set("positive", event.target.value)} placeholder="bad" /></label>
        <label>False-negative cost<input inputMode="decimal" value={draft.falseNegative} onChange={(event) => set("falseNegative", event.target.value)} placeholder="5" /></label>
        <label>False-positive cost<input inputMode="decimal" value={draft.falsePositive} onChange={(event) => set("falsePositive", event.target.value)} placeholder="1" /></label>
        {costs === "incomplete" && <p role="alert" className="error">Enter the positive class and both costs, as positive numbers, or none of them.</p>}
      </fieldset>}
      <label>Assumptions <span className="muted">one per line</span><textarea value={draft.assumptions} onChange={(event) => set("assumptions", event.target.value)} /></label>
      <label>Unknowns <span className="muted">one per line</span><textarea value={draft.unknowns} onChange={(event) => set("unknowns", event.target.value)} /></label>
      <label>Acceptance criteria <span className="muted">one per line</span><textarea value={draft.criteria} onChange={(event) => set("criteria", event.target.value)} /></label>
      {(save.isError || savePipeline.isError) && <p role="alert" className="error">{save.error?.message ?? savePipeline.error?.message}</p>}
      <footer><span className="muted">Saving creates a new revision{pipeline ? " and links a new flow version to it" : ""}.</span><button type="button" className="run-code" disabled={!draft.objective.trim() || costs === "incomplete" || pending} onClick={submit}>{pending ? "Saving…" : "Save revision"}</button></footer>
    </section>
  </div>;
}

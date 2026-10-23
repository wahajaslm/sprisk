import { useState, useMemo } from "react";
import type { Binding, Fact, QuestionVersion, TaskType, Unknown } from "@sprisk/contracts";
import { ulid } from "ulid";

import { useLoadedTables } from "../../api/datasets.ts";
import { useConcepts } from "../../api/methodology.ts";
import { usePipelineVersions, useSavePipelineVersion } from "../../api/hooks.ts";
import { useQuestionVersions, useSaveQuestionVersion } from "../../api/questions.ts";
import { useSelection } from "../../workbench/selection.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { SendIcon } from "../Icons.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { stepTitle } from "../../flow/stages.ts";
import { timestamp } from "../../flow/edit.ts";
import { currentQuestion } from "./ledger.ts";
import { StartWalk } from "./StartWalk.tsx";

const fact = (value: string): Fact => ({ value: value.trim(), origin: "explicit" });
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
const stated = (concept: string, column: string): Binding => ({
  schema_version: "sprisk.binding/v1",
  concept,
  source: { column: column.trim() },
  set_by: { assurance: "stated" },
});

export function ObjectivePage() {
  const { pipelineVersionId, selectPipelineVersion, setNav } = useSelection();
  const questionsQuery = useQuestionVersions();
  const pipelinesQuery = usePipelineVersions();
  const tablesQuery = useLoadedTables();
  const conceptsQuery = useConcepts();
  const saveQuestion = useSaveQuestionVersion();
  const savePipeline = useSavePipelineVersion();

  const [activeTab, setActiveTab] = useState<"ledger" | "history">("ledger");
  const [isEditing, setIsEditing] = useState(false);

  // Form states for creating / editing questions
  const [formObjective, setFormObjective] = useState("");
  const [formTask, setFormTask] = useState<TaskType>("classification");
  const [formTarget, setFormTarget] = useState("");
  const [formUnit, setFormUnit] = useState("");
  const [formHorizon, setFormHorizon] = useState("");
  const [formAssumptions, setFormAssumptions] = useState("");
  const [formUnknowns, setFormUnknowns] = useState("");
  const [formCriteria, setFormCriteria] = useState("");
  const [formPositive, setFormPositive] = useState("");
  const [formFalseNegative, setFormFalseNegative] = useState("");
  const [formFalsePositive, setFormFalsePositive] = useState("");
  // Column typed per concept; an empty one leaves the concept unbound.
  const [formBindings, setFormBindings] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();

  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);

  const currentPipeline = useMemo(
    () => pipelines.find((p) => p.id === pipelineVersionId),
    [pipelines, pipelineVersionId],
  );

  const question = useMemo(() => currentQuestion(questions, currentPipeline), [questions, currentPipeline]);

  const openEditor = (base?: QuestionVersion) => {
    if (base) {
      setFormObjective(base.objective.value);
      setFormTask(base.task.value);
      setFormTarget(base.target?.value ?? "");
      setFormUnit(base.unit_of_analysis?.value ?? "");
      setFormHorizon(base.prediction_horizon?.value ?? "");
      setFormAssumptions(base.assumptions.map((a) => a.value).join("\n"));
      setFormUnknowns(base.unknowns.map((u) => u.question).join("\n"));
      setFormCriteria(base.acceptance_criteria.map((c) => c.value).join("\n"));
      setFormPositive(base.costs?.value.positive ?? "");
      setFormFalseNegative(base.costs?.value.false_negative?.toString() ?? "");
      setFormFalsePositive(base.costs?.value.false_positive?.toString() ?? "");
      setFormBindings(Object.fromEntries((base.bindings ?? []).map((b) => [b.concept, b.source.column])));
    } else {
      setFormObjective("");
      setFormTask("classification");
      setFormTarget("");
      setFormUnit("");
      setFormHorizon("");
      setFormAssumptions("");
      setFormUnknowns("");
      setFormCriteria("");
      setFormPositive("");
      setFormFalseNegative("");
      setFormFalsePositive("");
      setFormBindings({});
    }
    setFormError(undefined);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!formObjective.trim()) {
      setFormError("Please enter the investigation objective.");
      return;
    }

    // Validate costs
    let costs: QuestionVersion["costs"] | undefined;
    const pos = formPositive.trim();
    const fnStr = formFalseNegative.trim();
    const fpStr = formFalsePositive.trim();
    if (pos || fnStr || fpStr) {
      const fn = Number(fnStr);
      const fp = Number(fpStr);
      if (!pos || !fnStr || !fpStr || !Number.isFinite(fn) || fn <= 0 || !Number.isFinite(fp) || fp <= 0) {
        setFormError("Enter the positive class and both costs, as positive numbers, or none of them.");
        return;
      }
      costs = {
        value: { positive: pos, false_negative: fn, false_positive: fp },
        origin: "explicit",
      };
    }

    const bindings = Object.entries(formBindings)
      .filter(([, column]) => column.trim())
      .map(([concept, column]) => stated(concept, column));

    const newQuestion: QuestionVersion = {
      schema_version: "sprisk.question_version/v1",
      id: `qv_${ulid()}`,
      investigation_id: question?.investigation_id ?? `inv_${ulid()}`,
      objective: fact(formObjective),
      task: { value: formTask, origin: "explicit" },
      ...(formTarget.trim() ? { target: fact(formTarget) } : {}),
      ...(formUnit.trim() ? { unit_of_analysis: fact(formUnit) } : {}),
      ...(formHorizon.trim() ? { prediction_horizon: fact(formHorizon) } : {}),
      assumptions: lines(formAssumptions).map(fact),
      unknowns: lines(formUnknowns).map((u): Unknown => ({ question: u, blocks: "execution" })),
      acceptance_criteria: lines(formCriteria).map(fact),
      ...(costs ? { costs } : {}),
      ...(bindings.length ? { bindings } : {}),
      created_at: timestamp(),
    };

    saveQuestion.mutate(newQuestion, {
      onSuccess: (saved) => {
        setIsEditing(false);
        if (currentPipeline && currentPipeline.question_version_id !== saved.id) {
          savePipeline.mutate({
            ...currentPipeline,
            question_version_id: saved.id,
          });
        }
      },
      onError: (err) => {
        setFormError(err.message);
      },
    });
  };

  const linkToPipeline = (questionId: string) => {
    if (!currentPipeline) return;
    savePipeline.mutate({
      ...currentPipeline,
      question_version_id: questionId,
    });
  };

  if (questionsQuery.isPending) {
    return <Loading text="Loading questions ledger…" pad />;
  }

  // Empty state when no question versions exist at the backend yet
  if (questions.length === 0 && !isEditing) {
    return (
      <div className="single-panel-layout objective-page-layout">
        <main className="center-screen objective-empty-screen">
          <div className="objective-empty-card">
            <h1 className="objective-empty-title">What do you want to find out?</h1>
            <p className="objective-empty-sub">
              Describe the investigation goal in your own words. Sprisk records the question as an immutable revision
              that guides methodology decisions and flow design.
            </p>

            <div className="objective-input-box">
              {tables.length > 0 && (
                <div className="objective-file-chip">
                  <code>{tables[0]!.name}</code>
                  <span>({tables[0]!.total_rows.toLocaleString()} rows)</span>
                </div>
              )}
              <textarea
                className="objective-textarea"
                value={formObjective}
                onChange={(e) => setFormObjective(e.target.value)}
                placeholder="e.g. Predict which customers will churn within the next 90 days."
                rows={3}
              />
              <div className="objective-input-foot">
                <div className="objective-input-actions">
                  <Tag tone="default">Objective</Tag>
                </div>
                <button
                  type="button"
                  className="objective-send-btn"
                  disabled={!formObjective.trim()}
                  onClick={() => {
                    openEditor();
                    setFormObjective(formObjective);
                  }}
                  title="Continue to question specification"
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="single-panel-layout objective-page-layout">
      <main className="center-screen objective-screen">
        <div className="objective-center">
        {/* Subtabs strip */}
        <div className="objective-subtabs">
          <div className="subtabs-left">
            <button
              type="button"
              className={`subtab-btn ${activeTab === "ledger" ? "active" : ""}`}
              onClick={() => setActiveTab("ledger")}
            >
              Ledger
            </button>
            <button
              type="button"
              className={`subtab-btn ${activeTab === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              Revisions ({questions.length})
            </button>
          </div>
          <div className="subtabs-right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="secondary" size="sm" onClick={() => openEditor(question)}>
              Revise question
            </Button>
            <Button variant="primary" size="sm" onClick={() => openEditor()}>
              New question
            </Button>
          </div>
        </div>

        {activeTab === "ledger" && question ? (
          <div className="objective-scroll-body">
            {/* Headline Box */}
            <div className="objective-headline-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="objective-version-meta">
                  Question Revision · {question.id.slice(-8)}
                  {currentPipeline?.question_version_id === question.id && (
                    <span style={{ marginLeft: 8 }}>
                      <Tag tone="default">Active in current flow</Tag>
                    </span>
                  )}
                </span>
                {currentPipeline && currentPipeline.question_version_id !== question.id && (
                  <Button variant="secondary" size="sm" onClick={() => linkToPipeline(question.id)}>
                    Link to current flow
                  </Button>
                )}
              </div>
              <h2 className="objective-sentence">{question.objective.value}</h2>
              <StartWalk key={question.id} question={question} />
            </div>

            {/* Ledger Table */}
            <div className="ledger-table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Entry</th>
                    <th>Value</th>
                    <th style={{ width: "25%" }}>Origin</th>
                    <th style={{ width: 70 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Task */}
                  <tr>
                    <td className="entry-key">Task</td>
                    <td className="entry-value">
                      <span className="mono">{question.task.value}</span>
                    </td>
                    <td className="entry-src">{question.task.origin}</td>
                    <td className="entry-st">
                      <span className="status-badge badge-set">Set</span>
                    </td>
                  </tr>

                  {/* Target */}
                  <tr className={!question.target ? "row-open" : ""}>
                    <td className="entry-key">Target</td>
                    <td className="entry-value">
                      {question.target ? (
                        <span className="mono">{question.target.value}</span>
                      ) : (
                        <span className="val-open-title">Target variable not specified</span>
                      )}
                    </td>
                    <td className="entry-src">{question.target?.origin ?? "—"}</td>
                    <td className="entry-st">
                      <span className={`status-badge ${question.target ? "badge-set" : "badge-open"}`}>
                        {question.target ? "Set" : "Open"}
                      </span>
                    </td>
                  </tr>

                  {/* Unit of analysis */}
                  <tr className={!question.unit_of_analysis ? "row-open" : ""}>
                    <td className="entry-key">Unit of Analysis</td>
                    <td className="entry-value">
                      {question.unit_of_analysis ? (
                        <span className="mono">{question.unit_of_analysis.value}</span>
                      ) : (
                        <span className="val-open-title">Unit not specified</span>
                      )}
                    </td>
                    <td className="entry-src">{question.unit_of_analysis?.origin ?? "—"}</td>
                    <td className="entry-st">
                      <span className={`status-badge ${question.unit_of_analysis ? "badge-set" : "badge-open"}`}>
                        {question.unit_of_analysis ? "Set" : "Open"}
                      </span>
                    </td>
                  </tr>

                  {/* Prediction horizon */}
                  <tr className={!question.prediction_horizon ? "row-open" : ""}>
                    <td className="entry-key">Horizon</td>
                    <td className="entry-value">
                      {question.prediction_horizon ? (
                        <span className="mono">{question.prediction_horizon.value}</span>
                      ) : (
                        <span className="val-open-title">Horizon not specified</span>
                      )}
                    </td>
                    <td className="entry-src">{question.prediction_horizon?.origin ?? "—"}</td>
                    <td className="entry-st">
                      <span className={`status-badge ${question.prediction_horizon ? "badge-set" : "badge-open"}`}>
                        {question.prediction_horizon ? "Set" : "Open"}
                      </span>
                    </td>
                  </tr>

                  {/* Assumptions */}
                  {question.assumptions.map((a, i) => (
                    <tr key={`assumption-${i}`}>
                      <td className="entry-key">{i === 0 ? "Assumption" : ""}</td>
                      <td className="entry-value">{a.value}</td>
                      <td className="entry-src">{a.origin}</td>
                      <td className="entry-st">
                        <span className="status-badge badge-set">Set</span>
                      </td>
                    </tr>
                  ))}

                  {/* Unknowns */}
                  {question.unknowns.map((u, i) => (
                    <tr key={`unknown-${i}`} className="row-open">
                      <td className="entry-key">{i === 0 ? "Unknown" : ""}</td>
                      <td className="entry-value">
                        <span className="val-open-title">{u.question}</span>
                      </td>
                      <td className="entry-src">blocks {u.blocks}</td>
                      <td className="entry-st">
                        <span className="status-badge badge-open">Open</span>
                      </td>
                    </tr>
                  ))}

                  {/* Acceptance Criteria */}
                  {question.acceptance_criteria.map((c, i) => (
                    <tr key={`criteria-${i}`}>
                      <td className="entry-key">{i === 0 ? "Criteria" : ""}</td>
                      <td className="entry-value">{c.value}</td>
                      <td className="entry-src">{c.origin}</td>
                      <td className="entry-st">
                        <span className="status-badge badge-set">Set</span>
                      </td>
                    </tr>
                  ))}

                  {/* Costs */}
                  {question.costs && (
                    <tr>
                      <td className="entry-key">Costs</td>
                      <td className="entry-value">
                        Positive class: <code>{question.costs.value.positive}</code> · False negative:{" "}
                        {question.costs.value.false_negative} · False positive:{" "}
                        {question.costs.value.false_positive}
                      </td>
                      <td className="entry-src">{question.costs.origin}</td>
                      <td className="entry-st">
                        <span className="status-badge badge-set">Set</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* From the data: Real loaded tables */}
            <div className="from-data-section">
              <h3 className="from-data-head">From the data</h3>
              {tables.length === 0 ? (
                <p className="muted pad" style={{ fontSize: "var(--fs-13)" }}>
                  No datasets loaded yet. Add a loader step to the flow to profile real data.
                </p>
              ) : (
                <div className="from-data-grid">
                  {tables.map((t) => (
                    <div key={t.artifact.id} className="from-data-row">
                      <span className="from-data-k">{t.name}</span>
                      <span className="from-data-v">
                        {t.total_rows.toLocaleString()} rows · {t.total_columns} columns · {stepTitle(t.operator)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "history" ? (
          <div className="objective-history-body">
            <div className="history-list">
              {questions.map((q) => {
                const isCurrent = currentPipeline?.question_version_id === q.id;
                const d = new Date(q.created_at);
                const when = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
                return (
                  <div key={q.id} className="history-item" style={{ alignItems: "flex-start", gap: 16 }}>
                    <span className="history-ver mono">{q.id.slice(-8)}</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <strong style={{ fontSize: "var(--fs-13-5)", color: "var(--text-primary)" }}>
                        {q.objective.value}
                      </strong>
                      <span className="mono" style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)" }}>
                        Task: {q.task.value} · Target: {q.target?.value ?? "None"} · {q.assumptions.length} assumptions · {q.unknowns.length} unknowns
                      </span>
                    </div>
                    <span className="history-who mono">{when}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {isCurrent ? (
                        <Tag tone="default">Linked</Tag>
                      ) : currentPipeline ? (
                        <Button variant="secondary" size="sm" onClick={() => linkToPipeline(q.id)}>
                          Link
                        </Button>
                      ) : null}
                      <Button variant="secondary" size="sm" onClick={() => openEditor(q)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Modal / Overlay Editor */}
        {isEditing && (
          <div
            className="objective-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Question Revision"
            onClick={() => setIsEditing(false)}
          >
            <div
              className="objective-modal-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="objective-modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 className="objective-modal-title">Question Revision</h2>
                  <Tag tone="default">Specification</Tag>
                </div>
                <button
                  type="button"
                  className="objective-modal-close"
                  onClick={() => setIsEditing(false)}
                  title="Close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {formError && (
                <div className="ds-error-banner" role="alert" style={{ margin: "16px 20px 0" }}>
                  <span style={{ fontSize: 14 }}>⚠</span>
                  <div style={{ flex: 1 }}>{formError}</div>
                </div>
              )}

              <div className="objective-modal-body">
                <div className="ds-form-field">
                  <label className="ds-form-label" htmlFor="obj-field-goal">
                    <span>Objective</span>
                    <span className="ds-form-label-sub">Primary research question</span>
                  </label>
                  <textarea
                    id="obj-field-goal"
                    className="ds-textarea"
                    rows={2}
                    value={formObjective}
                    onChange={(e) => setFormObjective(e.target.value)}
                    placeholder="e.g. Predict which orders will be returned within 30 days."
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="ds-form-field">
                    <label className="ds-form-label" htmlFor="obj-field-task">
                      <span>Task</span>
                      <span className="ds-form-label-sub">Modeling type</span>
                    </label>
                    <select
                      id="obj-field-task"
                      className="ds-select"
                      value={formTask}
                      onChange={(e) => setFormTask(e.target.value as TaskType)}
                    >
                      <option value="classification">Classification</option>
                      <option value="regression">Regression</option>
                      <option value="clustering">Clustering</option>
                      <option value="anomaly_detection">Anomaly Detection</option>
                      <option value="ranking">Ranking</option>
                    </select>
                  </div>

                  <div className="ds-form-field">
                    <label className="ds-form-label" htmlFor="obj-field-target">
                      <span>Target Variable</span>
                      <span className="ds-form-label-sub">Prediction target</span>
                    </label>
                    <input
                      id="obj-field-target"
                      type="text"
                      className="ds-input mono"
                      value={formTarget}
                      onChange={(e) => setFormTarget(e.target.value)}
                      placeholder="e.g. returned_within_30d"
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="ds-form-field">
                    <label className="ds-form-label" htmlFor="obj-field-unit">
                      <span>Unit of Analysis</span>
                      <span className="ds-form-label-sub">Row entity</span>
                    </label>
                    <input
                      id="obj-field-unit"
                      type="text"
                      className="ds-input"
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      placeholder="e.g. order"
                    />
                  </div>

                  <div className="ds-form-field">
                    <label className="ds-form-label" htmlFor="obj-field-horizon">
                      <span>Prediction Horizon</span>
                      <span className="ds-form-label-sub">Time scope</span>
                    </label>
                    <input
                      id="obj-field-horizon"
                      type="text"
                      className="ds-input mono"
                      value={formHorizon}
                      onChange={(e) => setFormHorizon(e.target.value)}
                      placeholder="e.g. P30D"
                    />
                  </div>
                </div>

                <div className="ds-form-field">
                  <label className="ds-form-label" htmlFor="obj-field-assumptions">
                    <span>Assumptions</span>
                    <span className="ds-form-label-sub">One per line</span>
                  </label>
                  <textarea
                    id="obj-field-assumptions"
                    className="ds-textarea"
                    rows={2}
                    value={formAssumptions}
                    onChange={(e) => setFormAssumptions(e.target.value)}
                    placeholder="e.g. Return labels are complete after 30 days."
                  />
                </div>

                <div className="ds-form-field">
                  <label className="ds-form-label" htmlFor="obj-field-unknowns">
                    <span>Unknowns</span>
                    <span className="ds-form-label-sub">Questions blocking execution (one per line)</span>
                  </label>
                  <textarea
                    id="obj-field-unknowns"
                    className="ds-textarea"
                    rows={2}
                    value={formUnknowns}
                    onChange={(e) => setFormUnknowns(e.target.value)}
                    placeholder="e.g. Are exchanges counted as returns?"
                  />
                </div>

                <div className="ds-form-field">
                  <label className="ds-form-label" htmlFor="obj-field-criteria">
                    <span>Acceptance Criteria</span>
                    <span className="ds-form-label-sub">One per line</span>
                  </label>
                  <textarea
                    id="obj-field-criteria"
                    className="ds-textarea"
                    rows={2}
                    value={formCriteria}
                    onChange={(e) => setFormCriteria(e.target.value)}
                    placeholder="e.g. Average precision beats the dummy baseline on temporal validation."
                  />
                </div>

                {conceptsQuery.data && (
                  <div className="ds-form-card">
                    <div className="ds-form-card-head">
                      <span className="ds-form-card-title">Columns the methods read</span>
                      <span className="ds-form-card-desc">
                        Name the column that holds each meaning, if one does. Leave it empty if none does.
                      </span>
                    </div>
                    {Object.entries(conceptsQuery.data.concepts)
                      .filter(([, concept]) => concept.binds_to.includes("column"))
                      .map(([id, concept]) => (
                        <div className="ds-form-field" key={id}>
                          <label className="ds-form-label" htmlFor={`obj-field-concept-${id}`}>
                            <span>{concept.description}</span>
                            <span className="ds-form-label-sub mono">{id}</span>
                          </label>
                          <input
                            id={`obj-field-concept-${id}`}
                            type="text"
                            className="ds-input mono"
                            value={formBindings[id] ?? ""}
                            onChange={(e) => setFormBindings({ ...formBindings, [id]: e.target.value })}
                            placeholder="Column name"
                          />
                        </div>
                      ))}
                  </div>
                )}

                {/* Misclassification Costs Card */}
                <div className="ds-form-card">
                  <div className="ds-form-card-head">
                    <span className="ds-form-card-title">Misclassification Costs</span>
                    <span className="ds-form-card-desc">
                      Assign asymmetric penalty weights for decisions and error trade-offs
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div className="ds-form-field">
                      <label className="ds-form-label" htmlFor="obj-field-cost-pos" style={{ fontSize: "var(--fs-12)" }}>
                        Positive class
                      </label>
                      <input
                        id="obj-field-cost-pos"
                        type="text"
                        className="ds-input mono"
                        aria-label="Positive class"
                        value={formPositive}
                        onChange={(e) => setFormPositive(e.target.value)}
                        placeholder="e.g. bad"
                      />
                    </div>
                    <div className="ds-form-field">
                      <label className="ds-form-label" htmlFor="obj-field-cost-fn" style={{ fontSize: "var(--fs-12)" }}>
                        False-negative cost
                      </label>
                      <input
                        id="obj-field-cost-fn"
                        type="text"
                        className="ds-input mono"
                        aria-label="False-negative cost"
                        value={formFalseNegative}
                        onChange={(e) => setFormFalseNegative(e.target.value)}
                        placeholder="e.g. 5"
                      />
                    </div>
                    <div className="ds-form-field">
                      <label className="ds-form-label" htmlFor="obj-field-cost-fp" style={{ fontSize: "var(--fs-12)" }}>
                        False-positive cost
                      </label>
                      <input
                        id="obj-field-cost-fp"
                        type="text"
                        className="ds-input mono"
                        aria-label="False-positive cost"
                        value={formFalsePositive}
                        onChange={(e) => setFormFalsePositive(e.target.value)}
                        placeholder="e.g. 1"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="objective-modal-footer">
                <Button variant="secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={saveQuestion.isPending} onClick={handleSave}>
                  {saveQuestion.isPending ? "Saving revision…" : "Save revision"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  </div>
  );
}

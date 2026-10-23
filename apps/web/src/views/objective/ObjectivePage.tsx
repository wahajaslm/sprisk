import { useState, useMemo } from "react";
import type { Fact, QuestionVersion, TaskType, Unknown } from "@sprisk/contracts";
import { ulid } from "ulid";

import { useLoadedTables } from "../../api/datasets.ts";
import { usePipelineVersions, useSavePipelineVersion } from "../../api/hooks.ts";
import { useQuestionVersions, useSaveQuestionVersion } from "../../api/questions.ts";
import { useSelection } from "../../workbench/selection.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { SendIcon } from "../Icons.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { stepTitle } from "../../flow/stages.ts";
import { StartWalk } from "./StartWalk.tsx";

const fact = (value: string): Fact => ({ value: value.trim(), origin: "explicit" });
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

export function ObjectivePage() {
  const { pipelineVersionId, selectPipelineVersion, setNav } = useSelection();
  const questionsQuery = useQuestionVersions();
  const pipelinesQuery = usePipelineVersions();
  const tablesQuery = useLoadedTables();
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
  const [formError, setFormError] = useState<string>();

  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);

  const currentPipeline = useMemo(
    () => pipelines.find((p) => p.id === pipelineVersionId),
    [pipelines, pipelineVersionId],
  );

  const currentQuestion = useMemo(() => {
    if (currentPipeline?.question_version_id) {
      return questions.find((q) => q.id === currentPipeline.question_version_id);
    }
    return questions[0];
  }, [questions, currentPipeline]);

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

    const newQuestion: QuestionVersion = {
      schema_version: "sprisk.question_version/v1",
      id: `qv_${ulid()}`,
      investigation_id: currentQuestion?.investigation_id ?? `inv_${ulid()}`,
      objective: fact(formObjective),
      task: { value: formTask, origin: "explicit" },
      ...(formTarget.trim() ? { target: fact(formTarget) } : {}),
      ...(formUnit.trim() ? { unit_of_analysis: fact(formUnit) } : {}),
      ...(formHorizon.trim() ? { prediction_horizon: fact(formHorizon) } : {}),
      assumptions: lines(formAssumptions).map(fact),
      unknowns: lines(formUnknowns).map((u): Unknown => ({ question: u, blocks: "execution" })),
      acceptance_criteria: lines(formCriteria).map(fact),
      ...(costs ? { costs } : {}),
      created_at: new Date().toISOString(),
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
      <main className="objective-empty-screen">
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
    );
  }

  return (
    <div className="objective-screen">
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
            <Button variant="secondary" size="sm" onClick={() => openEditor(currentQuestion)}>
              Revise question
            </Button>
            <Button variant="primary" size="sm" onClick={() => openEditor()}>
              New question
            </Button>
          </div>
        </div>

        {activeTab === "ledger" && currentQuestion ? (
          <div className="objective-scroll-body">
            {/* Headline Box */}
            <div className="objective-headline-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="objective-version-meta">
                  Question Revision · {currentQuestion.id.slice(-8)}
                  {currentPipeline?.question_version_id === currentQuestion.id && (
                    <span style={{ marginLeft: 8 }}>
                      <Tag tone="default">Active in current flow</Tag>
                    </span>
                  )}
                </span>
                {currentPipeline && currentPipeline.question_version_id !== currentQuestion.id && (
                  <Button variant="secondary" size="sm" onClick={() => linkToPipeline(currentQuestion.id)}>
                    Link to current flow
                  </Button>
                )}
              </div>
              <h2 className="objective-sentence">{currentQuestion.objective.value}</h2>
              <StartWalk key={currentQuestion.id} question={currentQuestion} />
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
                      <span className="mono">{currentQuestion.task.value}</span>
                    </td>
                    <td className="entry-src">{currentQuestion.task.origin}</td>
                    <td className="entry-st">
                      <span className="status-badge badge-set">Set</span>
                    </td>
                  </tr>

                  {/* Target */}
                  <tr className={!currentQuestion.target ? "row-open" : ""}>
                    <td className="entry-key">Target</td>
                    <td className="entry-value">
                      {currentQuestion.target ? (
                        <span className="mono">{currentQuestion.target.value}</span>
                      ) : (
                        <span className="val-open-title">Target variable not specified</span>
                      )}
                    </td>
                    <td className="entry-src">{currentQuestion.target?.origin ?? "—"}</td>
                    <td className="entry-st">
                      <span className={`status-badge ${currentQuestion.target ? "badge-set" : "badge-open"}`}>
                        {currentQuestion.target ? "Set" : "Open"}
                      </span>
                    </td>
                  </tr>

                  {/* Unit of analysis */}
                  <tr className={!currentQuestion.unit_of_analysis ? "row-open" : ""}>
                    <td className="entry-key">Unit of Analysis</td>
                    <td className="entry-value">
                      {currentQuestion.unit_of_analysis ? (
                        <span className="mono">{currentQuestion.unit_of_analysis.value}</span>
                      ) : (
                        <span className="val-open-title">Unit not specified</span>
                      )}
                    </td>
                    <td className="entry-src">{currentQuestion.unit_of_analysis?.origin ?? "—"}</td>
                    <td className="entry-st">
                      <span className={`status-badge ${currentQuestion.unit_of_analysis ? "badge-set" : "badge-open"}`}>
                        {currentQuestion.unit_of_analysis ? "Set" : "Open"}
                      </span>
                    </td>
                  </tr>

                  {/* Prediction horizon */}
                  <tr className={!currentQuestion.prediction_horizon ? "row-open" : ""}>
                    <td className="entry-key">Horizon</td>
                    <td className="entry-value">
                      {currentQuestion.prediction_horizon ? (
                        <span className="mono">{currentQuestion.prediction_horizon.value}</span>
                      ) : (
                        <span className="val-open-title">Horizon not specified</span>
                      )}
                    </td>
                    <td className="entry-src">{currentQuestion.prediction_horizon?.origin ?? "—"}</td>
                    <td className="entry-st">
                      <span className={`status-badge ${currentQuestion.prediction_horizon ? "badge-set" : "badge-open"}`}>
                        {currentQuestion.prediction_horizon ? "Set" : "Open"}
                      </span>
                    </td>
                  </tr>

                  {/* Assumptions */}
                  {currentQuestion.assumptions.map((a, i) => (
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
                  {currentQuestion.unknowns.map((u, i) => (
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
                  {currentQuestion.acceptance_criteria.map((c, i) => (
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
                  {currentQuestion.costs && (
                    <tr>
                      <td className="entry-key">Costs</td>
                      <td className="entry-value">
                        Positive class: <code>{currentQuestion.costs.value.positive}</code> · False negative:{" "}
                        {currentQuestion.costs.value.false_negative} · False positive:{" "}
                        {currentQuestion.costs.value.false_positive}
                      </td>
                      <td className="entry-src">{currentQuestion.costs.origin}</td>
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
            role="dialog"
            aria-label="New question"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 24,
            }}
          >
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-panel)",
                borderRadius: 8,
                maxWidth: 640,
                width: "100%",
                maxHeight: "90vh",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: 24,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "var(--fs-18)", margin: 0, color: "var(--text-primary)" }}>
                  Question Revision
                </h2>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}
                >
                  ✕
                </button>
              </div>

              {formError && (
                <p role="alert" className="error" style={{ margin: 0 }}>
                  {formError}
                </p>
              )}

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                <strong>Objective</strong>
                <textarea
                  className="ds-input"
                  rows={2}
                  value={formObjective}
                  onChange={(e) => setFormObjective(e.target.value)}
                  placeholder="e.g. Predict which orders will be returned within 30 days."
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                  <strong>Task</strong>
                  <select
                    className="ds-input"
                    value={formTask}
                    onChange={(e) => setFormTask(e.target.value as TaskType)}
                  >
                    <option value="classification">Classification</option>
                    <option value="regression">Regression</option>
                    <option value="clustering">Clustering</option>
                    <option value="anomaly_detection">Anomaly Detection</option>
                    <option value="ranking">Ranking</option>
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                  <strong>Target Variable</strong>
                  <input
                    type="text"
                    className="ds-input"
                    value={formTarget}
                    onChange={(e) => setFormTarget(e.target.value)}
                    placeholder="e.g. returned_within_30d"
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                  <strong>Unit of Analysis</strong>
                  <input
                    type="text"
                    className="ds-input"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="e.g. order"
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                  <strong>Prediction Horizon</strong>
                  <input
                    type="text"
                    className="ds-input"
                    value={formHorizon}
                    onChange={(e) => setFormHorizon(e.target.value)}
                    placeholder="e.g. P30D"
                  />
                </label>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                <strong>Assumptions (one per line)</strong>
                <textarea
                  className="ds-input"
                  rows={2}
                  value={formAssumptions}
                  onChange={(e) => setFormAssumptions(e.target.value)}
                  placeholder="e.g. Return labels are complete after 30 days."
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                <strong>Unknowns (one per line)</strong>
                <textarea
                  className="ds-input"
                  rows={2}
                  value={formUnknowns}
                  onChange={(e) => setFormUnknowns(e.target.value)}
                  placeholder="e.g. Are exchanges counted as returns?"
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-13)" }}>
                <strong>Acceptance Criteria (one per line)</strong>
                <textarea
                  className="ds-input"
                  rows={2}
                  value={formCriteria}
                  onChange={(e) => setFormCriteria(e.target.value)}
                  placeholder="e.g. Average precision beats the dummy baseline on temporal validation."
                />
              </label>

              <fieldset
                aria-label="Misclassification costs"
                style={{
                  border: "1px solid var(--border-panel)",
                  borderRadius: 6,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <legend style={{ fontSize: "var(--fs-12)", fontWeight: 500, padding: "0 6px" }}>
                  Misclassification Costs
                </legend>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-12)" }}>
                    <span>Positive class</span>
                    <input
                      type="text"
                      className="ds-input"
                      aria-label="Positive class"
                      value={formPositive}
                      onChange={(e) => setFormPositive(e.target.value)}
                      placeholder="e.g. bad"
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-12)" }}>
                    <span>False-negative cost</span>
                    <input
                      type="text"
                      className="ds-input"
                      aria-label="False-negative cost"
                      value={formFalseNegative}
                      onChange={(e) => setFormFalseNegative(e.target.value)}
                      placeholder="e.g. 5"
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-12)" }}>
                    <span>False-positive cost</span>
                    <input
                      type="text"
                      className="ds-input"
                      aria-label="False-positive cost"
                      value={formFalsePositive}
                      onChange={(e) => setFormFalsePositive(e.target.value)}
                      placeholder="e.g. 1"
                    />
                  </label>
                </div>
              </fieldset>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <Button variant="secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSave}>
                  Save revision
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import type { Fact, QuestionVersion, TaskType, Unknown } from "@sprisk/contracts";
import { ulid } from "ulid";

import { useLoadedTables, useDatasetProfile } from "../../api/datasets.ts";
import { usePipelineVersions, useSavePipelineVersion } from "../../api/hooks.ts";
import { useQuestionVersions, useSaveQuestionVersion } from "../../api/questions.ts";
import { inferQuestionLedger } from "../../api/copilot.ts";
import { useSelection } from "../../workbench/selection.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { SendIcon, SparkIcon } from "../Icons.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { stepTitle } from "../../flow/stages.ts";
import { timestamp } from "../../flow/edit.ts";

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
  const [isInferring, setIsInferring] = useState(false);
  const [copilotClarification, setCopilotClarification] = useState<string>();

  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);

  const activeTable = tables[0];
  const profileQuery = useDatasetProfile(activeTable?.artifact.id);

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

  const handleInferLedger = async (reqText: string) => {
    if (!reqText.trim()) return;
    setIsInferring(true);
    setFormError(undefined);
    try {
      const res = await inferQuestionLedger({
        userRequest: reqText,
        datasetProfile: profileQuery.data,
        investigationId: currentQuestion?.investigation_id,
      });
      setCopilotClarification(res.copilotClarification);
      openEditor(res.question);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to infer ledger with Copilot.";
      setFormError(msg);
      openEditor();
      setFormObjective(reqText);
    } finally {
      setIsInferring(false);
    }
  };

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
    if (isInferring) {
      return (
        <div className="single-panel-layout objective-page-layout">
          <main className="center-screen objective-empty-screen">
            <Loading text="Copilot is analyzing dataset profile and formulating the question ledger with Qwen 2.5…" pad />
          </main>
        </div>
      );
    }
    return (
      <div className="single-panel-layout objective-page-layout">
        <main className="center-screen objective-empty-screen">
          <div className="objective-empty-card">
            <h1 className="objective-empty-title">What do you want to find out?</h1>
            <p className="objective-empty-sub">
              Describe the investigation goal in your own words. Sprisk Copilot extracts your objective, identifies target and entity columns grounded by the dataset profile, and drafts the question ledger.
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
                placeholder="e.g. Predict product category (prdtypecode) from title and description."
                rows={3}
              />
              <div className="objective-input-foot">
                <div className="objective-input-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Tag tone="default">Objective</Tag>
                  {activeTable && (
                    <span style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                      <SparkIcon size={12} />
                      Grounded by {activeTable.name} profile
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="objective-send-btn"
                  disabled={!formObjective.trim() || isInferring}
                  onClick={() => handleInferLedger(formObjective)}
                  title="Infer ledger with Copilot"
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
            {activeTable && (
              <Button
                variant="secondary"
                size="sm"
                disabled={isInferring}
                onClick={() => handleInferLedger(currentQuestion?.objective.value || "")}
                title="Use Qwen 2.5 Copilot to re-infer ledger facts from current objective and data profile"
              >
                <SparkIcon size={13} style={{ marginRight: 4 }} />
                {isInferring ? "Inferring…" : "Infer with Copilot"}
              </Button>
            )}
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
            {copilotClarification && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "12px 16px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-panel)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12-5)", color: "var(--accent-primary)", fontWeight: "var(--fw-medium)" }}>
                  <SparkIcon size={14} />
                  <span>Copilot Grounded Clarification</span>
                </div>
                <div style={{ fontSize: "var(--fs-13)", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  {copilotClarification}
                </div>
              </div>
            )}

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

              {copilotClarification && (
                <div
                  style={{
                    margin: "14px 20px 0",
                    padding: "10px 14px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-panel)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12-5)", color: "var(--accent-primary)", fontWeight: "var(--fw-medium)" }}>
                    <SparkIcon size={14} />
                    <span>Copilot Grounded Proposal</span>
                  </div>
                  <div style={{ fontSize: "var(--fs-13)", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                    {copilotClarification}
                  </div>
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

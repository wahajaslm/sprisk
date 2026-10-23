import { useEffect, useState } from "react";
import type { Fact, QuestionVersion, TaskType } from "@sprisk/contracts";
import { ulid } from "ulid";

import { useLoadedTables } from "../../api/datasets.ts";
import { usePipelineVersions } from "../../api/hooks.ts";
import { useQuestionVersions, useSaveQuestionVersion } from "../../api/questions.ts";
import { useSelection } from "../../workbench/selection.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { DatasetsIcon, SendIcon, SparkIcon } from "../Icons.tsx";

type LedgerItem = {
  k: string;
  v: string;
  src: string;
  st: "Set" | "Open";
  uses: number;
  open?: boolean;
  opts?: { t: string; val: string }[];
};

export function ObjectivePage() {
  const { setNav, selectPipelineVersion, setObjectiveOpenCount } = useSelection();
  const questions = useQuestionVersions();
  const saveQuestion = useSaveQuestionVersion();
  const tables = useLoadedTables();
  const pipelines = usePipelineVersions();

  const [activeTab, setActiveTab] = useState<"ledger" | "history">("ledger");
  const [goalText, setGoalText] = useState("we want to predict the sales for the next 6 months");
  const [selectedFile, setSelectedFile] = useState<string>("store_sales_2021_2026.csv");
  const [hasStarted, setHasStarted] = useState(true);

  // Dynamic ledger state with 3 questions initially open (matches objective-2.png)
  const [targetAnswer, setTargetAnswer] = useState<string | null>(null);
  const [levelAnswer, setLevelAnswer] = useState<string | null>(null);
  const [scoringAnswer, setScoringAnswer] = useState<string | null>(null);

  const openCount = [targetAnswer, levelAnswer, scoringAnswer].filter((a) => a === null).length;

  useEffect(() => {
    setObjectiveOpenCount(openCount);
  }, [openCount, setObjectiveOpenCount]);

  const handleStart = () => {
    if (!goalText.trim()) return;
    setHasStarted(true);
  };

  const handleReset = () => {
    setTargetAnswer(null);
    setLevelAnswer(null);
    setScoringAnswer(null);
  };

  const handleGeneratePipeline = () => {
    if (openCount > 0) return;
    // Create question version
    const newId = `qv_${ulid()}`;
    const questionObj: QuestionVersion = {
      schema_version: "sprisk.question_version/v1",
      id: newId,
      investigation_id: `inv_${ulid()}`,
      objective: { value: goalText, origin: "explicit" },
      task: { value: "classification" as TaskType, origin: "inferred" },
      target: { value: targetAnswer ?? "units", origin: "explicit" },
      assumptions: [],
      unknowns: [],
      acceptance_criteria: [],
      created_at: new Date().toISOString(),
    };
    saveQuestion.mutate(questionObj, {
      onSuccess: () => {
        // If pipelines exist, pick newest
        const firstPipe = pipelines.data?.[0];
        if (firstPipe) selectPipelineVersion(firstPipe.id);
        setNav("Flow");
      },
    });
  };

  const ledger: LedgerItem[] = [
    {
      k: "Task",
      v: "Forecast, multi-step",
      src: 'Your message: "predict ... next 6 months"',
      st: "Set",
      uses: 0,
    },
    {
      k: "Target",
      v: targetAnswer ? targetAnswer : "Units or revenue?",
      src: targetAnswer ? "You chose" : "Open question",
      st: targetAnswer ? "Set" : "Open",
      uses: 2,
      open: !targetAnswer,
      opts: [
        { t: "Units sold", val: "units" },
        { t: "Revenue", val: "revenue" },
      ],
    },
    {
      k: "Horizon",
      v: "6 months · Oct 2026 − Mar 2027",
      src: "Your message + last date in data",
      st: "Set",
      uses: 3,
    },
    {
      k: "Granularity",
      v: "Monthly",
      src: 'Inferred from "months" · data is daily',
      st: "Set",
      uses: 1,
    },
    {
      k: "Level",
      v: levelAnswer ? levelAnswer : "Total, per store or per SKU?",
      src: levelAnswer ? "You chose" : "Open question",
      st: levelAnswer ? "Set" : "Open",
      uses: 2,
      open: !levelAnswer,
      opts: [
        { t: "All stores combined", val: "All stores combined" },
        { t: "Per store", val: "Per store · 42 series" },
        { t: "Per store and SKU", val: "Per store and SKU · 1,512 series" },
      ],
    },
    {
      k: "Scoring",
      v: scoringAnswer ? scoringAnswer : "Depends on what it is for",
      src: scoringAnswer ? "From use: stock planning, running short costs more" : "Open question",
      st: scoringAnswer ? "Set" : "Open",
      uses: 1,
      open: !scoringAnswer,
      opts: [
        { t: "Stock planning", val: "Pinball loss at P50 and P90" },
        { t: "Budgeting", val: "MAPE on revenue" },
        { t: "Both", val: "Weighted quantile loss" },
      ],
    },
    {
      k: "Validation",
      v: "Rolling-origin backtest · 4 folds",
      src: "Methodology default for this horizon",
      st: "Set",
      uses: 2,
    },
    {
      k: "Known ahead",
      v: "Holidays, promo calendar",
      src: "Data · both have future rows",
      st: "Set",
      uses: 1,
    },
    {
      k: "Left out",
      v: "price",
      src: "Not known 6 months ahead · leakage rule",
      st: "Set",
      uses: 1,
    },
  ];

  const facts = [
    { k: "File", v: `${selectedFile} · v1` },
    { k: "Rows", v: "1,512,400 · 8 columns" },
    { k: "Time", v: "date · daily · Jan 2021 − Sep 2026" },
    { k: "Series", v: "42 stores × 36 SKUs" },
    { k: "Gaps", v: "14 store-days · store 17 closed Mar 2024" },
    { k: "Seasonality", v: "Weekly and yearly · December peak" },
    { k: "Trend", v: "Units +4% a year" },
  ];

  const history = [
    { v: "v5", t: "Settle scoring to pinball loss", who: "You · just now" },
    { v: "v4", t: "Set level to per store", who: "You · 1m ago" },
    { v: "v3", t: "Set target to units", who: "You · 2m ago" },
    { v: "v2", t: "Generated ledger with 3 open questions", who: "Copilot · 3m ago" },
    { v: "v1", t: "Initial intake from message and dataset", who: "System · 4m ago" },
  ];

  if (!hasStarted) {
    return (
      <main className="objective-empty-screen">
        <div className="objective-empty-card">
          <h1 className="objective-empty-title">What do you want to find out?</h1>
          <p className="objective-empty-sub">
            Attach your data and describe the goal in your own words. Studio profiles the data, writes the objective
            ledger, and designs the pipeline from it.
          </p>

          <div className="objective-input-box">
            <div className="objective-file-chip">
              <code>{selectedFile}</code>
              <button type="button" onClick={() => setSelectedFile("")} aria-label="Remove file">
                ×
              </button>
            </div>
            <textarea
              className="objective-textarea"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              placeholder="e.g. we want to predict the sales for the next 6 months"
              rows={3}
            />
            <div className="objective-input-foot">
              <div className="objective-input-actions">
                <button type="button" className="icon-btn icon-btn-sm" title="Attach file">
                  <DatasetsIcon size={14} />
                </button>
                <Tag>Auto</Tag>
              </div>
              <button
                type="button"
                className="objective-send-btn"
                disabled={!goalText.trim()}
                onClick={handleStart}
                title="Start objective analysis"
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
        {/* Sub-strip tabs */}
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
              History
            </button>
          </div>
          <div className="subtabs-right">
            {openCount > 0 ? (
              <span className="ledger-open-count">{openCount} open</span>
            ) : (
              <span className="ledger-complete-count">Complete</span>
            )}
          </div>
        </div>

        {activeTab === "ledger" ? (
          <div className="objective-scroll-body">
            <div className="objective-headline-box">
              <span className="objective-version-meta">Objective · v{openCount === 0 ? "5" : "2"}</span>
              <h2 className="objective-sentence">
                Forecast monthly{" "}
                <span className={`sentence-slot ${!targetAnswer || !levelAnswer ? "slot-open" : ""}`}>
                  {targetAnswer ?? "which sales"} {levelAnswer ?? "at what level"}
                </span>{" "}
                for October 2026 to March 2027, scored{" "}
                <span className={`sentence-slot ${!scoringAnswer ? "slot-open" : ""}`}>
                  {scoringAnswer ?? "for what use"}
                </span>
                .
              </h2>
            </div>

            {/* Ledger table */}
            <div className="ledger-table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Entry</th>
                    <th>Value</th>
                    <th style={{ width: "25%" }}>Source</th>
                    <th style={{ width: 70 }}>Status</th>
                    <th style={{ width: 50, textAlign: "right" }}>Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row.k} className={row.st === "Open" ? "row-open" : ""}>
                      <td className="entry-key">{row.k}</td>
                      <td className="entry-value">
                        <div className="value-col">
                          <span className={row.st === "Open" ? "val-open-title" : ""}>{row.v}</span>
                          {row.open && row.opts && (
                            <div className="answer-chips">
                              {row.opts.map((opt) => (
                                <button
                                  key={opt.t}
                                  type="button"
                                  className="answer-chip-btn"
                                  onClick={() => {
                                    if (row.k === "Target") setTargetAnswer(opt.val);
                                    if (row.k === "Level") setLevelAnswer(opt.val);
                                    if (row.k === "Scoring") setScoringAnswer(opt.val);
                                  }}
                                >
                                  {opt.t}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="entry-src">{row.src}</td>
                      <td className="entry-st">
                        <span className={`status-badge ${row.st === "Open" ? "badge-open" : "badge-set"}`}>
                          {row.st}
                        </span>
                      </td>
                      <td className="entry-steps">{row.uses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ledger-actions-row">
              <Button variant="secondary" size="sm">
                Add constraint
              </Button>
              <Button variant="secondary" size="sm" onClick={handleReset}>
                Change answers
              </Button>
            </div>

            {/* From the data */}
            <div className="from-data-section">
              <h3 className="from-data-head">From the data</h3>
              <div className="from-data-grid">
                {facts.map((f) => (
                  <div key={f.k} className="from-data-row">
                    <span className="from-data-k">{f.k}</span>
                    <span className="from-data-v">{f.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="objective-history-body">
            <div className="history-list">
              {history.map((h) => (
                <div key={h.v} className="history-item">
                  <span className="history-ver mono">{h.v}</span>
                  <span className="history-desc">{h.t}</span>
                  <span className="history-who">{h.who}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Profiling & Copilot intake */}
      <aside className="objective-copilot">
        <div className="copilot-head">
          <SparkIcon />
          <strong>Copilot</strong>
          <span className="spacer" />
          <span className="chip">{openCount > 0 ? `Objective · ${openCount} open` : "Objective · complete"}</span>
        </div>

        <div className="objective-copilot-body">
          <div className="file-profiled-card">
            <DatasetsIcon size={16} />
            <div className="file-profiled-meta">
              <span className="file-name">{selectedFile}</span>
              <span className="file-sub">62.4 MB · CSV</span>
            </div>
          </div>

          <div className="profiling-checklist">
            <span className="checklist-title">Profiled in the background:</span>
            <ul className="checklist-items">
              <li>✓ Reading file · 1,512,400 rows · 8 columns</li>
              <li>✓ Inferring types · date · 2 ids · 3 numeric · 2 flags</li>
              <li>✓ Finding the time column · date · daily</li>
              <li>✓ Finding series · 42 stores × 36 SKUs</li>
              <li>✓ Checking gaps · 14 store-days missing · store 17</li>
              <li>✓ Testing seasonality · weekly · yearly · December peak</li>
              <li>✓ Saving profile to dataset v1</li>
            </ul>
          </div>

          <div className="copilot-dialogue">
            <div className="msg-user">
              <p>{goalText}</p>
            </div>
            <div className="msg-copilot">
              <p>
                I've written this into the ledger as a 6-month monthly forecast, October 2026 to March 2027. Your message
                and the data settle most of it. {openCount > 0 ? `${openCount} things they don't settle:` : "All open questions are answered."}
              </p>
            </div>

            {openCount > 0 && !targetAnswer && (
              <div className="copilot-decision-card">
                <span className="decision-prompt">Which sales?</span>
                <span className="decision-note">Both can be computed from the file.</span>
                <div className="decision-btn-row">
                  <button
                    type="button"
                    className="decision-opt-btn"
                    onClick={() => setTargetAnswer("units")}
                  >
                    <strong>Units sold</strong>
                    <span>units column</span>
                  </button>
                  <button
                    type="button"
                    className="decision-opt-btn"
                    onClick={() => setTargetAnswer("revenue")}
                  >
                    <strong>Revenue</strong>
                    <span>units × price</span>
                  </button>
                </div>
              </div>
            )}

            {openCount > 0 && targetAnswer && !levelAnswer && (
              <div className="copilot-decision-card">
                <span className="decision-prompt">At what level?</span>
                <span className="decision-note">Sets how many series are forecast.</span>
                <div className="decision-btn-row">
                  <button
                    type="button"
                    className="decision-opt-btn"
                    onClick={() => setLevelAnswer("Per store · 42 series")}
                  >
                    <strong>Per store</strong>
                    <span>42 series</span>
                  </button>
                  <button
                    type="button"
                    className="decision-opt-btn"
                    onClick={() => setLevelAnswer("All stores combined")}
                  >
                    <strong>All stores</strong>
                    <span>1 combined</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="copilot-foot">
          <div className="composer">
            <input placeholder="Ask Copilot or change the objective" />
            <button type="button" className="send" aria-label="Send">
              <SendIcon />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

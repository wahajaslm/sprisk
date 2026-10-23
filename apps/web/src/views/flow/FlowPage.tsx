import { useState } from "react";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { Slider } from "../../components/ui/Slider.tsx";
import { StageCard } from "../../components/ui/StageCard.tsx";
import { FlowNode } from "../../components/ui/FlowNode.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon, Chevron } from "../Icons.tsx";

const STEP_TABS = [
  "Data",
  "Visualizations",
  "Console",
  "Inputs",
  "Parameters",
  "Code",
  "Methodology",
  "Performance",
  "History",
] as const;
type StepTab = (typeof STEP_TABS)[number];

type StepItem = {
  id: string;
  name: string;
  stage: string;
  meta?: string;
  tag?: string;
  isIssue?: boolean;
};

type Stage = {
  num: string;
  name: string;
  summary: string;
  countText: string;
  steps: StepItem[];
};

const STAGES: Stage[] = [
  {
    num: "01",
    name: "Explore",
    summary: "Profile and target balance",
    countText: "2 / 2",
    steps: [
      { id: "s-tsv", name: "umami_flavour_v2.tsv", stage: "Explore", meta: "608 × 26" },
      { id: "s-prof", name: "Profile columns", stage: "Explore", meta: "3 sparse" },
    ],
  },
  {
    num: "02",
    name: "Clean",
    summary: "Missing, outliers, leakage",
    countText: "0 / 3",
    steps: [
      {
        id: "s-miss",
        name: "Missing values ≥ 20%",
        stage: "Clean",
        meta: "Drop 3 columns",
        tag: "Queued",
      },
      {
        id: "s-iqr",
        name: "Clip outliers (IQR)",
        stage: "Clean",
        meta: "14 rows",
        tag: "Queued",
      },
      {
        id: "s-leak",
        name: "Target leakage gate",
        stage: "Clean",
        meta: "2 flagged",
        tag: "Issue",
        isIssue: true,
      },
    ],
  },
  {
    num: "03",
    name: "Feature selection",
    summary: "Rank and keep signal",
    countText: "2 / 2",
    steps: [
      { id: "s-rank", name: "Rank features", stage: "Feature selection", meta: "Permutation" },
      { id: "s-keep", name: "Keep top features", stage: "Feature selection", meta: "k = 12" },
    ],
  },
];

export function FlowPage() {
  const [sidebarTab, setSidebarTab] = useState<"Pipeline" | "Operators" | "Plugins">("Pipeline");
  const [query, setQuery] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string>("s-miss");
  const [activeStepTab, setActiveStepTab] = useState<StepTab>("Methodology");
  const [chosenOption, setChosenOption] = useState<number>(0);
  const [thresholdVal, setThresholdVal] = useState<number>(20);
  const [composerText, setComposerText] = useState("");
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  return (
    <div className="flw-page-layout">
      {/* 280px Left Sidebar */}
      <aside className="flw-sidebar" aria-label="Pipeline sidebar">
        <div className="flw-sidebar-head">
          <h2 className="flw-sidebar-title">Pipeline</h2>
          <Segmented
            value={sidebarTab}
            onChange={(v) => setSidebarTab(v as "Pipeline" | "Operators" | "Plugins")}
            options={[
              { value: "Pipeline", label: "Pipeline" },
              { value: "Operators", label: "Operators" },
              { value: "Plugins", label: "Plugins" },
            ]}
          />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search steps"
          />
        </div>

        <div className="flw-sidebar-list">
          {STAGES.map((stg) => {
            const filteredSteps = stg.steps.filter(
              (s) => !query || s.name.toLowerCase().includes(query.toLowerCase()),
            );
            if (query && filteredSteps.length === 0) return null;

            return (
              <section key={stg.name} className="flw-group-section">
                <div className="flw-group-header">
                  <span className="flw-group-num mono">{stg.num}</span>
                  <span className="flw-group-name">{stg.name}</span>
                  <span className="flw-group-count mono">{stg.countText}</span>
                  <span className="flw-group-chevron open">
                    <Chevron />
                  </span>
                </div>

                <div className="flw-group-items">
                  {filteredSteps.map((step) => {
                    const isSelected = step.id === selectedStepId;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        className={`flw-step-row ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedStepId(step.id)}
                      >
                        <span className={`flw-row-glyph ${step.isIssue ? "issue" : ""}`} />
                        <span className="flw-row-name">{step.name}</span>
                        {step.tag && (
                          <Tag tone={step.isIssue ? "danger" : "queued"}>
                            {step.tag}
                          </Tag>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flw-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Type", v: "Decision" },
              { k: "Status", v: "Queued" },
              { k: "Downstream", v: "3 steps" },
            ]}
          />
        </div>
      </aside>

      {/* Main Flow Canvas and Bottom Step Panel */}
      <main className="flw-center" aria-label="Flow canvas and step details">
        {/* Top Canvas Area */}
        <div className="flw-canvas-area">
          {/* Stage Cards Layout */}
          <div className="flw-stages-flow">
            {STAGES.map((stg) => (
              <StageCard
                key={stg.name}
                label={stg.name}
                description={stg.summary}
                progress={stg.countText}
                width={300}
              >
                {stg.steps.map((step) => {
                  const isSelected = step.id === selectedStepId;
                  return (
                    <FlowNode
                      key={step.id}
                      label={step.name}
                      status={step.meta}
                      selected={isSelected}
                      warn={step.isIssue}
                      dot={step.isIssue ? "warn" : step.tag === "Queued" ? "queued" : "ok"}
                      onClick={() => setSelectedStepId(step.id)}
                    />
                  );
                })}
              </StageCard>
            ))}
          </div>

          {/* SVG Connection Lines overlay */}
          <svg className="flw-connections-svg" aria-hidden="true">
            {/* Explore to Clean connection */}
            <path
              d="M 340 120 C 370 120, 370 120, 400 120"
              fill="none"
              stroke="var(--alpha-14)"
              strokeWidth="1.5"
            />
            {/* Clean to Feature Selection connection */}
            <path
              d="M 720 120 C 750 120, 750 120, 780 120"
              fill="none"
              stroke="var(--alpha-14)"
              strokeWidth="1.5"
            />
            {/* Leakage branch dashed red curve */}
            <path
              d="M 680 236 C 720 236, 730 260, 780 260"
              fill="none"
              stroke="var(--danger)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          </svg>

          {/* Floating Zoom Bar at bottom-left */}
          <div className="flw-zoom-bar">
            <button
              type="button"
              className="flw-zoom-btn"
              onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
            >
              −
            </button>
            <span className="flw-zoom-val mono">{zoomLevel}%</span>
            <button
              type="button"
              className="flw-zoom-btn"
              onClick={() => setZoomLevel((z) => Math.min(150, z + 10))}
            >
              +
            </button>
            <span className="flw-zoom-sep">·</span>
            <button
              type="button"
              className="flw-zoom-btn"
              onClick={() => setZoomLevel(100)}
            >
              Fit
            </button>
            <span className="flw-zoom-sep">·</span>
            <button type="button" className="flw-zoom-btn">
              Trace column
            </button>
          </div>
        </div>

        {/* Bottom Step Panel */}
        <section className="flw-step-panel" aria-label="Step inspector details">
          {/* Subtabs Strip */}
          <div className="flw-step-tabs-strip">
            <div className="flw-tabs-group" role="tablist">
              {STEP_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={activeStepTab === t}
                  className={`flw-step-tab-btn ${activeStepTab === t ? "active" : ""}`}
                  onClick={() => setActiveStepTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flw-panel-actions">
              <button type="button" className="flw-action-btn" title="Expand panel">
                ⤢
              </button>
              <button type="button" className="flw-action-btn" title="Close panel">
                ×
              </button>
            </div>
          </div>

          {/* Step Tab Content */}
          <div className="flw-tab-body">
            {activeStepTab === "Methodology" ? (
              <div className="flw-methodology-grid">
                {/* Column 1: Rule */}
                <div className="flw-method-col">
                  <span className="flw-col-label">Rule</span>
                  <h3 className="flw-rule-title">Missing data treatment strategy</h3>
                  <p className="flw-rule-desc">
                    Chooses drop columns ≥ threshold. Above 20% the imputed share starts to dominate
                    the column.
                  </p>
                  <div className="flw-rule-decisions">
                    <span className="flw-col-label">Decision</span>
                    <div className="flw-dec-row">
                      <span className="flw-dec-k">Columns ≥ 20% missing</span>
                      <span className="flw-dec-v mono">3</span>
                    </div>
                    <div className="flw-dec-row">
                      <span className="flw-dec-k">Highest share</span>
                      <span className="flw-dec-v mono">31.2% · umami_score</span>
                    </div>
                    <div className="flw-dec-row">
                      <span className="flw-dec-k">Imputed cells</span>
                      <span className="flw-dec-v mono">41</span>
                    </div>
                  </div>
                </div>

                {/* Column 2: Alternatives */}
                <div className="flw-method-col">
                  <span className="flw-col-label">Alternatives</span>
                  <div className="flw-options-list">
                    <label
                      className={`flw-option-card ${chosenOption === 0 ? "active" : ""}`}
                      onClick={() => setChosenOption(0)}
                    >
                      <input
                        type="radio"
                        name="methodOption"
                        checked={chosenOption === 0}
                        onChange={() => setChosenOption(0)}
                      />
                      <div className="flw-opt-texts">
                        <strong className="flw-opt-title">Drop columns ≥ threshold</strong>
                        <span className="flw-opt-sub">Rule&rsquo;s pick</span>
                      </div>
                    </label>

                    <label
                      className={`flw-option-card ${chosenOption === 1 ? "active" : ""}`}
                      onClick={() => setChosenOption(1)}
                    >
                      <input
                        type="radio"
                        name="methodOption"
                        checked={chosenOption === 1}
                        onChange={() => setChosenOption(1)}
                      />
                      <div className="flw-opt-texts">
                        <strong className="flw-opt-title">Impute median</strong>
                      </div>
                    </label>

                    <label
                      className={`flw-option-card ${chosenOption === 2 ? "active" : ""}`}
                      onClick={() => setChosenOption(2)}
                    >
                      <input
                        type="radio"
                        name="methodOption"
                        checked={chosenOption === 2}
                        onChange={() => setChosenOption(2)}
                      />
                      <div className="flw-opt-texts">
                        <strong className="flw-opt-title">Add missing indicator</strong>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Column 3: Adjust */}
                <div className="flw-method-col">
                  <span className="flw-col-label">Adjust</span>
                  <div className="flw-adjust-box">
                    <div className="flw-adjust-row">
                      <span className="flw-adjust-label">Drop threshold</span>
                      <span className="flw-adjust-val mono">{thresholdVal}%</span>
                    </div>
                    <Slider
                      value={thresholdVal}
                      onChange={setThresholdVal}
                      min={5}
                      max={50}
                      step={1}
                      recommended={20}
                    />
                    <div className="flw-adjust-actions">
                      <Button variant="secondary" size="sm">
                        Rule details
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeStepTab === "Code" ? (
              <div className="flw-code-view">
                <pre className="flw-code-block mono">
                  <code>{`import pandas as pd

THRESHOLD = 0.20  # decision: Missing values ≥ 20%

share = df.isna().mean()
drop = share[share >= THRESHOLD].index
df = df.drop(columns=drop)

print(f"dropped {len(drop)} columns")`}</code>
                </pre>
              </div>
            ) : activeStepTab === "Console" ? (
              <div className="flw-console-view mono">
                <div className="flw-log-line">
                  <span className="log-t">11:00:04</span> <span>Loading umami_flavour_v2.tsv (608 rows, 26 cols)</span>
                </div>
                <div className="flw-log-line">
                  <span className="log-t">11:00:05</span> <span>Computing missingness share across columns</span>
                </div>
                <div className="flw-log-line log-warn">
                  <span className="log-t">11:00:06</span> <span>Identified 3 columns ≥ 20% missing: umami_score (31.2%), charge_density (24.1%), pI_shifted (20.5%)</span>
                </div>
                <div className="flw-log-line">
                  <span className="log-t">11:00:07</span> <span>Ready to drop 3 columns</span>
                </div>
              </div>
            ) : (
              <div className="flw-generic-tab-view">
                <span className="flw-tab-preview-text">
                  Showing {activeStepTab} data for step: Missing values ≥ 20%
                </span>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

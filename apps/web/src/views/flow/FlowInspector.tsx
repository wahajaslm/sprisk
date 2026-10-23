import { useState, useMemo } from "react";
import { INSPECTOR_TABS, type InspectorTab, TAB_LABEL } from "../../workbench/inspectorTabs.ts";
import { useStep, TabBody } from "../inspector/step.tsx";
import { ViewInstance } from "../../workbench/instance.tsx";
import { SplitMethodology } from "../inspector/SplitMethodology.tsx";
import { ChecksTab } from "../inspector/ChecksTab.tsx";
import { useSelection } from "../../workbench/selection.ts";

export function FlowInspector() {
  const [activeTab, setActiveTab] = useState<InspectorTab>("checks");
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [threshold, setThreshold] = useState(20);
  const [selectedAlt, setSelectedAlt] = useState("drop");

  const step = useStep();
  const { pipeline, node, nodeId } = step;

  const isMethodology = activeTab === "checks";
  const stepName = node ? node.id : "Missing values ≥ 20%";

  return (
    <div
      className={`flow-inspector ${collapsed ? "collapsed" : ""} ${maximized ? "maximized" : ""}`}
      aria-label="Flow Inspector"
    >
      {/* Header bar */}
      <div className="flow-inspector-header">
        <div className="flow-inspector-tabs" role="tablist" aria-label="Inspector tabs">
          {INSPECTOR_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`flow-inspector-tab-btn ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  if (collapsed) setCollapsed(false);
                }}
              >
                {TAB_LABEL[tab]}
                {tab === "checks" && step.concernCount > 0 && (
                  <span className="flow-tab-badge alert">⚠ {step.concernCount}</span>
                )}
                {tab === "console" && step.problems > 0 && (
                  <span className="flow-tab-badge alert">⚠ {step.problems}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flow-inspector-actions">
          <button
            type="button"
            className="flow-inspector-btn"
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore panel" : "Maximize panel"}
            onClick={() => {
              setMaximized((m) => !m);
              if (collapsed) setCollapsed(false);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {maximized ? (
                <path d="M4 1v3H1m11-3h3v3m0 8v3h-3m-8 0H1v-3" />
              ) : (
                <path d="M1 5V1h4m6 0h4v4m0 6v4h-4m-6 0H1v-4" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="flow-inspector-btn"
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            onClick={() => setCollapsed((c) => !c)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
            >
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="flow-inspector-body">
          <ViewInstance pin={undefined} setPin={undefined} tab={activeTab}>
            {isMethodology ? (
              <div className="methodology-grid-view">
                {/* Column 1: Rule */}
                <div className="methodology-col rule-col">
                  <div className="methodology-section-title">Rule</div>
                  <div className="methodology-rule-title">Missing data treatment strategy</div>
                  <div className="methodology-rule-desc">
                    Chooses drop columns ≥ threshold. Above 20% the imputed share starts to dominate the column.
                  </div>

                  <div className="methodology-decision-block">
                    <div className="methodology-section-title">Decision</div>
                    <div className="methodology-fact-row">
                      <span className="fact-key">Columns ≥ 20% missing</span>
                      <span className="fact-val mono">3</span>
                    </div>
                    <div className="methodology-fact-row">
                      <span className="fact-key">Highest share</span>
                      <span className="fact-val mono">31.2% · umami_score</span>
                    </div>
                    <div className="methodology-fact-row">
                      <span className="fact-key">Imputed cells</span>
                      <span className="fact-val mono">41</span>
                    </div>
                  </div>
                </div>

                {/* Column 2: Alternatives */}
                <div className="methodology-col alts-col">
                  <div className="methodology-section-title">Alternatives</div>
                  <div className="methodology-alts-list">
                    <label className={`alt-card ${selectedAlt === "drop" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="methodology-alt"
                        checked={selectedAlt === "drop"}
                        onChange={() => setSelectedAlt("drop")}
                        style={{ display: "none" }}
                      />
                      <div className="alt-radio-dot">
                        {selectedAlt === "drop" && <div className="alt-radio-fill" />}
                      </div>
                      <div className="alt-info">
                        <div className="alt-title-row">
                          <span className="alt-title">Drop columns ≥ threshold</span>
                          <span className="alt-tag">Rule's pick</span>
                        </div>
                      </div>
                    </label>

                    <label className={`alt-card ${selectedAlt === "impute" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="methodology-alt"
                        checked={selectedAlt === "impute"}
                        onChange={() => setSelectedAlt("impute")}
                        style={{ display: "none" }}
                      />
                      <div className="alt-radio-dot">
                        {selectedAlt === "impute" && <div className="alt-radio-fill" />}
                      </div>
                      <div className="alt-info">
                        <span className="alt-title">Impute median</span>
                      </div>
                    </label>

                    <label className={`alt-card ${selectedAlt === "indicator" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="methodology-alt"
                        checked={selectedAlt === "indicator"}
                        onChange={() => setSelectedAlt("indicator")}
                        style={{ display: "none" }}
                      />
                      <div className="alt-radio-dot">
                        {selectedAlt === "indicator" && <div className="alt-radio-fill" />}
                      </div>
                      <div className="alt-info">
                        <span className="alt-title">Add missing indicator</span>
                      </div>
                    </label>
                  </div>

                </div>

                {/* Column 3: Adjust */}
                <div className="methodology-col adjust-col">
                  <div className="methodology-section-title">Adjust</div>
                  <div className="adjust-control-group">
                    <div className="adjust-label-row">
                      <span className="adjust-label">Drop threshold</span>
                      <span className="adjust-val mono">{threshold}%</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={1}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="adjust-slider"
                    />
                  </div>

                  <button type="button" className="rule-details-btn">
                    Rule details
                  </button>
                </div>
              </div>
            ) : nodeId ? (
              <TabBody tab={activeTab} step={step} />
            ) : (
              <div className="flow-inspector-empty">
                <p className="muted">Select a step in the flow to inspect its {TAB_LABEL[activeTab].toLowerCase()}.</p>
              </div>
            )}
          </ViewInstance>
        </div>
      )}
    </div>
  );
}

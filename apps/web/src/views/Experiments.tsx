import { useState } from "react";
import { useOperators, usePipelineVersions } from "../api/hooks.ts";
import { useSelection } from "../workbench/selection.ts";
import { SearchField } from "../components/ui/SearchField.tsx";
import { Tag } from "../components/ui/Tag.tsx";
import { Button } from "../components/ui/Button.tsx";
import { InfoDock } from "../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon, Chevron } from "./Icons.tsx";

const TABS = ["Monitor", "Compare", "Sweep"] as const;
type Tab = (typeof TABS)[number];

type RunItem = {
  id: string;
  num: string;
  name: string;
  sub: string;
  tag?: string;
  isIssue?: boolean;
  status: "running" | "succeeded" | "failed" | "queued";
};

const DEMO_RUNS: RunItem[] = [
  {
    id: "run-17",
    num: "17",
    name: "Run 17",
    sub: "Started 14:02 · 00:42",
    tag: "Running",
    status: "running",
  },
  {
    id: "run-16",
    num: "16",
    name: "Run 16",
    sub: "Missing 30% · k = 12",
    status: "succeeded",
  },
  {
    id: "run-15",
    num: "15",
    name: "Run 15",
    sub: "IQR 2.0×",
    status: "succeeded",
  },
  {
    id: "run-14",
    num: "14",
    name: "Run 14",
    sub: "Drop leakage cols",
    status: "succeeded",
  },
  {
    id: "run-13",
    num: "13",
    name: "Run 13",
    sub: "PCA 0.95",
    tag: "Issue",
    isIssue: true,
    status: "failed",
  },
];

type StepProgress = {
  name: string;
  status: "Done" | "Failed" | "Running" | "Waiting";
  duration: string;
  barWidth: string;
  barTone: "neutral" | "danger" | "running" | "waiting";
};

const DEMO_STEPS: StepProgress[] = [
  { name: "umami_flavour_v2.tsv", status: "Done", duration: "0.4 s", barWidth: "100%", barTone: "neutral" },
  { name: "Profile columns", status: "Done", duration: "1.2 s", barWidth: "100%", barTone: "neutral" },
  { name: "Missing values ≥ 20%", status: "Done", duration: "0.3 s", barWidth: "100%", barTone: "neutral" },
  { name: "Clip outliers (IQR)", status: "Done", duration: "0.2 s", barWidth: "100%", barTone: "neutral" },
  { name: "Target leakage gate", status: "Failed", duration: "0.1 s", barWidth: "100%", barTone: "danger" },
  { name: "Rank features", status: "Running", duration: "14.8 s", barWidth: "60%", barTone: "running" },
  { name: "Keep top features", status: "Waiting", duration: "—", barWidth: "0%", barTone: "waiting" },
];

export function Experiments() {
  const { setNav } = useSelection();

  const [query, setQuery] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string>("run-17");
  const [activeTab, setActiveTab] = useState<Tab>("Monitor");
  const [composerText, setComposerText] = useState("");
  const [sweepsFolded, setSweepsFolded] = useState(false);

  const activeRun = DEMO_RUNS.find((r) => r.id === selectedRunId) ?? DEMO_RUNS[0]!;

  const filteredRuns = DEMO_RUNS.filter(
    (r) => !query || r.name.toLowerCase().includes(query.toLowerCase()) || r.sub.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="exp-page-layout">
      {/* 280px Runs Sidebar */}
      <aside className="exp-sidebar" aria-label="Experiments sidebar">
        <div className="exp-sidebar-head">
          <h2 className="exp-sidebar-title">Runs</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search runs"
          />
        </div>

        <div className="exp-sidebar-list">
          {filteredRuns.map((r) => {
            const isSelected = r.id === selectedRunId;
            return (
              <button
                key={r.id}
                type="button"
                className={`exp-run-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedRunId(r.id)}
              >
                <div className="exp-run-header">
                  <span className="exp-run-name">{r.name}</span>
                  {r.tag && <Tag tone={r.isIssue ? "danger" : "queued"}>{r.tag}</Tag>}
                </div>
                <span className="exp-run-sub">{r.sub}</span>
              </button>
            );
          })}

          {/* Sweeps Group */}
          <div className="exp-sweeps-section">
            <button
              type="button"
              className="exp-group-head-btn"
              onClick={() => setSweepsFolded((f) => !f)}
            >
              <span className="exp-group-num mono">02</span>
              <span className="exp-group-name">Sweeps</span>
              <span className="exp-group-count mono">1</span>
              <span className={`exp-group-chevron ${!sweepsFolded ? "open" : ""}`}>
                <Chevron />
              </span>
            </button>
            {!sweepsFolded && (
              <div className="exp-group-body">
                <button type="button" className="exp-run-item" onClick={() => setActiveTab("Sweep")}>
                  <div className="exp-run-header">
                    <span className="exp-run-name">Random forest sweep</span>
                    <Tag tone="queued">Running</Tag>
                  </div>
                  <span className="exp-run-sub">26 of 40 trials</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="exp-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Accuracy", v: "0.912" },
              { k: "Δ baseline", v: "+1.4 pts" },
            ]}
          />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="exp-main" aria-label="Run monitor detail">
        {/* Header */}
        <header className="exp-head">
          <div className="exp-head-meta">
            <span className="exp-eyebrow">Run 17 · umami · started 14:02</span>
            <h1 className="exp-title">Running · 00:42 elapsed</h1>
            <p className="exp-subtitle">Paused branch at the leakage gate; the rest of the flow continues.</p>
          </div>
          <div className="exp-head-actions">
            <Button variant="secondary" size="sm">
              Stop
            </Button>
            <Button variant="secondary" size="sm">
              Open logs
            </Button>
            <Button variant="primary" size="sm">
              Re-run failed
            </Button>
          </div>
        </header>

        {/* Subtabs Strip */}
        <div className="exp-subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`exp-tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="exp-tab-content">
          {activeTab === "Monitor" ? (
            <div className="exp-monitor-view">
              {/* Progress Bar */}
              <div className="exp-progress-bar-wrap">
                <div className="exp-progress-line">
                  <div className="exp-progress-fill" style={{ width: "71%" }} />
                </div>
                <span className="exp-progress-text">5 of 7 steps · est. 00:24 left</span>
              </div>

              {/* Two Columns: Steps & Resources */}
              <div className="exp-monitor-grid">
                {/* Steps Column */}
                <div className="exp-steps-col">
                  <h3 className="exp-col-title">Steps</h3>
                  <div className="exp-steps-list">
                    {DEMO_STEPS.map((s) => (
                      <div key={s.name} className="exp-step-row">
                        <span className="exp-step-name">{s.name}</span>
                        <span className={`exp-step-status status-${s.status.toLowerCase()}`}>
                          <span className="status-dot" /> {s.status}
                        </span>
                        <div className="exp-step-bar-wrap">
                          <div className={`exp-step-bar tone-${s.barTone}`} style={{ width: s.barWidth }} />
                        </div>
                        <span className="exp-step-dur mono">{s.duration}</span>
                      </div>
                    ))}
                  </div>

                  {/* Failure Banner Card */}
                  <div className="exp-failure-card">
                    <strong className="failure-card-title">Leakage gate failed</strong>
                    <p className="failure-card-body">
                      panel_score and bitter_index correlate above 0.95 with the label. Open the step to drop them or
                      override the gate.
                    </p>
                  </div>
                </div>

                {/* Resources Column */}
                <div className="exp-resources-col">
                  <h3 className="exp-col-title">Resources</h3>

                  <div className="resource-item">
                    <div className="resource-header">
                      <span className="resource-label">CPU</span>
                      <span className="resource-val mono">68% · 4 cores</span>
                    </div>
                    {/* CPU Sparkline Bars */}
                    <div className="cpu-sparkline">
                      {[30, 42, 38, 55, 60, 52, 48, 45, 40, 38, 35, 30, 28, 25, 22, 25, 32, 40, 50, 65, 75, 85, 95, 92].map((h, i) => (
                        <div
                          key={i}
                          className={`spark-bar ${h > 90 ? "peak" : ""}`}
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="resource-item">
                    <div className="resource-header">
                      <span className="resource-label">Memory</span>
                      <span className="resource-val mono">2.1 of 8 GB</span>
                    </div>
                  </div>

                  <div className="resource-item">
                    <div className="resource-header">
                      <span className="resource-label">GPU</span>
                      <span className="resource-val mono">Not used</span>
                    </div>
                  </div>

                  {/* Live Log */}
                  <div className="live-log-section">
                    <h4 className="live-log-title">Live log</h4>
                    <pre className="live-log-box mono">
                      <div className="log-line">
                        <span className="log-time">14:02:43</span>
                        <span className="log-msg">rank_features · permutation 16 / 26</span>
                      </div>
                      <div className="log-line">
                        <span className="log-time">14:02:41</span>
                        <span className="log-msg">rank_features · fold 3 done</span>
                      </div>
                      <div className="log-line log-fail">
                        <span className="log-time">14:02:13</span>
                        <span className="log-msg">leakage_gate · FAIL · 2 columns</span>
                      </div>
                      <div className="log-line">
                        <span className="log-time">14:02:12</span>
                        <span className="log-msg">clip_outliers · 14 rows clipped</span>
                      </div>
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === "Compare" ? (
            <div className="exp-compare-view">
              <table className="exp-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: "right" }}>Run 17</th>
                    <th style={{ textAlign: "right" }}>Run 16</th>
                    <th style={{ textAlign: "right" }}>Δ Delta</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Accuracy</td>
                    <td className="mono num-cell">0.912</td>
                    <td className="mono num-cell">0.898</td>
                    <td className="mono num-cell">+0.014</td>
                  </tr>
                  <tr>
                    <td>ROC AUC</td>
                    <td className="mono num-cell">0.951</td>
                    <td className="mono num-cell">0.945</td>
                    <td className="mono num-cell">+0.006</td>
                  </tr>
                  <tr>
                    <td>F1 Score</td>
                    <td className="mono num-cell">0.907</td>
                    <td className="mono num-cell">0.896</td>
                    <td className="mono num-cell">+0.011</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="exp-sweep-view">
              <p className="muted">Random forest sweep: 26 of 40 trials completed. Best trial: trial_14 (ROC AUC 0.954).</p>
            </div>
          )}
        </div>
      </main>

      {/* Right 340px Copilot Column */}
      <aside className="exp-copilot" aria-label="Copilot assistant">
        <div className="copilot-head">
          <SparkIcon />
          <strong>Copilot</strong>
          <span className="spacer" />
          <span className="chip">Running · 00:42 elapsed</span>
          <button type="button" className="icon-btn icon-btn-sm" title="Toggle copilot rail">
            <PanelToggleIcon />
          </button>
        </div>

        <div className="exp-copilot-body">
          <div className="exp-copilot-bubble">
            <p>
              Run 16 beats the baseline mainly through k = 12; the 30% threshold alone adds 0.2 points.
            </p>
          </div>

          <div className="exp-copilot-suggestions">
            <Tag tone="default" onClick={() => setActiveTab("Compare")}>
              Diff with run 15
            </Tag>
          </div>
        </div>

        <div className="copilot-foot">
          <div className="composer">
            <input
              placeholder="Ask about this step"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
            />
            <button type="button" className="send" aria-label="Send" disabled={!composerText.trim()}>
              <SendIcon />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

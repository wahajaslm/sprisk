import { useState } from "react";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon, Chevron } from "../Icons.tsx";

const TABS = ["Card", "Explain", "Monitoring", "Endpoints"] as const;
type Tab = (typeof TABS)[number];

type ModelItem = {
  id: string;
  name: string;
  sub: string;
  tag?: string;
  isIssue?: boolean;
};

const DEMO_MODELS: ModelItem[] = [
  {
    id: "m-v4",
    name: "peptide_umami v4",
    sub: "Production · run 16",
    tag: "Issue",
    isIssue: true,
  },
  {
    id: "m-v3",
    name: "peptide_umami v3",
    sub: "Staging · run 15",
  },
];

export function DeployPage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("m-v4");
  const [activeTab, setActiveTab] = useState<Tab>("Card");
  const [composerText, setComposerText] = useState("");

  const filteredModels = DEMO_MODELS.filter(
    (m) => !query || m.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="dep-page-layout">
      {/* 280px Models Sidebar */}
      <aside className="dep-sidebar" aria-label="Models sidebar">
        <div className="dep-sidebar-head">
          <h2 className="dep-sidebar-title">Models</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search models"
          />
        </div>

        <div className="dep-sidebar-list">
          <section className="dep-group-section">
            <div className="dep-group-header">
              <span className="dep-group-num mono">01</span>
              <span className="dep-group-name">Models</span>
              <span className="dep-group-count mono">{DEMO_MODELS.length}</span>
              <span className="dep-group-chevron open">
                <Chevron />
              </span>
            </div>

            <div className="dep-group-items">
              {filteredModels.map((item) => {
                const isSelected = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`dep-item ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="dep-item-title-row">
                      <span className="dep-item-title">{item.name}</span>
                      {item.tag && (
                        <Tag tone={item.isIssue ? "danger" : "default"}>
                          {item.tag}
                        </Tag>
                      )}
                    </div>
                    <span className="dep-item-sub">{item.sub}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="dep-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "p95 latency", v: "41 ms" },
              { k: "Drift", v: "pI · PSI 0.27", warn: true },
            ]}
          />
        </div>
      </aside>

      {/* Main Model Card Area */}
      <main className="dep-main" aria-label="Deploy model card">
        {/* Header */}
        <header className="dep-head">
          <div className="dep-head-meta">
            <span className="dep-eyebrow">Model card · Random forest classifier</span>
            <h1 className="dep-title">peptide_umami · v4</h1>
            <p className="dep-subtitle">
              Classifies peptides as umami or non-umami from sequence-derived descriptors.
            </p>
          </div>
          <div className="dep-head-actions">
            <Button variant="secondary" size="sm">
              Request changes
            </Button>
            <Button variant="primary" size="sm">
              Approve
            </Button>
          </div>
        </header>

        {/* Subtabs */}
        <div className="dep-subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`dep-tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="dep-content-grid">
          {/* Left Column: Performance & Evaluation */}
          <div className="dep-left-col">
            {/* Performance */}
            <div className="dep-section-card">
              <div className="dep-section-header">
                <h2 className="dep-section-title">Performance</h2>
                <span className="dep-section-meta mono">Test set · 122 peptides · vs v3</span>
              </div>
              <table className="dep-metrics-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="th-right">Value</th>
                    <th className="th-right">Δ v3</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Accuracy</td>
                    <td className="td-right mono">0.912</td>
                    <td className="td-right mono delta-pos">+1.4</td>
                  </tr>
                  <tr>
                    <td>F1</td>
                    <td className="td-right mono">0.907</td>
                    <td className="td-right mono delta-pos">+1.1</td>
                  </tr>
                  <tr>
                    <td>ROC AUC</td>
                    <td className="td-right mono">0.951</td>
                    <td className="td-right mono delta-pos">+0.6</td>
                  </tr>
                  <tr>
                    <td>Calibration error</td>
                    <td className="td-right mono">0.031</td>
                    <td className="td-right mono delta-danger">+0.004</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Evaluation */}
            <div className="dep-section-card">
              <div className="dep-section-header">
                <h2 className="dep-section-title">Evaluation</h2>
              </div>
              <div className="dep-eval-grid">
                {/* ROC Curve SVG */}
                <div className="dep-eval-box">
                  <div className="roc-svg-wrap">
                    <svg
                      viewBox="0 0 240 180"
                      className="roc-svg"
                      aria-label="ROC curve chart"
                    >
                      {/* Grid lines */}
                      <line x1="40" y1="20" x2="220" y2="20" stroke="var(--alpha-06)" strokeWidth="1" />
                      <line x1="40" y1="80" x2="220" y2="80" stroke="var(--alpha-06)" strokeWidth="1" />
                      <line x1="40" y1="140" x2="220" y2="140" stroke="var(--alpha-06)" strokeWidth="1" />
                      <line x1="40" y1="20" x2="40" y2="140" stroke="var(--alpha-08)" strokeWidth="1" />
                      <line x1="220" y1="20" x2="220" y2="140" stroke="var(--alpha-06)" strokeWidth="1" />

                      {/* Diagonal chance line */}
                      <line
                        x1="40"
                        y1="140"
                        x2="220"
                        y2="20"
                        stroke="var(--alpha-14)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />

                      {/* ROC Curve line */}
                      <path
                        d="M 40 140 Q 44 40, 90 28 T 220 20"
                        fill="none"
                        stroke="var(--ink-0)"
                        strokeWidth="1.75"
                      />

                      {/* Axis labels */}
                      <text
                        x="34"
                        y="144"
                        fill="var(--ink-5)"
                        fontSize="10"
                        textAnchor="end"
                        fontFamily="var(--mono)"
                      >
                        0
                      </text>
                      <text
                        x="220"
                        y="156"
                        fill="var(--ink-5)"
                        fontSize="10"
                        textAnchor="middle"
                        fontFamily="var(--mono)"
                      >
                        1
                      </text>
                      <text
                        x="130"
                        y="168"
                        fill="var(--ink-4)"
                        fontSize="10.5"
                        textAnchor="middle"
                      >
                        False positive rate
                      </text>
                      <text
                        x="-80"
                        y="18"
                        fill="var(--ink-4)"
                        fontSize="10.5"
                        textAnchor="middle"
                        transform="rotate(-90)"
                      >
                        True positive rate
                      </text>
                    </svg>
                  </div>
                  <span className="eval-caption">ROC curve · AUC 0.951</span>
                </div>

                {/* Confusion Matrix */}
                <div className="dep-eval-box">
                  <div className="cm-wrap">
                    <div className="cm-header-row">
                      <span className="cm-empty-corner" />
                      <span className="cm-col-label">Pred umami</span>
                      <span className="cm-col-label">Pred non</span>
                    </div>
                    <div className="cm-body-row">
                      <span className="cm-row-label">True umami</span>
                      <div className="cm-cell cm-cell-hl">
                        <span className="cm-val mono">54</span>
                        <span className="cm-lbl">correct</span>
                      </div>
                      <div className="cm-cell">
                        <span className="cm-val mono">5</span>
                        <span className="cm-lbl">missed</span>
                      </div>
                    </div>
                    <div className="cm-body-row">
                      <span className="cm-row-label">True non</span>
                      <div className="cm-cell">
                        <span className="cm-val mono">6</span>
                        <span className="cm-lbl">false alarm</span>
                      </div>
                      <div className="cm-cell cm-cell-hl">
                        <span className="cm-val mono">57</span>
                        <span className="cm-lbl">correct</span>
                      </div>
                    </div>
                  </div>
                  <span className="eval-caption">Confusion matrix</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Model & Decisions */}
          <div className="dep-right-col">
            {/* Model Card */}
            <div className="dep-summary-card">
              <h3 className="dep-card-title">Model</h3>
              <div className="dep-kv-list">
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Version</span>
                  <span className="dep-kv-v mono">v4 · run 16</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Algorithm</span>
                  <span className="dep-kv-v">Random forest</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Trained</span>
                  <span className="dep-kv-v">20 Oct 2026</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Dataset</span>
                  <span className="dep-kv-v mono">umami_flavour_v2 · v4</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Rows</span>
                  <span className="dep-kv-v mono">486 train · 122 test</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Features</span>
                  <span className="dep-kv-v mono">12 of 26</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Owner</span>
                  <span className="dep-kv-v">Mina Okafor</span>
                </div>
              </div>
            </div>

            {/* Decisions Card */}
            <div className="dep-summary-card">
              <div className="dep-summary-head">
                <h3 className="dep-card-title">Decisions</h3>
                <span className="dep-card-badge mono">Methodology v1.0</span>
              </div>
              <div className="dep-kv-list">
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Missing values</span>
                  <span className="dep-kv-v">Drop ≥ 20%</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Outliers</span>
                  <span className="dep-kv-v">Retained</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Leakage</span>
                  <span className="dep-kv-v">Blocked umami_score</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Feature selection</span>
                  <span className="dep-kv-v mono">Top k = 12</span>
                </div>
                <div className="dep-kv-row">
                  <span className="dep-kv-k">Split</span>
                  <span className="dep-kv-v mono">Stratified 80 / 20</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Right 340px Copilot Column */}
      <aside className="dep-copilot" aria-label="Copilot assistant">
        <div className="copilot-head">
          <SparkIcon />
          <strong>Copilot</strong>
          <span className="spacer" />
          <span className="chip">peptide_umami · v4</span>
          <button type="button" className="icon-btn icon-btn-sm" title="Toggle copilot rail">
            <PanelToggleIcon />
          </button>
        </div>

        <div className="dep-copilot-body">
          <div className="dep-copilot-bubble">
            <p>
              pI drift started after 11:00. Production inputs are shifted toward higher pI.
            </p>
          </div>

          <div className="dep-copilot-suggestions">
            <Tag tone="default">Show drifted rows</Tag>
          </div>
        </div>

        <div className="copilot-foot">
          <div className="composer">
            <input
              placeholder="Ask about this step"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
            />
            <button
              type="button"
              className="send"
              aria-label="Send"
              disabled={!composerText.trim()}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

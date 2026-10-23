import { useState } from "react";
import { useMethodologyRules } from "../../api/methodology.ts";
import { useSelection } from "../../workbench/selection.ts";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Slider } from "../../components/ui/Slider.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { SparkIcon, SendIcon, PanelToggleIcon, Chevron } from "../Icons.tsx";

const TABS = ["Map", "Overview", "Code", "Used in"] as const;
type Tab = (typeof TABS)[number];

type RuleGroup = {
  num: string;
  name: string;
  rules: {
    id: string;
    name: string;
    decides: string;
    tag?: string;
    isIssue?: boolean;
  }[];
};

const RULE_GROUPS: RuleGroup[] = [
  {
    num: "01",
    name: "Cleaning",
    rules: [
      {
        id: "cleaning.missingness_strategy",
        name: "Missing data treatment strategy",
        decides: "cleaning.missingness_strategy",
      },
      {
        id: "cleaning.outlier_strategy",
        name: "Outlier treatment strategy",
        decides: "cleaning.outlier_strategy",
      },
      {
        id: "cleaning.zero_variance_elimination",
        name: "Constant and low-variance features",
        decides: "cleaning.zero_variance_elimination",
      },
    ],
  },
  {
    num: "02",
    name: "Split",
    rules: [
      {
        id: "split.method",
        name: "Data splitting and cross-validation",
        decides: "split.method",
      },
      {
        id: "split.temporal_integrity",
        name: "Time-series integrity",
        decides: "split.temporal_integrity",
      },
    ],
  },
  {
    num: "03",
    name: "Features",
    rules: [
      {
        id: "features.scaling_strategy",
        name: "Feature scaling strategy",
        decides: "features.scaling_strategy",
      },
      {
        id: "features.selection_strategy",
        name: "Feature selection",
        decides: "features.selection_strategy",
      },
      {
        id: "features.leakage_exclusion",
        name: "Target proxy and leakage d...",
        decides: "features.leakage_exclusion",
        tag: "Issue",
        isIssue: true,
      },
    ],
  },
];

export function MethodologyPage() {
  const rules = useMethodologyRules();
  const { setNav } = useSelection();

  const [query, setQuery] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<string>("cleaning.outlier_strategy");
  const [activeTab, setActiveTab] = useState<Tab>("Map");
  const [modelFamily, setModelFamily] = useState<string>("Random forest");
  const [outlierThreshold, setOutlierThreshold] = useState<number>(5);
  const [clipK, setClipK] = useState<number>(3);
  const [composerText, setComposerText] = useState("");
  const [foldedGroups, setFoldedGroups] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = (name: string) => {
    setFoldedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  };

  const selectedRule =
    RULE_GROUPS.flatMap((g) => g.rules).find((r) => r.id === selectedRuleId) ??
    RULE_GROUPS[0]!.rules[1]!;

  return (
    <div className="mth-page-layout">
      {/* 280px Rules Sidebar */}
      <aside className="mth-sidebar" aria-label="Methodology rules sidebar">
        <div className="mth-sidebar-head">
          <h2 className="mth-sidebar-title">Rules</h2>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filter rules"
          />
        </div>

        <div className="mth-sidebar-list">
          {RULE_GROUPS.map((group) => {
            const isFolded = foldedGroups.has(group.name);
            const filteredRules = group.rules.filter(
              (r) =>
                !query ||
                r.name.toLowerCase().includes(query.toLowerCase()) ||
                r.decides.toLowerCase().includes(query.toLowerCase()),
            );
            if (query && filteredRules.length === 0) return null;

            return (
              <section key={group.name} className="mth-group-section">
                <button
                  type="button"
                  className="mth-group-head-btn"
                  onClick={() => toggleGroup(group.name)}
                >
                  <span className="mth-group-num mono">{group.num}</span>
                  <span className="mth-group-name">{group.name}</span>
                  <span className="mth-group-count mono">{group.rules.length}</span>
                  <span className={`mth-group-chevron ${!isFolded ? "open" : ""}`}>
                    <Chevron />
                  </span>
                </button>

                {!isFolded && (
                  <div className="mth-group-rule-list">
                    {filteredRules.map((r) => {
                      const isSelected = r.id === selectedRuleId;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={`mth-rule-item ${isSelected ? "selected" : ""}`}
                          onClick={() => setSelectedRuleId(r.id)}
                        >
                          <div className="mth-rule-title-row">
                            <span className="mth-rule-name">{r.name}</span>
                            {r.tag && <Tag tone="danger">{r.tag}</Tag>}
                          </div>
                          <span className="mth-rule-decides mono">{r.decides}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="mth-sidebar-dock">
          <InfoDock
            title="Info"
            rows={[
              { k: "Version", v: "1.0.0" },
              { k: "Chooses now", v: "Retain outliers" },
              { k: "Used in", v: "2 steps" },
            ]}
          />
        </div>
      </aside>

      {/* Main Canvas & Rule Detail Area */}
      <main className="mth-main" aria-label="Methodology rule detail">
        {/* Header */}
        <header className="mth-head">
          <div className="mth-head-meta">
            <span className="mth-eyebrow">Cleaning · decides {selectedRule.decides}</span>
            <h1 className="mth-title">{selectedRule.name}</h1>
            <p className="mth-subtitle">Decides how extreme values are handled before training.</p>
          </div>
          <div className="mth-head-actions">
            <Button variant="secondary" size="sm">
              Share
            </Button>
            <Button variant="primary" size="sm" onClick={() => setNav("Flow")}>
              Test on flow
            </Button>
          </div>
        </header>

        {/* Subtabs Strip */}
        <div className="mth-subtabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeTab === t}
              className={`mth-tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab Content: Map Canvas */}
        <div className="mth-tab-content">
          {activeTab === "Map" ? (
            <div className="mth-map-canvas">
              {/* Left Radial Rule Hierarchy Diagram */}
              <div className="mth-tree-svg-wrap">
                <svg className="mth-tree-svg" width="600" height="520" viewBox="0 0 600 520">
                  {/* Edges from Root to Stages */}
                  <path d="M 50 260 C 100 260, 110 120, 160 120" className="mth-tree-edge" />
                  <path d="M 50 260 C 100 260, 110 260, 160 260" className="mth-tree-edge" />
                  <path d="M 50 260 C 100 260, 110 400, 160 400" className="mth-tree-edge" />

                  {/* Edges from Cleaning to Rules */}
                  <path d="M 210 120 C 260 120, 270 70, 310 70" className="mth-tree-edge" />
                  <path d="M 210 120 C 260 120, 270 120, 310 120" className="mth-tree-edge active-path" />
                  <path d="M 210 120 C 260 120, 270 170, 310 170" className="mth-tree-edge" />

                  {/* Edges from Split to Rules */}
                  <path d="M 210 260 C 260 260, 270 230, 310 230" className="mth-tree-edge" />
                  <path d="M 210 260 C 260 260, 270 290, 310 290" className="mth-tree-edge" />

                  {/* Edges from Features to Rules */}
                  <path d="M 210 400 C 260 400, 270 350, 310 350" className="mth-tree-edge" />
                  <path d="M 210 400 C 260 400, 270 400, 310 400" className="mth-tree-edge" />
                  <path d="M 210 400 C 260 400, 270 450, 310 450" className="mth-tree-edge" />

                  {/* Root Node: Rules */}
                  <circle cx="50" cy="260" r="16" className="mth-node-disc" />
                  <text x="50" y="295" className="mth-node-label" textAnchor="middle">Rules</text>

                  {/* Stage Discs */}
                  <g className="stage-group-node">
                    <circle cx="160" cy="120" r="14" className="mth-node-disc" />
                    <text x="160" y="124" className="mth-disc-num mono" textAnchor="middle">1</text>
                    <text x="185" y="116" className="mth-stage-title">Cleaning</text>
                    <text x="185" y="130" className="mth-stage-sub mono">3 rules</text>
                  </g>

                  <g className="stage-group-node">
                    <circle cx="160" cy="260" r="14" className="mth-node-disc" />
                    <text x="160" y="264" className="mth-disc-num mono" textAnchor="middle">2</text>
                    <text x="185" y="256" className="mth-stage-title">Split</text>
                    <text x="185" y="270" className="mth-stage-sub mono">2 rules</text>
                  </g>

                  <g className="stage-group-node">
                    <circle cx="160" cy="400" r="14" className="mth-node-disc" />
                    <text x="160" y="404" className="mth-disc-num mono" textAnchor="middle">3</text>
                    <text x="185" y="396" className="mth-stage-title">Features</text>
                    <text x="185" y="410" className="mth-stage-sub mono">3 rules</text>
                  </g>

                  {/* Rule Nodes */}
                  <circle cx="310" cy="70" r="4" className="mth-rule-point" />
                  <text x="325" y="66" className="mth-tree-rule-name">Missing data treatment strategy</text>
                  <text x="325" y="78" className="mth-tree-rule-decides mono">cleaning.missingness_strategy</text>

                  <circle cx="310" cy="120" r="5" className="mth-rule-point selected-point" />
                  <text x="325" y="116" className="mth-tree-rule-name selected-text">Outlier treatment strategy</text>
                  <text x="325" y="128" className="mth-tree-rule-decides mono">cleaning.outlier_strategy</text>

                  <circle cx="310" cy="170" r="4" className="mth-rule-point" />
                  <text x="325" y="166" className="mth-tree-rule-name">Constant and low-variance features</text>
                  <text x="325" y="178" className="mth-tree-rule-decides mono">cleaning.zero_variance_elimination</text>

                  <circle cx="310" cy="230" r="4" className="mth-rule-point" />
                  <text x="325" y="226" className="mth-tree-rule-name">Data splitting and cross-validation</text>
                  <text x="325" y="238" className="mth-tree-rule-decides mono">split.method</text>

                  <circle cx="310" cy="290" r="4" className="mth-rule-point" />
                  <text x="325" y="286" className="mth-tree-rule-name">Time-series integrity</text>
                  <text x="325" y="298" className="mth-tree-rule-decides mono">split.temporal_integrity</text>

                  <circle cx="310" cy="350" r="4" className="mth-rule-point" />
                  <text x="325" y="346" className="mth-tree-rule-name">Feature scaling strategy</text>
                  <text x="325" y="358" className="mth-tree-rule-decides mono">features.scaling_strategy</text>

                  <circle cx="310" cy="400" r="4" className="mth-rule-point" />
                  <text x="325" y="396" className="mth-tree-rule-name">Feature selection</text>
                  <text x="325" y="408" className="mth-tree-rule-decides mono">features.selection_strategy</text>

                  <circle cx="310" cy="450" r="4" className="mth-rule-point issue-point" />
                  <text x="325" y="446" className="mth-tree-rule-name">Target proxy and leakage exclusion</text>
                  <text x="325" y="458" className="mth-tree-rule-decides mono">features.leakage_exclusion</text>
                </svg>
              </div>

              {/* Floating Rule Card matching methodology.png */}
              <div className="mth-floating-card">
                <header className="floating-card-head">
                  <span className="floating-card-eyebrow">Cleaning · {selectedRule.decides}</span>
                  <h3 className="floating-card-title">{selectedRule.name}</h3>
                  <p className="floating-card-sub">Decides how extreme values are handled before training.</p>
                </header>

                <div className="floating-card-body">
                  <div className="rule-chosen-section">
                    <span className="card-section-label">Chosen by rule</span>
                    <div className="chosen-value-box">
                      <strong>Retain outliers</strong>
                    </div>
                  </div>

                  <div className="rule-alternatives-section">
                    <span className="card-section-label">Alternatives</span>
                    <label className="radio-card active">
                      <input type="radio" name="alt" defaultChecked />
                      <div className="radio-content">
                        <strong>Retain outliers (natural variation / tree invariance)</strong>
                        <span className="radio-sub">Rule's pick</span>
                      </div>
                    </label>
                    <label className="radio-card">
                      <input type="radio" name="alt" />
                      <div className="radio-content">
                        <strong>Clip to train mean ± k SD</strong>
                      </div>
                    </label>
                  </div>

                  <div className="rule-adjust-section">
                    <span className="card-section-label">Adjust</span>
                    <div className="slider-row">
                      <div className="slider-label-row">
                        <span>Outlier fraction threshold</span>
                        <span className="mono">{outlierThreshold}%</span>
                      </div>
                      <Slider
                        value={outlierThreshold}
                        min={1}
                        max={20}
                        step={1}
                        onChange={setOutlierThreshold}
                      />
                    </div>
                    <div className="slider-row">
                      <div className="slider-label-row">
                        <span>Clip at k × SD</span>
                        <span className="mono">{clipK.toFixed(1)} SD</span>
                      </div>
                      <Slider
                        value={clipK}
                        min={1}
                        max={6}
                        step={0.5}
                        onChange={setClipK}
                      />
                    </div>
                  </div>

                  <div className="rule-model-family-section">
                    <span className="card-section-label">Model family · what if</span>
                    <div className="model-segmented">
                      {["Random forest", "Logistic", "Neural net"].map((fam) => (
                        <button
                          key={fam}
                          type="button"
                          className={`model-seg-btn ${modelFamily === fam ? "active" : ""}`}
                          onClick={() => setModelFamily(fam)}
                        >
                          {fam}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <footer className="floating-card-foot">
                  <Button variant="primary" size="sm">
                    Open rule
                  </Button>
                  <Button variant="secondary" size="sm">
                    Code
                  </Button>
                </footer>
              </div>
            </div>
          ) : (
            <div className="mth-plain-body">
              <p className="muted">Detailed methodology documentation and code view.</p>
            </div>
          )}
        </div>
      </main>

      {/* Right 340px Copilot Column */}
      <aside className="mth-copilot" aria-label="Copilot assistant">
        <div className="copilot-head">
          <SparkIcon />
          <strong>Copilot</strong>
          <span className="spacer" />
          <span className="chip">{selectedRule.name}</span>
          <button type="button" className="icon-btn icon-btn-sm" title="Toggle copilot rail">
            <PanelToggleIcon />
          </button>
        </div>

        <div className="mth-copilot-body">
          <div className="msg-user">
            <p>Why does this rule pick retain outliers?</p>
          </div>
          <div className="mth-copilot-bubble">
            <p>
              Either outlier rate is within expected natural limits (&lt;5%) or tree models are used, which are far less
              sensitive to univariate leverage, as they split on rank order.
            </p>
          </div>

          <div className="mth-copilot-suggestions">
            <Tag tone="default">Show affected rows</Tag>
            <Tag tone="default">Override for this flow</Tag>
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

import type { PipelineVersion } from "@sprisk/contracts";
import { useMemo, useState } from "react";
import { POLICY_PRESETS } from "./methodologyData.ts";
import type { MethodologyPack, MethodologyRule, MethodologyStage, MethodologyStageId, PolicyPreset } from "./types.ts";

interface MethodologyDendrogramProps {
  stages: MethodologyStage[];
  rules: MethodologyRule[];
  ruleToggles: Record<string, boolean>;
  onToggleRule: (ruleId: string) => void;
  selectedStage: MethodologyStageId | "all";
  onSelectStage: (stageId: MethodologyStageId | "all") => void;
  selectedPack: MethodologyPack | "all";
  onSelectPack: (pack: MethodologyPack | "all") => void;
  thresholds: Record<string, number | boolean | string>;
  onUpdateThreshold: (key: string, value: number | boolean | string) => void;
  currentPipeline?: PipelineVersion | undefined;
  stageNodeMap: Record<MethodologyStageId, { nodeId: string; operator: string; ruleId?: string }[]>;
  onInspectNode: (nodeId: string) => void;
  activePreset: string;
  onSelectPreset: (preset: PolicyPreset) => void;
  activePresetName: string;
  activeTab: "dendrogram" | "config" | "bindings";
  onSelectTab: (tab: "dendrogram" | "config" | "bindings") => void;
}

interface DendrogramRulePosition {
  rule: MethodologyRule;
  stage: MethodologyStage;
  ruleY: number;
  stageY: number;
  boundNodes: { nodeId: string; operator: string }[];
  isEnabled: boolean;
}

export function MethodologyDendrogram({
  stages,
  rules,
  ruleToggles,
  onToggleRule,
  selectedStage,
  onSelectStage,
  selectedPack,
  thresholds,
  onUpdateThreshold,
  stageNodeMap,
  onInspectNode,
  activePreset,
  onSelectPreset,
  activeTab,
  onSelectTab,
  currentPipeline,
}: MethodologyDendrogramProps) {
  const [hoveredEntity, setHoveredEntity] = useState<{
    type: "root" | "stage" | "rule";
    id: string;
  } | null>(null);

  const [activeRuleId, setActiveRuleId] = useState<string | null>(
    "methodology.supervised.data_split@1.0.0"
  );

  const visibleRules = useMemo(() => {
    return rules.filter((r) => {
      if (selectedPack !== "all" && r.pack !== selectedPack) return false;
      return true;
    });
  }, [rules, selectedPack]);

  // Clean dimensions directly on canvas
  const svgWidth = 1040;
  const svgHeight = 1020;

  const rootX = 48;
  const rootY = 510;
  const stageX = 160;
  const stageOutX = 330; // Lines out start AFTER stage text so labels are never covered
  const ruleX = 540;
  const ruleTextEndX = 830;
  const spineX = 950;

  // Vertical positions for stages
  const stagePositions = useMemo(() => {
    const map: Record<MethodologyStageId, number> = {} as any;
    const count = stages.length;
    const topPad = 64;
    const available = svgHeight - topPad * 2;
    const step = available / (count - 1);
    stages.forEach((stage, idx) => {
      map[stage.id] = topPad + idx * step;
    });
    return map;
  }, [stages, svgHeight]);

  // Rule vertical positions with ~50px per row
  const rulePositions = useMemo(() => {
    const list: DendrogramRulePosition[] = [];
    const topPad = 54;
    const bottomPad = 54;
    const available = svgHeight - topPad - bottomPad;
    const rowHeight = available / Math.max(visibleRules.length, 1);

    let curY = topPad + rowHeight / 2;

    stages.forEach((stage) => {
      const stageRules = visibleRules.filter((r) => r.stage === stage.id);
      const stageBoundNodes = stageNodeMap[stage.id] ?? [];

      stageRules.forEach((rule) => {
        const bound = stageBoundNodes.filter((b) => b.ruleId === rule.id || !b.ruleId);
        const isEnabled = ruleToggles[rule.id] ?? true;
        list.push({
          rule,
          stage,
          ruleY: curY,
          stageY: stagePositions[stage.id],
          boundNodes: bound,
          isEnabled,
        });
        curY += rowHeight;
      });
    });

    return list;
  }, [stages, visibleRules, stageNodeMap, ruleToggles, stagePositions, svgHeight]);

  const activeRule = useMemo(() => {
    if (!activeRuleId) return null;
    return rules.find((r) => r.id === activeRuleId) ?? null;
  }, [rules, activeRuleId]);

  const activeStage = useMemo(() => {
    if (activeRule) return stages.find((s) => s.id === activeRule.stage) ?? null;
    if (selectedStage !== "all") return stages.find((s) => s.id === selectedStage) ?? null;
    return null;
  }, [activeRule, selectedStage, stages]);

  const gateMilestones = [
    { label: "INGEST", y: 70 },
    { label: "CLEAN", y: 240 },
    { label: "SPLIT", y: 430 },
    { label: "TRANSFORM", y: 620 },
    { label: "ESTIMATE", y: 800 },
    { label: "GOVERN", y: 960 },
  ];

  const makeBezier = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const cx1 = x1 + dx * 0.45;
    const cy1 = y1;
    const cx2 = x2 - dx * 0.45;
    const cy2 = y2;
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  };

  const activeBoundNodes = activeRule
    ? (stageNodeMap[activeRule.stage] ?? []).filter(
        (b) => b.ruleId === activeRule.id || !b.ruleId
      )
    : [];

  return (
    <>
      {/* ── LEFT: MAIN PANE (Integrated Topbar + Direct Canvas, zero outer cards) ── */}
      <div className="methodology-main">
        {/* Integrated Clean Topbar */}
        <header className="methodology-topbar">
          <div className="topbar-brand">
            <span className="eyebrow">Lifecycle Decision Topology</span>
            <div className="topbar-h1-row">
              <h1>Methodology Map</h1>
              <span className="method-count-pill">
                {Object.values(ruleToggles).filter(Boolean).length} active
              </span>
            </div>
          </div>

          {/* Global Adaptive Preset Controls */}
          <div className="topbar-presets" role="group" aria-label="Global Policy Presets">
            <span className="topbar-label">Policy Preset:</span>
            <div className="topbar-preset-buttons">
              {POLICY_PRESETS.map((preset) => {
                const isActive = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-pill ${isActive ? "active" : ""}`}
                    onClick={() => onSelectPreset(preset)}
                  >
                    <strong>{preset.name}</strong>
                    <small className="preset-strictness">{preset.strictness}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {/* View Mode Tabs */}
          <div className="topbar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "dendrogram"}
              className={`topbar-tab-btn ${activeTab === "dendrogram" ? "active" : ""}`}
              onClick={() => onSelectTab("dendrogram")}
            >
              Methodology Map
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "config"}
              className={`topbar-tab-btn ${activeTab === "config" ? "active" : ""}`}
              onClick={() => onSelectTab("config")}
            >
              Adaptive Policies
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "bindings"}
              className={`topbar-tab-btn ${activeTab === "bindings" ? "active" : ""}`}
              onClick={() => onSelectTab("bindings")}
            >
              Active Flow Bindings ({currentPipeline?.nodes.length ?? 0} Nodes)
            </button>
          </div>

          {selectedStage !== "all" && (
            <button
              type="button"
              className="stage-filter-reset-btn"
              onClick={() => onSelectStage("all")}
            >
              Show All Stages
            </button>
          )}
        </header>

        {/* Tree Canvas Viewport */}
        <div className="tree-canvas-viewport">
          <svg
            className="dendro-svg-clean"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Reduced, refined white luminous glow */}
              <filter id="whiteSubtleLightning" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#ffffff" floodOpacity="0.65" />
              </filter>
            </defs>

            {/* ── LAYER 1: BACKGROUND LINES ──────────────────────────────── */}
            <g className="svg-lines-layer">
              {/* Right Spine: Vertical Milestone Axis */}
              <line
                x1={spineX}
                y1={40}
                x2={spineX}
                y2={svgHeight - 40}
                className="spine-line-clean"
              />
              {gateMilestones.map((m, idx) => (
                <g key={idx} transform={`translate(${spineX}, ${m.y})`}>
                  <line x1={-6} y1={0} x2={6} y2={0} className="spine-tick-clean" />
                  <circle cx={0} cy={0} r={2} className="spine-dot-clean" />
                  <text x={14} y={3.5} className="spine-text-clean">
                    {m.label}
                  </text>
                </g>
              ))}

              {/* Root to Stage Strands */}
              {stages.map((stage) => {
                const sY = stagePositions[stage.id] ?? rootY;
                const isSelected = selectedStage === "all" || selectedStage === stage.id;
                const isDimmed = selectedStage !== "all" && selectedStage !== stage.id;
                const isHovered =
                  hoveredEntity?.type === "stage" && hoveredEntity.id === stage.id;

                return (
                  <path
                    key={`root-${stage.id}`}
                    d={makeBezier(rootX, rootY, stageX, sY)}
                    className={`strand-line root-line ${isSelected ? "active" : ""} ${
                      isDimmed ? "dimmed" : ""
                    } ${isHovered ? "hovered" : ""}`}
                    filter={isHovered || isSelected ? "url(#whiteSubtleLightning)" : undefined}
                  />
                );
              })}

              {/* Stage to Rule Strands (starts from stageOutX to NEVER cross stage labels) */}
              {rulePositions.map((rp) => {
                const isStageSelected =
                  selectedStage === "all" || selectedStage === rp.stage.id;
                const isRuleActive = activeRuleId === rp.rule.id;
                const isDimmed = !isStageSelected;
                const isHovered =
                  hoveredEntity?.type === "rule" && hoveredEntity.id === rp.rule.id;

                return (
                  <path
                    key={`stage-rule-${rp.rule.id}`}
                    d={makeBezier(stageOutX, rp.stageY, ruleX, rp.ruleY)}
                    className={`strand-line rule-line ${
                      rp.isEnabled ? "enabled" : "bypassed"
                    } ${isRuleActive ? "rule-active" : ""} ${
                      isDimmed ? "dimmed" : ""
                    } ${isHovered ? "hovered" : ""}`}
                    filter={isHovered || isRuleActive ? "url(#whiteSubtleLightning)" : undefined}
                  />
                );
              })}

              {/* Rule to Spine Guideline (starts after rule text) */}
              {rulePositions.map((rp) => {
                const isStageSelected =
                  selectedStage === "all" || selectedStage === rp.stage.id;
                const isDimmed = !isStageSelected;

                return (
                  <line
                    key={`guide-${rp.rule.id}`}
                    x1={ruleTextEndX}
                    y1={rp.ruleY}
                    x2={spineX - 10}
                    y2={rp.ruleY}
                    className={`spine-guide-line ${isDimmed ? "dimmed" : ""}`}
                  />
                );
              })}
            </g>

            {/* ── LAYER 2: FOREGROUND NODES & UN-OCCLUDED LABELS ────────── */}
            <g className="svg-nodes-layer">
              {/* Root Node */}
              <g
                className="dendro-node-clean root-disc"
                transform={`translate(${rootX}, ${rootY})`}
                onClick={() => onSelectStage("all")}
                onMouseEnter={() => setHoveredEntity({ type: "root", id: "root" })}
                onMouseLeave={() => setHoveredEntity(null)}
              >
                <circle cx={0} cy={0} r={26} className="root-circle" />
                <text x={0} y={-3} className="root-text-main" textAnchor="middle">
                  GOVERN
                </text>
                <text x={0} y={11} className="root-text-sub" textAnchor="middle">
                  ROOT
                </text>
              </g>

              {/* Stage Nodes and Labels */}
              {stages.map((stage, idx) => {
                const sY = stagePositions[stage.id] ?? rootY;
                const stageRules = visibleRules.filter((r) => r.stage === stage.id);
                const boundNodes = stageNodeMap[stage.id] ?? [];
                const isSelected = selectedStage === stage.id;
                const isDimmed = selectedStage !== "all" && !isSelected;
                const isHovered =
                  hoveredEntity?.type === "stage" && hoveredEntity.id === stage.id;

                return (
                  <g
                    key={stage.id}
                    role="button"
                    tabIndex={0}
                    aria-label={stage.label}
                    aria-pressed={isSelected}
                    className={`dendro-node-clean stage-node-clean ${
                      isSelected ? "selected" : ""
                    } ${isDimmed ? "dimmed" : ""} ${isHovered ? "hovered" : ""}`}
                    transform={`translate(${stageX}, ${sY})`}
                    onClick={() => onSelectStage(isSelected ? "all" : stage.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        onSelectStage(isSelected ? "all" : stage.id);
                      }
                    }}
                    onMouseEnter={() => setHoveredEntity({ type: "stage", id: stage.id })}
                    onMouseLeave={() => setHoveredEntity(null)}
                  >
                    <circle cx={0} cy={0} r={15} className="stage-circle" />
                    <text x={0} y={4} className="stage-order-num" textAnchor="middle">
                      {idx + 1}
                    </text>
                    <g transform="translate(22, 0)">
                      <text x={0} y={-3} className="stage-name-clean">
                        {stage.label}
                      </text>
                      <text x={0} y={12} className="stage-meta-clean">
                        {stageRules.length} rules
                        {boundNodes.length > 0 ? ` · ${boundNodes.length} bound` : ""}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Rule Nodes and Labels */}
              {rulePositions.map((rp) => {
                const isStageSelected =
                  selectedStage === "all" || selectedStage === rp.stage.id;
                const isRuleActive = activeRuleId === rp.rule.id;
                const isDimmed = !isStageSelected;
                const isHovered =
                  hoveredEntity?.type === "rule" && hoveredEntity.id === rp.rule.id;

                return (
                  <g
                    key={rp.rule.id}
                    role="button"
                    tabIndex={0}
                    aria-label={rp.rule.name}
                    aria-pressed={isRuleActive}
                    className={`dendro-node-clean rule-node-clean ${
                      isRuleActive ? "active" : ""
                    } ${isDimmed ? "dimmed" : ""} ${isHovered ? "hovered" : ""}`}
                    transform={`translate(${ruleX}, ${rp.ruleY})`}
                    onClick={() => {
                      setActiveRuleId(rp.rule.id);
                      if (activeTab !== "dendrogram") onSelectTab("dendrogram");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setActiveRuleId(rp.rule.id);
                        if (activeTab !== "dendrogram") onSelectTab("dendrogram");
                      }
                    }}
                    onMouseEnter={() => setHoveredEntity({ type: "rule", id: rp.rule.id })}
                    onMouseLeave={() => setHoveredEntity(null)}
                  >
                    <circle
                      cx={0}
                      cy={0}
                      r={isRuleActive ? 4.5 : 3.5}
                      className={`rule-dot-clean ${rp.isEnabled ? "active" : "disabled"}`}
                    />
                    <g transform="translate(14, 0)">
                      <text x={0} y={-3} className="rule-title-clean">
                        {rp.rule.name}
                      </text>
                      <text x={0} y={11} className="rule-sub-clean">
                        {(rp.rule.id.split("@")[0] ?? "").split(".").pop()}
                        {rp.boundNodes.length > 0
                          ? ` · 🔗 ${rp.boundNodes[0]?.operator}`
                          : ""}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* ── RIGHT: SINGLE METHODOLOGY DRAWER (Exact Layout From Reference Image) ── */}
      <aside className="methodology-drawer" aria-label="Methodology Inspector">
        {/* Drawer Header: # ID / Title + Close Button (Matches #012345/10 Order details) */}
        <div className="drawer-header">
          <div className="drawer-header-text">
            <h3 className="drawer-id-title">
              {activeTab === "config"
                ? "# Global Adaptive Policies"
                : activeTab === "bindings"
                  ? "# Active Flow Bindings"
                  : activeRule
                    ? `# ${activeRule.name}`
                    : activeStage
                      ? `# ${activeStage.label}`
                      : "# Methodology Overview"}
            </h3>
            <span className="drawer-subtitle">
              {activeTab === "config"
                ? "Scientific governance baseline applied across all pipeline stages"
                : activeTab === "bindings"
                  ? `${currentPipeline?.nodes.length ?? 0} active nodes bound to methodology rules`
                  : activeRule
                    ? `Stage: ${activeStage?.label ?? activeRule.stage} · ${activeRule.id}`
                    : "Scientific Governance & Topology"}
            </span>
          </div>
          <button
            type="button"
            className="drawer-close-btn"
            onClick={() => setActiveRuleId(null)}
            title="Clear selection"
          >
            ×
          </button>
        </div>

        {/* 3-Column Key-Value Status Strip (Matches Created at | Payment | Status) */}
        <div className="drawer-meta-grid">
          <div className="drawer-meta-col">
            <span className="drawer-meta-label">Gate B</span>
            <label className="drawer-gate-toggle">
              <input
                type="checkbox"
                checked={activeRule ? (ruleToggles[activeRule.id] ?? true) : true}
                onChange={() => activeRule && onToggleRule(activeRule.id)}
              />
              <span className="drawer-toggle-text">
                {activeRule && ruleToggles[activeRule.id] ? "Enforced" : "Bypassed"}
              </span>
            </label>
          </div>

          <div className="drawer-meta-col">
            <span className="drawer-meta-label">Pack</span>
            <span className="drawer-badge-green">
              {activeRule?.pack === "unsupervised" ? "Unsupervised" : "Supervised"}
            </span>
          </div>

          <div className="drawer-meta-col">
            <span className="drawer-meta-label">Status</span>
            <span className="drawer-badge-amber">
              {activeBoundNodes.length > 0
                ? `${activeBoundNodes.length} Bound`
                : "Active"}
            </span>
          </div>
        </div>

        {/* Scrollable Content Body (Direct layout, zero nested boxes) */}
        <div className="drawer-body-scroll">
          {/* TAB 1: METHODOLOGY MAP (RULE DOSSIER) */}
          {activeTab === "dendrogram" && (
            <>
              {activeRule ? (
                <>
                  {/* SECTION 1: SCIENTIFIC PURPOSE & DECISION (Matches Customer block) */}
                  <section className="drawer-section">
                    <header className="drawer-section-head">
                      <span className="drawer-section-title">Scientific Purpose & Decision</span>
                    </header>
                    <div className="drawer-gov-direct">
                      <strong className="drawer-gov-decides">Decides: {activeRule.decides}</strong>
                      <span className="drawer-gov-standard">{activeRule.provenance.standard}</span>
                      <p className="drawer-gov-pitfall">“{activeRule.provenance.pitfall}”</p>
                      <div className="drawer-gov-citation">
                        <strong>Citation:</strong> <em>{activeRule.provenance.citation}</em>
                      </div>
                    </div>
                  </section>

                  {/* SECTION 2: OBSERVABLE FACTS & VERIFICATION (Matches Timeline block layout) */}
                  <section className="drawer-section">
                    <header className="drawer-section-head">
                      <span className="drawer-section-title">Observable Facts & Verification</span>
                    </header>
                    <div className="drawer-facts-stack">
                      {activeRule.observes.map((obs) => (
                        <div key={obs.key} className="drawer-fact-row">
                          <div className="drawer-fact-left">
                            <span className="drawer-fact-icon">✓</span>
                            <div className="drawer-fact-text">
                              <strong className="drawer-fact-title">{obs.key}</strong>
                              <span className="drawer-fact-sub">{obs.description}</span>
                            </div>
                          </div>
                          <span className="drawer-fact-badge">Observed</span>
                        </div>
                      ))}

                      <div className="drawer-fact-row">
                        <div className="drawer-fact-left">
                          <span className="drawer-fact-icon gate">✓</span>
                          <div className="drawer-fact-text">
                            <strong className="drawer-fact-title">
                              Gate B: {activeRule.verificationCheck.checkRule}
                            </strong>
                            <span className="drawer-fact-sub">
                              {activeRule.verificationCheck.description}
                            </span>
                          </div>
                        </div>
                        <span className="drawer-fact-badge gate">Gate B</span>
                      </div>

                      {/* Bound Pipeline Step */}
                      {activeBoundNodes.length > 0 && (
                        <div className="drawer-bound-direct">
                          <span className="drawer-bound-eyebrow">Active Pipeline Binding</span>
                          {activeBoundNodes.map((b) => (
                            <div key={b.nodeId} className="drawer-bound-row">
                              <div>
                                <strong>{b.operator}</strong>
                                <code>{b.nodeId}</code>
                              </div>
                              <button
                                type="button"
                                className="stage-inspect-btn"
                                onClick={() => onInspectNode(b.nodeId)}
                              >
                                Inspect in Flow
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* SECTION 3: PROPOSAL ALTERNATIVES & PARAMETERS (Matches Items block) */}
                  <section className="drawer-section">
                    <header className="drawer-section-head">
                      <span className="drawer-section-title">Proposal Alternatives & Parameters</span>
                    </header>
                    <div className="drawer-items-list">
                      {activeRule.alternatives.map((alt, idx) => {
                        const gradients = [
                          "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
                          "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
                          "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
                          "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
                        ];
                        const grad = gradients[idx % gradients.length];

                        return (
                          <div key={alt.id} className="drawer-item-row">
                            <div className="drawer-item-thumb" style={{ background: grad }}>
                              <span className="thumb-index">{idx + 1}</span>
                            </div>
                            <div className="drawer-item-content">
                              <strong className="drawer-item-name">{alt.label}</strong>
                              <span className="drawer-item-details">
                                {alt.condition}
                              </span>
                              <p className="drawer-item-desc">{alt.description}</p>
                            </div>
                            <div className="drawer-item-meta">
                              <span className="drawer-item-qty">Rank {idx + 1}</span>
                              <span className="drawer-item-val">
                                {alt.operator ? "Executable" : "Adaptive"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Interactive Policy Threshold Sliders (Direct, unboxed) */}
                    {activeRule.policyThresholds && activeRule.policyThresholds.length > 0 && (
                      <div className="drawer-thresholds-wrap">
                        <span className="drawer-sub-heading">Policy Cutoff Thresholds</span>
                        {activeRule.policyThresholds.map((tc) => (
                          <label key={tc.key} className="drawer-slider-row">
                            <div className="field-top">
                              <span>{tc.label}</span>
                              <code>
                                {Number(thresholds[tc.key] ?? tc.value).toFixed(2)}
                                {tc.unit ? ` ${tc.unit}` : ""}
                              </code>
                            </div>
                            <input
                              type="range"
                              min={tc.min ?? 0}
                              max={tc.max ?? 1}
                              step={tc.step ?? 0.05}
                              value={Number(thresholds[tc.key] ?? tc.value)}
                              onChange={(e) =>
                                onUpdateThreshold(tc.key, parseFloat(e.target.value))
                              }
                            />
                            <small className="field-desc">{tc.description}</small>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="drawer-empty-state">
                  Select any rule in the decision tree to inspect its scientific governance dossier.
                </div>
              )}
            </>
          )}

          {/* TAB 2: ADAPTIVE POLICIES */}
          {activeTab === "config" && (
            <div className="drawer-config-panel">
              <h4 className="config-block-title">Global Adaptive Policy Thresholds</h4>

              <div className="drawer-section">
                <span className="drawer-section-title">Validation & Partitioning</span>

                <label className="drawer-slider-row">
                  <div className="field-top">
                    <span>Validation Split Fraction</span>
                    <code>{(Number(thresholds.default_test_fraction ?? 0.20) * 100).toFixed(0)}%</code>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.50"
                    step="0.05"
                    value={Number(thresholds.default_test_fraction ?? 0.20)}
                    onChange={(e) => onUpdateThreshold("default_test_fraction", parseFloat(e.target.value))}
                  />
                </label>

                <label className="drawer-slider-row">
                  <div className="field-top">
                    <span>Temporal Embargo Buffer</span>
                    <code>{Number(thresholds.embargo_days ?? 0)} days</code>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={Number(thresholds.embargo_days ?? 0)}
                    onChange={(e) => onUpdateThreshold("embargo_days", parseInt(e.target.value, 10))}
                  />
                </label>

                <div className="drawer-row-inline" style={{ marginTop: 8 }}>
                  <span className="row-label">Strict Holdout Isolation</span>
                  <label className="drawer-gate-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(thresholds.strict_holdout_isolation ?? true)}
                      onChange={(e) => onUpdateThreshold("strict_holdout_isolation", e.target.checked)}
                    />
                    <span className="drawer-toggle-text">
                      {thresholds.strict_holdout_isolation ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>
              </div>

              <div className="drawer-section">
                <span className="drawer-section-title">Data Cleaning & Missingness</span>

                <label className="drawer-slider-row">
                  <div className="field-top">
                    <span>Drop Column Missingness Threshold</span>
                    <code>{(Number(thresholds.drop_column_threshold ?? 0.60) * 100).toFixed(0)}%</code>
                  </div>
                  <input
                    type="range"
                    min="0.20"
                    max="0.90"
                    step="0.05"
                    value={Number(thresholds.drop_column_threshold ?? 0.60)}
                    onChange={(e) => onUpdateThreshold("drop_column_threshold", parseFloat(e.target.value))}
                  />
                </label>

                <label className="drawer-slider-row">
                  <div className="field-top">
                    <span>Missing Indicator Flag Trigger</span>
                    <code>{(Number(thresholds.indicator_flag_threshold ?? 0.15) * 100).toFixed(0)}%</code>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.40"
                    step="0.05"
                    value={Number(thresholds.indicator_flag_threshold ?? 0.15)}
                    onChange={(e) => onUpdateThreshold("indicator_flag_threshold", parseFloat(e.target.value))}
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB 3: ACTIVE FLOW BINDINGS */}
          {activeTab === "bindings" && (
            <div className="drawer-bindings-panel">
              <h4 className="config-block-title">Active Flow Node Methodology Bindings</h4>

              {!currentPipeline || currentPipeline.nodes.length === 0 ? (
                <div className="drawer-empty-state">No active pipeline nodes.</div>
              ) : (
                <div className="bindings-mini-list">
                  {currentPipeline.nodes.map((node) => {
                    const isSplit = node.operator.includes("split@");
                    const isClustering =
                      node.operator.includes("clustering.") ||
                      node.operator.includes("kmeans") ||
                      node.operator.includes("dbscan") ||
                      node.operator.includes("gmm");
                    const isMissing =
                      node.operator.includes("impute@") ||
                      node.operator.includes("drop_missing@");
                    const isScaling = node.operator.includes("scale@");
                    const isOutlier = node.operator.includes("clip_outliers@");

                    const matchedRuleId = isSplit
                      ? "methodology.supervised.data_split@1.0.0"
                      : isClustering
                        ? "methodology.unsupervised.clustering_algorithm@1.0.0"
                        : isMissing
                          ? "methodology.supervised.missingness@1.0.0"
                          : isScaling
                            ? "methodology.supervised.feature_scaling@1.0.0"
                            : isOutlier
                              ? "methodology.supervised.outlier_treatment@1.0.0"
                              : undefined;

                    const matchedRule = rules.find((r) => r.id === matchedRuleId);

                    return (
                      <div key={node.id} className="binding-item-direct">
                        <div className="binding-item-top">
                          <strong>{node.operator}</strong>
                          <button
                            type="button"
                            className="stage-inspect-btn"
                            onClick={() => onInspectNode(node.id)}
                          >
                            Inspect in Flow
                          </button>
                        </div>
                        <div className="binding-item-meta">
                          <code>{node.id}</code>
                          {matchedRule && (
                            <span className="stage-count">{matchedRule.name}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

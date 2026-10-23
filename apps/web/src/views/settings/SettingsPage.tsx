import { useState, useMemo } from "react";
import type { Operator } from "@sprisk/contracts";

import { useOperators, usePipelineVersions } from "../../api/hooks.ts";
import { useLoadedTables } from "../../api/datasets.ts";
import { useMethodologyRules } from "../../api/methodology.ts";
import { STAGES, stageOf, stepTitle, type Stage } from "../../flow/stages.ts";
import { SearchField } from "../../components/ui/SearchField.tsx";
import { Tag } from "../../components/ui/Tag.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { InfoDock } from "../../components/ui/InfoDock.tsx";
import { Chevron, KindIcon, PanelToggleIcon } from "../Icons.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { useWorkbench } from "../../workbench/workbench.ts";

const TABS = ["Installed", "Details", "Schema"] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("all-operators");
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>();
  const [activeTab, setActiveTab] = useState<Tab>("Installed");
  const { sidebarOpen, toggleSidebar } = useWorkbench();

  const operatorsQuery = useOperators();
  const pipelinesQuery = usePipelineVersions();
  const tablesQuery = useLoadedTables();
  const rulesQuery = useMethodologyRules();


  const operators = useMemo(() => operatorsQuery.data ?? [], [operatorsQuery.data]);
  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);

  // Group operators by stage
  const operatorsByStage = useMemo(() => {
    const map = new Map<Stage, Operator[]>();
    for (const stage of STAGES) {
      map.set(stage, []);
    }
    for (const op of operators) {
      const stage = stageOf(op);
      map.get(stage)?.push(op);
    }
    return map;
  }, [operators]);

  // Filtered operators for current search & selection
  const displayedOperators = useMemo(() => {
    let list = operators;
    if (selectedGroup !== "all-operators" && selectedGroup !== "system") {
      list = operatorsByStage.get(selectedGroup as Stage) ?? [];
    }
    if (!query.trim()) return list;
    const needle = query.trim().toLowerCase();
    return list.filter(
      (op) =>
        op.id.toLowerCase().includes(needle) ||
        stepTitle(op.id).toLowerCase().includes(needle) ||
        (op.description ?? "").toLowerCase().includes(needle),
    );
  }, [operators, selectedGroup, operatorsByStage, query]);

  const activeOp = useMemo(() => {
    if (selectedOperatorId) {
      return operators.find((o) => o.id === selectedOperatorId) ?? displayedOperators[0];
    }
    return displayedOperators[0];
  }, [selectedOperatorId, operators, displayedOperators]);

  if (operatorsQuery.isPending) {
    return <Loading text="Loading settings & operator registry…" pad />;
  }

  const isSystemView = selectedGroup === "system";

  return (
    <div className="set-page-layout">
      {/* 280px Settings Sidebar */}
      <aside className="main-sidebar set-sidebar" aria-label="Settings navigation">
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <h2 className="sidebar-title">Settings</h2>
          </div>
          <div className="sidebar-search">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search operators"
            />
          </div>
        </div>

        <div className="set-sidebar-list">
          {/* Section 01: Operator Registry */}
          <section className="set-group-section">
            <div className="set-group-header">
              <span className="set-group-num mono">01</span>
              <span className="set-group-name">Operators</span>
              <span className="set-group-count mono">{operators.length}</span>
              <span className="set-group-chevron open">
                <Chevron />
              </span>
            </div>

            <div className="set-group-items">
              <button
                type="button"
                className={`set-item ${selectedGroup === "all-operators" ? "selected" : ""}`}
                onClick={() => {
                  setSelectedGroup("all-operators");
                  setSelectedOperatorId(undefined);
                }}
              >
                <div className="set-item-title-row">
                  <span className="set-item-title">All operators</span>
                  <Tag tone="default">{operators.length}</Tag>
                </div>
                <span className="set-item-sub">Registered across all stages</span>
              </button>

              {STAGES.map((stage) => {
                const count = operatorsByStage.get(stage)?.length ?? 0;
                if (count === 0) return null;
                const isSelected = selectedGroup === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    className={`set-item ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedGroup(stage);
                      setSelectedOperatorId(undefined);
                    }}
                  >
                    <div className="set-item-title-row">
                      <span className="set-item-title">{stage}</span>
                      <span className="set-item-count mono">{count}</span>
                    </div>
                    <span className="set-item-sub">{stage} stage operators</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 02: System & Runtime */}
          <section className="set-group-section">
            <div className="set-group-header">
              <span className="set-group-num mono">02</span>
              <span className="set-group-name">System</span>
              <span className="set-group-count mono">Runtime</span>
              <span className="set-group-chevron open">
                <Chevron />
              </span>
            </div>

            <div className="set-group-items">
              <button
                type="button"
                className={`set-item ${selectedGroup === "system" ? "selected" : ""}`}
                onClick={() => setSelectedGroup("system")}
              >
                <div className="set-item-title-row">
                  <span className="set-item-title">Backend status</span>
                  <Tag tone="default">Live</Tag>
                </div>
                <span className="set-item-sub">Rust runtime & caches</span>
              </button>
            </div>
          </section>
        </div>

        <div className="set-sidebar-dock">
          <InfoDock
            title="System Info"
            rows={[
              { k: "Operators", v: String(operators.length) },
              { k: "Pipelines", v: String(pipelines.length) },
              { k: "Rules", v: String(rules.length) },
              { k: "Datasets", v: String(tablesQuery.data?.length ?? 0) },
            ]}
          />
        </div>
      </aside>

      {/* Main Settings Body */}
      <main className="center-screen set-main" aria-label="Settings configuration">
        {isSystemView ? (
          <div>
            <header className="set-head">
              <div className="set-head-meta">
                <span className="set-eyebrow">Platform · System Runtime</span>
                <h1 className="set-title">Backend Status & Storage</h1>
                <p className="set-subtitle">
                  Sprisk backend services, cached artifacts, and active contracts.
                </p>
              </div>
            </header>

            <div className="set-content">
              <section className="set-section">
                <div className="set-section-header">
                  <h2 className="set-section-title">Backend API</h2>
                  <span className="set-section-sub">Connected local service</span>
                </div>
                <div className="set-packs-list">
                  <div className="set-pack-row">
                    <div className="set-pack-info">
                      <div className="set-pack-title-line">
                        <strong className="set-pack-name">Sprisk HTTP API</strong>
                        <Tag tone="default">Connected</Tag>
                      </div>
                      <span className="set-pack-desc mono">Target: /api · OpenAPI schema v1</span>
                    </div>
                  </div>
                  <div className="set-pack-row">
                    <div className="set-pack-info">
                      <div className="set-pack-title-line">
                        <strong className="set-pack-name">Artifact Cache</strong>
                        <Tag tone="default">Ready</Tag>
                      </div>
                      <span className="set-pack-desc mono">
                        {tablesQuery.data?.length ?? 0} datasets cached · {pipelines.length} pipeline versions stored
                      </span>
                    </div>
                  </div>
                  <div className="set-pack-row">
                    <div className="set-pack-info">
                      <div className="set-pack-title-line">
                        <strong className="set-pack-name">Methodology Engine</strong>
                        <Tag tone="default">Active</Tag>
                      </div>
                      <span className="set-pack-desc mono">
                        {rules.length} methodology rules loaded and verified
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div>
            {/* Header */}
            <header className="set-head">
              <div className="set-head-meta">
                <span className="set-eyebrow">
                  Platform · {selectedGroup === "all-operators" ? "All stages" : `${selectedGroup} stage`}
                </span>
                <h1 className="set-title">
                  {selectedGroup === "all-operators" ? "Operator Registry" : `${selectedGroup} Operators`}
                </h1>
                <p className="set-subtitle">
                  Registered operators in the Sprisk backend runtime. Each operator executes in the Python worker.
                </p>
              </div>
              <div className="set-head-actions">
                <Button variant="secondary" size="sm" onClick={() => void operatorsQuery.refetch()}>
                  Reload registry
                </Button>
              </div>
            </header>

            {/* Subtabs */}
            <div className="set-subtabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t}
                  className={`set-tab-btn ${activeTab === t ? "active" : ""}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Main Content */}
            <div className="set-content">
              {activeTab === "Installed" ? (
                <section className="set-section">
                  <div className="set-section-header">
                    <h2 className="set-section-title">
                      {displayedOperators.length} {displayedOperators.length === 1 ? "operator" : "operators"} available
                    </h2>
                    <span className="set-section-sub">Select an operator to view parameters and ports</span>
                  </div>

                  <div className="set-packs-list">
                    {displayedOperators.map((op) => {
                      const isSelected = activeOp?.id === op.id;
                      const paramCount = Object.keys(op.params_schema?.properties ?? {}).length;
                      return (
                        <div
                          key={op.id}
                          className={`set-pack-row ${isSelected ? "selected" : ""}`}
                          style={{
                            cursor: "pointer",
                            background: isSelected ? "var(--alpha-04)" : undefined,
                            borderLeft: isSelected ? "2px solid var(--accent)" : undefined,
                          }}
                          onClick={() => setSelectedOperatorId(op.id)}
                        >
                          <div className="set-pack-info">
                            <div className="set-pack-title-line">
                              <strong className="set-pack-name">{stepTitle(op.id)}</strong>
                              <Tag tone="default">{op.capability_class}</Tag>
                              {op.fits_on_train && <Tag tone="default">Fits on train</Tag>}
                            </div>
                            <span className="set-pack-desc mono">{op.id}</span>
                            {op.description && (
                              <span style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)", marginTop: 4 }}>
                                {op.description}
                              </span>
                            )}
                          </div>
                          <div className="set-pack-action">
                            <span className="mono" style={{ fontSize: "var(--fs-11-5)", color: "var(--text-muted)" }}>
                              {op.inputs.length} in · {op.outputs.length} out · {paramCount} params
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : activeTab === "Details" && activeOp ? (
                <section className="set-detail-section">
                  <div className="set-section-header">
                    <h2 className="set-section-title">{stepTitle(activeOp.id)}</h2>
                    <span className="set-section-sub mono">{activeOp.id}</span>
                  </div>

                  <div className="set-features-grid">
                    <div className="set-feature-card">
                      <span className="set-feat-name">Capability & Stage</span>
                      <span className="set-feat-desc">
                        {activeOp.capability_class} · {stageOf(activeOp)} stage
                      </span>
                    </div>

                    <div className="set-feature-card">
                      <span className="set-feat-name">Entrypoint</span>
                      <span className="set-feat-desc mono">{activeOp.entrypoint}</span>
                    </div>

                    <div className="set-feature-card">
                      <span className="set-feat-name">Input Ports</span>
                      <span className="set-feat-desc">
                        {activeOp.inputs.length === 0
                          ? "None (Root operator)"
                          : activeOp.inputs.map((i) => `${i.name} (${i.kind}${i.optional ? ", optional" : ""})`).join(" · ")}
                      </span>
                    </div>

                    <div className="set-feature-card">
                      <span className="set-feat-name">Output Ports</span>
                      <span className="set-feat-desc">
                        {activeOp.outputs.length === 0
                          ? "None (Terminal sink)"
                          : activeOp.outputs.map((o) => `${o.name} (${o.kind})`).join(" · ")}
                      </span>
                    </div>

                    <div className="set-feature-card">
                      <span className="set-feat-name">Train / Test Isolation</span>
                      <span className="set-feat-desc">
                        {activeOp.fits_on_train
                          ? "Strict: fits only on train rows, keeps held-out rows unseen (ADR-0050)"
                          : "Standard execution"}
                      </span>
                    </div>

                    <div className="set-feature-card">
                      <span className="set-feat-name">Network & Sandbox</span>
                      <span className="set-feat-desc">
                        Network: {activeOp.network ?? "none"} · Effects: {activeOp.effects ?? "pure"}
                      </span>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="set-section">
                  <div className="set-section-header">
                    <h2 className="set-section-title">Parameters JSON Schema</h2>
                    <span className="set-section-sub mono">{activeOp?.id}</span>
                  </div>
                  <pre
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-panel)",
                      borderRadius: 4,
                      padding: 16,
                      fontSize: "var(--fs-12)",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                      overflow: "auto",
                      maxHeight: 480,
                    }}
                  >
                    {JSON.stringify(activeOp?.params_schema ?? {}, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

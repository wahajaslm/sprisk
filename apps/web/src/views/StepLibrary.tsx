import { useMemo, useState } from "react";
import type { Operator } from "@sprisk/contracts";

import { concernsByNode, useRunChecks } from "../api/checks.ts";
import { useOperators, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { latestByNode, statusOf } from "../flow/latest.ts";
import { kindOf, newestVersions, STAGES, stageOf, stepTitle, type Stage, type NodeKind } from "../flow/stages.ts";
import { flows } from "../flow/flows.ts";
import { useSelection } from "../workbench/selection.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { Chevron, KindIcon, PanelToggleIcon } from "./Icons.tsx";
import { SearchField } from "../components/ui/SearchField.tsx";
import { Segmented } from "../components/ui/Segmented.tsx";
import { Tag } from "../components/ui/Tag.tsx";
import { InfoDock } from "../components/ui/InfoDock.tsx";

type SidebarTab = "Pipeline" | "Operators";

export function StepLibrary() {
  const versionsQuery = usePipelineVersions();
  const operatorsQuery = useOperators();
  const { pipelineVersionId, runId, nodeId, selectNode } = useSelection();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const latest = useMemo(() => latestByNode(attempts.data ?? []), [attempts.data]);
  const concerns = concernsByNode(useRunChecks(attempts.data ?? []));
  const { sidebarOpen, toggleSidebar } = useWorkbench();

  const allVersions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const activeFlow = useMemo(() => {
    const list = flows(allVersions);
    if (!pipelineVersionId) return list[0];
    return list.find((f) => f.ids.includes(pipelineVersionId)) ?? list[0];
  }, [allVersions, pipelineVersionId]);

  const activeVersion = useMemo(() => {
    return (
      allVersions.find((v) => v.id === pipelineVersionId) ??
      activeFlow?.head ??
      allVersions[0]
    );
  }, [allVersions, pipelineVersionId, activeFlow]);

  const hasPipelineSelected = Boolean(pipelineVersionId && activeVersion?.nodes && activeVersion.nodes.length > 0);
  const [userTab, setUserTab] = useState<SidebarTab | undefined>(undefined);
  const tab: SidebarTab = userTab ?? (hasPipelineSelected ? "Pipeline" : "Operators");
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const operators = useMemo(() => operatorsQuery.data ?? [], [operatorsQuery.data]);
  const opMap = useMemo(() => new Map<string, Operator>(operators.map((o) => [o.id, o])), [operators]);

  const needle = query.trim().toLowerCase();

  const toggle = (stage: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(stage)) next.add(stage);
      return next;
    });

  // Pipeline steps grouped by stage
  const pipelineStages = useMemo(() => {
    const nodes = activeVersion?.nodes ?? [];
    return STAGES.map((stage, idx) => {
      const inStage = nodes
        .filter((node) => {
          const op = opMap.get(node.operator);
          const s = op ? stageOf(op) : "Clean";
          return s === stage;
        })
        .filter((node) => {
          if (!needle) return true;
          return (
            node.id.toLowerCase().includes(needle) ||
            stepTitle(node.operator).toLowerCase().includes(needle)
          );
        });

      return {
        stage,
        num: String(idx + 1).padStart(2, "0"),
        nodes: inStage,
      };
    }).filter((g) => g.nodes.length > 0 || !needle);
  }, [activeVersion, opMap, needle]);

  // Selected node info
  const selectedNode = activeVersion?.nodes.find((n) => n.id === nodeId);

  // The distinct steps that read any output of the selected step.
  const downstreamCount = useMemo(() => {
    if (!selectedNode || !activeVersion) return 0;
    const readers = activeVersion.edges.filter((e) => e.from.split(".")[0] === selectedNode.id).map((e) => e.to.split(".")[0]);
    return new Set(readers).size;
  }, [selectedNode, activeVersion]);

  if (!sidebarOpen) {
    return (
      <div className="sidebar-rail" aria-label="Pipeline rail">
        <button
          type="button"
          className="sidebar-toggle-btn"
          title="Expand Pipeline sidebar"
          aria-label="Expand Pipeline sidebar"
          onClick={toggleSidebar}
        >
          <PanelToggleIcon size={14} style={{ transform: "scaleX(-1)" }} />
        </button>
        <span
          className="sidebar-rail-label"
          role="button"
          tabIndex={0}
          onClick={toggleSidebar}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleSidebar();
          }}
        >
          Pipeline
        </span>
      </div>
    );
  }

  return (
    <div className="library">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h2 className="sidebar-title">Pipeline</h2>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="sidebar-toggle-btn"
            title="Collapse Pipeline sidebar"
            aria-label="Collapse Pipeline sidebar"
            onClick={toggleSidebar}
          >
            <PanelToggleIcon size={14} style={{ transform: "scaleX(-1)" }} />
          </button>
        </div>

        <Segmented<SidebarTab>
          value={tab}
          onChange={setUserTab}
          options={[
            { value: "Pipeline", label: "Pipeline" },
            { value: "Operators", label: "Operators" },
          ]}
        />
        <div className="sidebar-search">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search steps"
            ariaLabel="Search steps"
          />
        </div>
      </div>

      {/* List content */}
      <div className="sidebar-list">
        {tab === "Pipeline" ? (
          pipelineStages.length === 0 ? (
            <p className="muted pad" style={{ fontSize: "var(--fs-12)" }}>
              No pipeline steps found.
            </p>
          ) : (
            pipelineStages.map(({ stage, num, nodes }) => {
              const open = !folded.has(stage);
              return (
                <section key={stage} aria-label={stage} className="stage-group">
                  <h3 className="stage-heading">
                    <button type="button" aria-expanded={open} onClick={() => toggle(stage)}>
                      <span className="stage-chevron">
                        <Chevron />
                      </span>
                      <span className="mono" style={{ color: "var(--text-disabled)", fontSize: "11px" }}>
                        {num}
                      </span>
                      <span style={{ flex: 1 }}>{stage}</span>
                      <span className="mono" style={{ color: "var(--text-disabled)", fontSize: "11px" }}>
                        {nodes.length}
                      </span>
                    </button>
                  </h3>
                  {open &&
                    nodes.map((node) => {
                      const op = opMap.get(node.operator);
                      const kind: NodeKind = op ? kindOf(op) : "recipe";
                      const isSelected = node.id === nodeId;
                      const issues = concerns.get(node.id) ?? 0;
                      const attempt = latest.get(node.id);
                      return (
                        <div
                          key={node.id}
                          className={`step-item ${isSelected ? "selected" : ""}`}
                          onClick={() => selectNode(node.id)}
                          role="button"
                          tabIndex={0}
                          aria-current={isSelected ? "true" : undefined}
                        >
                          <span className={`step-icon kind-${kind}`}>
                            <KindIcon kind={kind} size={12} />
                          </span>
                          <span className="step-item-name">{stepTitle(node.operator)}</span>
                          <StepState issues={issues} state={attempt?.state} />
                        </div>
                      );
                    })}
                </section>
              );
            })
          )
        ) : (
          STAGES.map((stage) => {
            const inStage = newestVersions(operators).filter(
              (op) =>
                stageOf(op) === stage &&
                (needle === "" || `${op.id} ${stepTitle(op.id)}`.toLowerCase().includes(needle)),
            );
            if (inStage.length === 0) return null;
            const open = !folded.has(stage);
            return (
              <section key={stage} aria-label={stage} className="stage-group">
                <h3 className="stage-heading">
                  <button type="button" aria-expanded={open} onClick={() => toggle(stage)}>
                    <span className="stage-chevron">
                      <Chevron />
                    </span>
                    <span style={{ flex: 1 }}>{stage}</span>
                    <span className="mono" style={{ color: "var(--text-disabled)", fontSize: "11px" }}>
                      {inStage.length}
                    </span>
                  </button>
                </h3>
                {open &&
                  inStage.map((op) => (
                    <div
                      key={op.id}
                      className="step-item"
                      title={op.description ? `${op.description}\n${op.id}` : op.id}
                    >
                      <span className={`step-icon kind-${kindOf(op)}`}>
                        <KindIcon kind={kindOf(op)} size={12} />
                      </span>
                      <span className="step-item-name">{stepTitle(op.id)}</span>
                      <span className="step-item-meta">{op.capability_class}</span>
                    </div>
                  ))}
              </section>
            );
          })
        )}
      </div>

      {/* Info Dock */}
      <InfoDock
        title="Info"
        rows={[
          {
            k: "Type",
            v: selectedNode && opMap.get(selectedNode.operator) ? kindOf(opMap.get(selectedNode.operator)!) : "—",
          },
          {
            k: "Status",
            v: selectedNode ? statusText(latest.get(selectedNode.id)?.state) : "—",
          },
          {
            k: "Downstream",
            v: selectedNode ? `${downstreamCount} ${downstreamCount === 1 ? "step" : "steps"}` : "—",
          },
        ]}
      />
    </div>
  );
}

const statusText = (state: string | undefined) => (state ? statusOf(state).text : "Not run");

const TONE: Record<string, "ok" | "danger" | "queued"> = { done: "ok", bad: "danger", live: "queued", idle: "queued" };

/** A step's latest attempt in the selected run, or its check concerns when any did not pass. */
function StepState({ issues, state }: { issues: number; state: string | undefined }) {
  if (issues > 0) return <Tag tone="danger">{issues === 1 ? "1 check" : `${issues} checks`}</Tag>;
  if (!state) return <Tag tone="neutral">Not run</Tag>;
  return <Tag tone={TONE[statusOf(state).tone] ?? "queued"}>{statusOf(state).text}</Tag>;
}

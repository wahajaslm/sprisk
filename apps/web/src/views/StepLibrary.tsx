import type { Node, Operator } from "@sprisk/contracts";
import { useMemo, useState } from "react";

import { useOperators, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { useRunChecks } from "../api/checks.ts";
import { latestByNode } from "../flow/latest.ts";
import { kindOf, newestVersions, roleOf, STAGES, stageOf, stepLabel, stepTitle } from "../flow/stages.ts";
import { stepOf } from "../flow/ports.ts";
import { stagesOf } from "../notebook/stageNotebooks.ts";
import { Chevron, KindIcon } from "./Icons.tsx";
import { useSelection } from "../workbench/selection.ts";
import { Segmented } from "../components/ui/Segmented.tsx";
import { SearchField } from "../components/ui/SearchField.tsx";
import { Tag } from "../components/ui/Tag.tsx";
import { InfoDock } from "../components/ui/InfoDock.tsx";
import { concerns } from "./inspector/ChecksTab.tsx";

const TABS = ["Pipeline", "Operators", "Plugins"] as const;
type Tab = (typeof TABS)[number];

export function StepLibrary() {
  const [tab, setTab] = useState<Tab>("Pipeline");
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const { pipelineVersionId, runId, nodeId, selectNode } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const checks = useRunChecks(attempts.data ?? []);

  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const operatorsMap = useMemo(() => new Map((operators.data ?? []).map((o) => [o.id, o])), [operators.data]);
  const latest = useMemo(() => latestByNode(attempts.data ?? []), [attempts.data]);

  const toggle = (stage: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(stage)) next.add(stage);
      return next;
    });

  const needle = query.trim().toLowerCase();

  // Downstream nodes count for selected node
  const downstreamCount = useMemo(() => {
    if (!nodeId || !pipeline) return 0;
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of pipeline.edges) {
        if (stepOf(e.from) === cur) {
          const target = stepOf(e.to);
          if (!visited.has(target)) {
            visited.add(target);
            queue.push(target);
          }
        }
      }
    }
    return visited.size;
  }, [nodeId, pipeline]);

  // Selected node details
  const selectedNode = pipeline?.nodes.find((n) => n.id === nodeId);
  const selectedOp = selectedNode ? operatorsMap.get(selectedNode.operator) : undefined;
  const selectedConcerns = nodeId ? concerns(checks, nodeId) : 0;
  const selectedState = nodeId ? latest.get(nodeId)?.state : undefined;

  const nodeStatus =
    selectedConcerns > 0 || selectedState === "failed"
      ? "Issue"
      : selectedState === "running"
        ? "Running"
        : selectedState === "queued"
          ? "Queued"
          : selectedState === "succeeded"
            ? "Up to date"
            : "Not run";

  // Group current pipeline nodes by stage
  const pipelineStages = useMemo(() => {
    if (!pipeline) return [];
    const placed = stagesOf(pipeline, operatorsMap);
    const groups: { stage: string; nodes: Node[] }[] = [];
    for (const stage of STAGES) {
      const nodesInStage = pipeline.nodes.filter((n) => placed.get(n.id) === stage);
      if (nodesInStage.length > 0) {
        groups.push({ stage, nodes: nodesInStage });
      }
    }
    // Also include any nodes placed in custom stages if any
    return groups;
  }, [pipeline, operatorsMap]);

  return (
    <div className="flow-sidebar">
      <div className="flow-sidebar-head">
        <h2 className="flow-sidebar-title">Pipeline</h2>
        <Segmented<Tab>
          options={TABS.map((t) => ({ value: t, label: t }))}
          value={tab}
          onChange={(v) => setTab(v)}
        />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search steps"
        />
      </div>

      <div className="flow-sidebar-body">
        {tab === "Pipeline" ? (
          pipelineStages.length === 0 ? (
            <p className="flow-sidebar-empty">No pipeline loaded.</p>
          ) : (
            pipelineStages.map(({ stage, nodes }, idx) => {
              const stageIdx = String(idx + 1).padStart(2, "0");
              const open = !folded.has(stage);
              const filteredNodes = nodes.filter((n) => {
                if (!needle) return true;
                const { title, subject } = stepLabel(n);
                return `${title} ${subject} ${n.id}`.toLowerCase().includes(needle);
              });
              if (needle && filteredNodes.length === 0) return null;

              const completed = nodes.filter((n) => latest.get(n.id)?.state === "succeeded").length;

              return (
                <section key={stage} className="flow-stage-section" aria-label={stage}>
                  <button
                    type="button"
                    className="flow-stage-head-btn"
                    aria-expanded={open}
                    onClick={() => toggle(stage)}
                  >
                    <span className="flow-stage-num">{stageIdx}</span>
                    <span className="flow-stage-name">{stage}</span>
                    <span className="flow-stage-count">{completed} / {nodes.length}</span>
                    <span className={`flow-stage-chevron ${open ? "open" : ""}`}>
                      <Chevron />
                    </span>
                  </button>

                  {open && (
                    <div className="flow-stage-step-list">
                      {filteredNodes.map((node) => {
                        const { title } = stepLabel(node);
                        const op = operatorsMap.get(node.operator);
                        const kind = op ? kindOf(op) : "recipe";
                        const stepConcerns = concerns(checks, node.id);
                        const state = latest.get(node.id)?.state;
                        const isIssue = stepConcerns > 0 || state === "failed";
                        const isQueued = state === "queued";
                        const isSelected = node.id === nodeId;

                        return (
                          <button
                            key={node.id}
                            type="button"
                            className={`flow-step-row ${isSelected ? "selected" : ""}`}
                            onClick={() => selectNode(node.id)}
                          >
                            <span className="flow-step-disc">
                              <KindIcon kind={kind} size={12} />
                            </span>
                            <span className="flow-step-name">{title}</span>
                            {isIssue ? (
                              <Tag tone="danger">Issue</Tag>
                            ) : isQueued ? (
                              <Tag tone="queued">Queued</Tag>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )
        ) : tab === "Operators" ? (
          STAGES.map((stage) => {
            const inStage = newestVersions(operators.data ?? []).filter(
              (op) => stageOf(op) === stage && (needle === "" || `${op.id} ${stepTitle(op.id)}`.toLowerCase().includes(needle)),
            );
            if (inStage.length === 0) return null;
            const open = !folded.has(stage);
            return (
              <section key={stage} aria-label={stage} className="flow-stage-section">
                <button
                  type="button"
                  className="flow-stage-head-btn"
                  aria-expanded={open}
                  onClick={() => toggle(stage)}
                >
                  <span className="flow-stage-name">{stage}</span>
                  <span className="flow-stage-count">{inStage.length}</span>
                  <span className={`flow-stage-chevron ${open ? "open" : ""}`}>
                    <Chevron />
                  </span>
                </button>
                {open && (
                  <div className="flow-stage-step-list">
                    {inStage.map((op) => (
                      <div key={op.id} className="flow-step-row static" title={op.description ?? op.id}>
                        <span className="flow-step-disc">
                          <KindIcon kind={kindOf(op)} size={12} />
                        </span>
                        <span className="flow-step-name">{stepTitle(op.id)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })
        ) : (
          <div className="flow-plugins-list">
            <div className="plugin-item">
              <span className="plugin-name">Tabular core</span>
              <span className="plugin-sub">Built in · tables, joins, AutoML</span>
            </div>
            <div className="plugin-item">
              <span className="plugin-name">Audio pack</span>
              <span className="plugin-sub">v1.2 · 6 steps · 3 rules</span>
            </div>
            <div className="plugin-item">
              <span className="plugin-name">Edge and embedded</span>
              <span className="plugin-sub">v0.9 · 4 steps · 2 rules</span>
            </div>
          </div>
        )}
      </div>

      <div className="flow-sidebar-dock">
        <InfoDock
          title="Info"
          rows={
            selectedNode
              ? [
                  { k: "Type", v: selectedOp ? roleOf(selectedOp) : "Step" },
                  { k: "Status", v: nodeStatus, warn: nodeStatus === "Issue" },
                  { k: "Downstream", v: `${downstreamCount} steps` },
                ]
              : [
                  { k: "Flow", v: pipeline ? pipeline.id.slice(0, 16) : "None" },
                  { k: "Steps", v: `${pipeline?.nodes.length ?? 0} steps` },
                  { k: "Stages", v: `${pipelineStages.length} stages` },
                ]
          }
        />
      </div>
    </div>
  );
}

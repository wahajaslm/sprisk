import { useMemo, useState } from "react";
import type { Node, Operator } from "@sprisk/contracts";

import { checkCount, concernsByNode, useRunChecks } from "../api/checks.ts";
import { useOperators, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { latestByNode, statusOf } from "../flow/latest.ts";
import { stepOf } from "../flow/ports.ts";
import { kindOf, newestVersions, STAGES, stageOf, stepOrigin, stepTitle, type Stage, type NodeKind } from "../flow/stages.ts";
import { flows } from "../flow/flows.ts";
import { useSelection } from "../workbench/selection.ts";
import { KindIcon } from "./Icons.tsx";
import { SearchField } from "../components/ui/SearchField.tsx";
import { Segmented } from "../components/ui/Segmented.tsx";
import { ListRow } from "../components/ui/ListRow.tsx";
import { SideGroup } from "../components/ui/SideGroup.tsx";
import { Sidebar } from "../components/ui/Sidebar.tsx";
import { pluginOf, plugins } from "../flow/plugins.ts";
import { InfoDock } from "../components/ui/InfoDock.tsx";

type SidebarTab = "Pipeline" | "Operators" | "Plugins";

export function StepLibrary() {
  const versionsQuery = usePipelineVersions();
  const operatorsQuery = useOperators();
  const { pipelineVersionId, runId, nodeId, selectNode } = useSelection();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const latest = useMemo(() => latestByNode(attempts.data ?? []), [attempts.data]);
  const checks = useRunChecks(attempts.data ?? []);
  const concerns = concernsByNode(checks);

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

  const operators = useMemo(() => operatorsQuery.data ?? [], [operatorsQuery.data]);
  const opMap = useMemo(() => new Map<string, Operator>(operators.map((o) => [o.id, o])), [operators]);

  const needle = query.trim().toLowerCase();

  // Pipeline steps grouped by stage
  const pipelineStages = useMemo(() => {
    const nodes = activeVersion?.nodes ?? [];
    return STAGES.map((stage) => {
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
        nodes: inStage,
      };
    }).filter((g) => g.nodes.length > 0);
  }, [activeVersion, opMap, needle]);

  // Selected node info
  const selectedNode = activeVersion?.nodes.find((n) => n.id === nodeId);

  // The distinct steps that read any output of the selected step.
  const downstreamCount = useMemo(() => {
    if (!selectedNode || !activeVersion) return 0;
    const readers = activeVersion.edges.filter((e) => stepOf(e.from) === selectedNode.id).map((e) => stepOf(e.to));
    return new Set(readers).size;
  }, [selectedNode, activeVersion]);

  return (
    <Sidebar
      title="Pipeline"
      modes={
        <Segmented<SidebarTab>
          value={tab}
          onChange={setUserTab}
          options={[
            { value: "Pipeline", label: "Pipeline" },
            { value: "Operators", label: "Operators" },
            { value: "Plugins", label: "Plugins" },
          ]}
        />
      }
      search={<SearchField value={query} onChange={setQuery} placeholder="Search steps" ariaLabel="Search steps" />}
      dock={
        <InfoDock
          rows={[
            { k: "Type", v: selectedNode ? typeOf(selectedNode, opMap.get(selectedNode.operator)) : "—" },
            { k: "Status", v: selectedNode ? statusText(latest.get(selectedNode.id)?.state) : "—" },
            { k: "Downstream", v: selectedNode ? `${downstreamCount} ${downstreamCount === 1 ? "step" : "steps"}` : "—" },
          ]}
        />
      }
    >
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {checks.status === "error" && <p role="alert" className="error pad">{checks.message}</p>}
      {tab === "Pipeline" &&
        (pipelineStages.length === 0 ? (
          <p className="muted pad">No pipeline steps found.</p>
        ) : (
          pipelineStages.map(({ stage, nodes }, i) => (
            <SideGroup key={stage} num={i + 1} label={stage} meta={`${nodes.filter((n) => isDone(latest.get(n.id)?.state)).length} / ${nodes.length}`}>
              {nodes.map((node) => {
                const op = opMap.get(node.operator);
                const kind: NodeKind = op ? kindOf(op) : "recipe";
                return (
                  <ListRow
                    key={node.id}
                    title={stepTitle(node.operator)}
                    icon={<KindIcon kind={kind} size={12} />}
                    selected={node.id === nodeId}
                    onClick={() => selectNode(node.id)}
                    {...badgeOf(concerns.get(node.id) ?? 0, latest.get(node.id)?.state)}
                  />
                );
              })}
            </SideGroup>
          ))
        ))}
      {tab === "Operators" &&
        STAGES.map((stage) => newestVersions(operators).filter((op) => stageOf(op) === stage && (needle === "" || `${op.id} ${stepTitle(op.id)}`.toLowerCase().includes(needle))))
          .map((inStage, i) => ({ stage: STAGES[i]!, inStage }))
          .filter(({ inStage }) => inStage.length > 0)
          .map(({ stage, inStage }, i) => (
            <SideGroup key={stage} num={i + 1} label={stage} meta={inStage.length}>
              {inStage.map((op) => (
                <ListRow key={op.id} title={stepTitle(op.id)} meta={op.capability_class} icon={<KindIcon kind={kindOf(op)} size={12} />} hint={op.description ? `${op.description}\n${op.id}` : op.id} />
              ))}
            </SideGroup>
          ))}
      {tab === "Plugins" &&
        plugins(operators)
          .filter((name) => needle === "" || name.includes(needle))
          .map((name) => <ListRow key={name} title={name} meta={`${operators.filter((op) => pluginOf(op) === name).length} operators`} />)}
    </Sidebar>
  );
}

/** A badge only where the design shows one: a step that needs a look, or one still to run. */
function badgeOf(issues: number, state: string | undefined): { badge?: string; warn?: boolean } {
  if (issues > 0) return { badge: checkCount(issues), warn: true };
  if (state === "failed" || state === "timed_out") return { badge: "Issue", warn: true };
  if (state === "running" || state === "leased" || state === "uploading") return { badge: "Running" };
  if (state === "queued" || state === "created" || state === "validated") return { badge: "Queued" };
  return {};
}

const isDone = (state: string | undefined) => state === "succeeded" || state === "cache_hit";

const statusText = (state: string | undefined) => (state ? statusOf(state).text : "Not run");

/** A step's type in the Info panel: what a method made of it, else its kind (ADR-0063). */
function typeOf(node: Node, operator: Operator | undefined): string {
  const origin = stepOrigin(node, operator);
  if (origin === "decided") return "Decision";
  if (origin === "measures") return "Evidence";
  const kind = operator ? kindOf(operator) : "recipe";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

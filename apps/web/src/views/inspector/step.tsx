import type { ReactNode } from "react";

import { useRunChecks } from "../../api/checks.ts";
import { useCodeDisplay, useCodeInterface } from "../../api/code.ts";
import { useNodeHistory } from "../../api/history.ts";
import { useOperators, usePipelineVersions, useRunAttempts, useSaveAndRun } from "../../api/hooks.ts";
import { addCodeStep, isCodeOperator } from "../../flow/edit.ts";
import { GATE_NODE, hasOutputs, latestByNode } from "../../flow/latest.ts";
import { shortName } from "../../flow/stages.ts";
import { useInspectorDetail } from "../../workbench/detail.ts";
import { useViewInstance, useViewSelection } from "../../workbench/instance.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { CodeEditor } from "../CodeEditor.tsx";
import { PinIcon } from "../Icons.tsx";
import { ChecksTab, concerns } from "./ChecksTab.tsx";
import { CodeData } from "./CodeData.tsx";
import { ConsoleTab, consoleProblems } from "./ConsoleTab.tsx";
import { DataTab } from "./DataTab.tsx";
import { HistoryTab } from "./HistoryTab.tsx";
import { InputsTab } from "./InputsTab.tsx";
import { OperatorCode } from "./OperatorCode.tsx";
import { ParametersTab } from "./ParametersTab.tsx";
import { type InspectorTab, TAB_LABEL } from "../../workbench/inspectorTabs.ts";
import { ShownTables, shownTableCount, VisualsTab, visualCount } from "./VisualsTab.tsx";

const HEADLINE = ["accuracy", "r2", "rmse", "mae"];

/** Everything the Inspector tabs show about the step this panel follows or is pinned to. */
export function useStep() {
  const { pipelineVersionId, runId, nodeId } = useViewSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const node = pipeline?.nodes.find((n) => n.id === nodeId);
  const operator = operators.data?.find((o) => o.id === node?.operator);
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);
  const all = attempts.data ?? [];
  const checks = useRunChecks(latestByNode(all).get(GATE_NODE));
  const history = useNodeHistory(pipelineVersionId, nodeId ?? "");
  const mine = all.filter((a) => a.node_id === nodeId).sort((a, b) => a.number - b.number);
  const latest = latestByNode(mine).get(nodeId ?? "");
  const done = hasOutputs(latest) ? latest : undefined;
  const isCode = isCodeOperator(node?.operator);
  const display = useCodeDisplay(isCode ? done : undefined);
  const found = useCodeInterface(isCode ? done : undefined);
  const shownAt = history.findIndex((h) => h.run.id === runId);
  const explore =
    pipeline && nodeId && !saveAndRun.isPending
      ? (port: string) => {
          const { version, nodeId: codeNode } = addCodeStep(pipeline, nodeId, port);
          saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, codeNode) });
        }
      : undefined;
  return {
    runId,
    nodeId,
    versions,
    attempts,
    pipeline,
    node,
    operator,
    saveAndRun,
    all,
    checks,
    history,
    mine,
    latest,
    done,
    isCode,
    display,
    found,
    explore,
    previous: shownAt >= 0 ? history.slice(shownAt + 1).find((h) => h.metrics)?.metrics : undefined,
    metric: HEADLINE.find((m) => history.some((h) => h.metrics?.[m] !== undefined)),
    concernCount: nodeId ? concerns(checks, nodeId) : 0,
    visuals: visualCount(display),
    problems: consoleProblems(display, mine),
  };
}

export type Step = ReturnType<typeof useStep>;

/** The step's name, kind and state, plus the run when the panel is pinned. */
export function StepMeta({ step }: { step: Step }) {
  const { pin } = useViewInstance();
  const { node, nodeId, attempts, runId, latest } = step;
  return (
    <>
      <span className="sel-label">{nodeId}</span>
      <span className="sel-meta">
        {node ? shortName(node.operator) : ""} · {attempts.isPending && runId ? "loading" : (latest?.state.replace("_", " ") ?? "not run")}
        {pin ? ` · run ${pin.runId.slice(-8)}` : ""}
      </span>
    </>
  );
}

export function PinButton({ step }: { step: Step }) {
  const { pin, setPin } = useViewInstance();
  const { runId, nodeId } = step;
  if (!setPin || !runId) return null;
  return (
    <button
      type="button"
      className={`pin${pin ? " on" : ""}`}
      aria-pressed={pin !== undefined}
      title={pin ? "Unpin: follow the selection again" : "Pin this panel to this run and step"}
      onClick={() => setPin(pin ? undefined : { runId, nodeId })}
    >
      <PinIcon />
      {pin ? "Pinned" : "Pin"}
    </button>
  );
}

/** The active step tab's controls, shown at the right of the dock tab bar. */
export function StepToolbar() {
  const step = useStep();
  if (!step.nodeId) return null;
  return (
    <div className="step-toolbar">
      <StepMeta step={step} />
      <TechSwitch />
      <PinButton step={step} />
    </div>
  );
}

export function TechSwitch() {
  const { technical, setTechnical } = useInspectorDetail();
  return (
    <label className="tech-switch">
      <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
      Technical
    </label>
  );
}

export function StepErrors({ step }: { step: Step }) {
  return (
    <>
      {step.attempts.isError && <p role="alert" className="error pad">{step.attempts.error.message}</p>}
      {step.versions.isError && <p role="alert" className="error pad">{step.versions.error.message}</p>}
    </>
  );
}

/** What one tab shows for the step; the same body in the Inspector and in its own panel. */
export function TabBody({ tab, step }: { tab: InspectorTab; step: Step }): ReactNode {
  const { technical } = useInspectorDetail();
  const { pipeline, node, nodeId, operator, done, isCode, display, found } = step;
  if (!nodeId) return null;
  switch (tab) {
    case "data":
      return (
        <>
          {step.saveAndRun.isError && <p role="alert" className="error">{step.saveAndRun.error.message}</p>}
          <DataTab attempt={done} operator={node?.operator} capability={operator?.capability_class} previous={step.previous} explore={step.explore} shownTables={shownTableCount(display)}>
            <ShownTables display={display} />
            {isCode && pipeline && node && <CodeData pipeline={pipeline} nodeId={nodeId} params={node.params} found={found} />}
          </DataTab>
        </>
      );
    case "visuals":
      return <VisualsTab display={display} isCode={isCode} />;
    case "console":
      return <ConsoleTab display={display} attempts={step.mine} isCode={isCode} />;
    case "inputs":
      return pipeline && <InputsTab pipeline={pipeline} nodeId={nodeId} attempts={step.all} found={found} />;
    case "parameters":
      return pipeline && <ParametersTab pipeline={pipeline} nodeId={nodeId} operator={operator} found={found} />;
    case "code":
      return pipeline && node && isCode && typeof node.params.source === "string" ? (
        <CodeEditor key={`${pipeline.id}/${node.id}`} pipeline={pipeline} nodeId={node.id} source={node.params.source} />
      ) : (
        node && <OperatorCode operatorRef={node.operator} />
      );
    case "checks":
      return <ChecksTab run={step.checks} nodeId={nodeId} />;
    case "performance":
      return (
        <p className="muted">
          Duration, peak memory and CPU time per run come next: the worker will measure them. Until then, History shows when each run
          started.
        </p>
      );
    case "history":
      return <HistoryTab history={step.history} runId={step.runId} metric={step.metric} />;
  }
}

type TabMark = { badge?: string; alert?: boolean; muted?: boolean };

/** What a tab's label signals before it is opened: counts, problems, or nothing to show. */
function tabMark(tab: InspectorTab, step: Step): TabMark {
  const { visuals, problems, concernCount } = step;
  switch (tab) {
    case "visuals":
      return visuals > 0 ? { badge: String(visuals) } : { muted: true };
    case "console":
      return problems > 0 ? { badge: `⚠ ${problems}`, alert: true } : {};
    case "checks":
      return concernCount > 0 ? { badge: `⚠ ${concernCount}`, alert: true } : {};
    case "performance":
      return { muted: true };
    default:
      return {};
  }
}

/** A tab's dock label with its badge, e.g. "Checks ⚠ 2". */
export function StepTabLabel() {
  const { tab } = useViewInstance();
  const step = useStep();
  if (!tab) return <span>Unknown tab</span>;
  const mark = step.nodeId ? tabMark(tab, step) : {};
  return (
    <span
      className={`step-tab-label${mark.muted ? " muted-tab" : ""}`}
      aria-label={tab === "checks" && step.concernCount > 0 ? `Checks, ${step.concernCount} to review` : undefined}
    >
      {TAB_LABEL[tab]}
      {mark.badge && (
        <>
          {" "}
          <span className={`tab-badge${mark.alert ? " alert" : ""}`}>{mark.badge}</span>
        </>
      )}
    </span>
  );
}

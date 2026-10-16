import * as Tabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { useRunChecks } from "../api/checks.ts";
import { useCodeDisplay, useCodeInterface } from "../api/code.ts";
import { useNodeHistory } from "../api/history.ts";
import { useOperators, usePipelineVersions, useRunAttempts, useSaveAndRun } from "../api/hooks.ts";
import { addCodeStep, isCodeOperator } from "../flow/edit.ts";
import { GATE_NODE, hasOutputs, latestByNode } from "../flow/latest.ts";
import { shortName } from "../flow/stages.ts";
import { useInspectorDetail } from "../workbench/detail.ts";
import { useViewInstance, useViewSelection } from "../workbench/instance.tsx";
import { useSelection } from "../workbench/selection.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { PinIcon } from "./Icons.tsx";
import { ChecksTab, concerns } from "./inspector/ChecksTab.tsx";
import { CodeData } from "./inspector/CodeData.tsx";
import { ConsoleTab, consoleProblems } from "./inspector/ConsoleTab.tsx";
import { DataTab } from "./inspector/DataTab.tsx";
import { HistoryTab } from "./inspector/HistoryTab.tsx";
import { InputsTab } from "./inspector/InputsTab.tsx";
import { ParametersTab } from "./inspector/ParametersTab.tsx";
import { VisualsTab, visualCount } from "./inspector/VisualsTab.tsx";

const HEADLINE = ["accuracy", "r2", "rmse", "mae"];

type TabSpec = { value: string; label: string; badge?: string; alert?: boolean; muted?: boolean };

/** Everything about one step, one question per tab: what it produced (Data, Visualizations),
 * what happened (Console, Performance), what went in (Inputs, Parameters, Code), whether to
 * trust it (Checks) and how it changed (History). */
export function Inspector() {
  const { pipelineVersionId, runId, nodeId } = useViewSelection();
  const { pin, setPin } = useViewInstance();
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
  const { technical, setTechnical } = useInspectorDetail();

  if (!nodeId) return <p className="muted pad">Select a step to see its data, figures, console, inputs, settings, code, checks and history.</p>;
  const shownAt = history.findIndex((h) => h.run.id === runId);
  const previous = shownAt >= 0 ? history.slice(shownAt + 1).find((h) => h.metrics)?.metrics : undefined;
  const metric = HEADLINE.find((m) => history.some((h) => h.metrics?.[m] !== undefined));
  const concernCount = concerns(checks, nodeId);
  const visuals = visualCount(display);
  const problems = consoleProblems(display, mine);
  const explore =
    pipeline && !saveAndRun.isPending
      ? (port: string) => {
          const { version, nodeId: codeNode } = addCodeStep(pipeline, nodeId, port);
          saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, codeNode) });
        }
      : undefined;

  const tabs: TabSpec[] = [
    { value: "data", label: "Data" },
    { value: "visuals", label: "Visualizations", ...(visuals > 0 ? { badge: String(visuals) } : { muted: true }) },
    { value: "console", label: "Console", ...(problems > 0 ? { badge: `⚠ ${problems}`, alert: true } : {}) },
    { value: "inputs", label: "Inputs" },
    { value: "parameters", label: "Parameters" },
    { value: "code", label: "Code" },
    { value: "checks", label: "Checks", ...(concernCount > 0 ? { badge: `⚠ ${concernCount}`, alert: true } : {}) },
    { value: "performance", label: "Performance", muted: true },
    { value: "history", label: "History" },
  ];

  return (
    <Tabs.Root className="inspector" defaultValue="data">
      <div className="panel-head">
        <Tabs.List className="tabs" aria-label="Inspector">
          {tabs.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className={t.muted ? "muted-tab" : undefined}
              aria-label={t.value === "checks" && concernCount > 0 ? `Checks, ${concernCount} to review` : undefined}
            >
              {t.label}
              {t.badge && (
                <>
                  {" "}
                  <span className={`tab-badge${t.alert ? " alert" : ""}`}>{t.badge}</span>
                </>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <span className="sel-label">{nodeId}</span>
        <span className="sel-meta">
          {node ? shortName(node.operator) : ""} · {attempts.isPending && runId ? "loading" : (latest?.state.replace("_", " ") ?? "not run")}
          {pin ? ` · run ${pin.runId.slice(-8)}` : ""}
        </span>
        <span className="spacer" />
        <label className="tech-switch">
          <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
          Technical details
        </label>
        {setPin && runId && (
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
        )}
      </div>
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {versions.isError && <p role="alert" className="error pad">{versions.error.message}</p>}
      <Pane value="data">
        {saveAndRun.isError && <p role="alert" className="error">{saveAndRun.error.message}</p>}
        <DataTab attempt={done} operator={node?.operator} capability={operator?.capability_class} previous={previous} explore={explore}>
          {isCode && pipeline && node && <CodeData pipeline={pipeline} nodeId={nodeId} params={node.params} found={found} />}
        </DataTab>
      </Pane>
      <Pane value="visuals">
        <VisualsTab display={display} isCode={isCode} />
      </Pane>
      <Pane value="console">
        <ConsoleTab display={display} attempts={mine} isCode={isCode} />
      </Pane>
      <Pane value="inputs">{pipeline && <InputsTab pipeline={pipeline} nodeId={nodeId} attempts={all} found={found} />}</Pane>
      <Pane value="parameters">{pipeline && <ParametersTab pipeline={pipeline} nodeId={nodeId} operator={operator} found={found} />}</Pane>
      <Pane value="code">
        {pipeline && node && isCode && typeof node.params.source === "string" ? (
          <CodeEditor key={`${pipeline.id}/${node.id}`} pipeline={pipeline} nodeId={node.id} source={node.params.source} />
        ) : (
          <div className="builtin">
            <p className="output-title">Built-in step · {node ? shortName(node.operator) : "unknown"}</p>
            {operator?.description && <p className="muted">{operator.description}</p>}
            <p className="muted">Its code ships with sprisk and is read-only. Change how it runs in Parameters.</p>
            {technical && <p className="tech">{node?.operator}</p>}
          </div>
        )}
      </Pane>
      <Pane value="checks">
        <ChecksTab run={checks} nodeId={nodeId} />
      </Pane>
      <Pane value="performance">
        <p className="muted">
          Duration, peak memory and CPU time per run come next: the worker will measure them. Until then, History shows when each run
          started.
        </p>
      </Pane>
      <Pane value="history">
        <HistoryTab history={history} runId={runId} metric={metric} />
      </Pane>
    </Tabs.Root>
  );
}

function Pane({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Tabs.Content value={value} className="pane single">
      {children}
    </Tabs.Content>
  );
}

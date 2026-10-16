import * as Tabs from "@radix-ui/react-tabs";

import { useRunChecks } from "../api/checks.ts";
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
import { HistoryTab } from "./inspector/HistoryTab.tsx";
import { InputsTab } from "./inspector/InputsTab.tsx";
import { ResultTab } from "./inspector/ResultTab.tsx";

const HEADLINE = ["accuracy", "r2", "rmse", "mae"];

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
  const { technical, setTechnical } = useInspectorDetail();

  if (!nodeId) return <p className="muted pad">Select a step to see its result, inputs, code, checks and history.</p>;
  const latest = latestByNode(all.filter((a) => a.node_id === nodeId)).get(nodeId);
  const shownAt = history.findIndex((h) => h.run.id === runId);
  const previous = shownAt >= 0 ? history.slice(shownAt + 1).find((h) => h.metrics)?.metrics : undefined;
  const metric = HEADLINE.find((m) => history.some((h) => h.metrics?.[m] !== undefined));
  const concernCount = concerns(checks, nodeId);
  const explore =
    pipeline && !saveAndRun.isPending
      ? (port: string) => {
          const { version, nodeId: codeNode } = addCodeStep(pipeline, nodeId, port);
          saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, codeNode) });
        }
      : undefined;

  return (
    <Tabs.Root className="inspector" defaultValue="result">
      <div className="panel-head">
        <Tabs.List className="tabs" aria-label="Inspector">
          <Tabs.Trigger value="result">Result</Tabs.Trigger>
          <Tabs.Trigger value="inputs">Inputs</Tabs.Trigger>
          <Tabs.Trigger value="code">Code</Tabs.Trigger>
          <Tabs.Trigger value="checks" aria-label={concernCount > 0 ? `Checks, ${concernCount} to review` : "Checks"}>
            Checks{concernCount > 0 && <span className="tab-badge">⚠ {concernCount}</span>}
          </Tabs.Trigger>
          <Tabs.Trigger value="history">History</Tabs.Trigger>
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
      <Tabs.Content value="result" className="pane single">
        {saveAndRun.isError && <p role="alert" className="error">{saveAndRun.error.message}</p>}
        <ResultTab
          attempt={hasOutputs(latest) ? latest : undefined}
          operator={node?.operator}
          capability={operator?.capability_class}
          previous={previous}
          explore={explore}
        />
      </Tabs.Content>
      <Tabs.Content value="inputs" className="pane single">
        {pipeline && <InputsTab pipeline={pipeline} nodeId={nodeId} operator={operator} attempts={all} />}
      </Tabs.Content>
      <Tabs.Content value="code" className="pane single">
        {pipeline && node && isCodeOperator(node.operator) && typeof node.params.source === "string" ? (
          <CodeEditor key={`${pipeline.id}/${node.id}`} pipeline={pipeline} nodeId={node.id} source={node.params.source} />
        ) : (
          <div className="builtin">
            <p className="output-title">Built-in step · {node ? shortName(node.operator) : "unknown"}</p>
            {operator?.description && <p className="muted">{operator.description}</p>}
            {technical && <p className="tech">{node?.operator}</p>}
            <pre className="code">{JSON.stringify(node?.params ?? {}, null, 2)}</pre>
          </div>
        )}
      </Tabs.Content>
      <Tabs.Content value="checks" className="pane single">
        <ChecksTab run={checks} nodeId={nodeId} />
      </Tabs.Content>
      <Tabs.Content value="history" className="pane single">
        <HistoryTab history={history} runId={runId} metric={metric} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

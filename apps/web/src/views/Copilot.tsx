import { useAttempts, useRuns } from "../api/hooks.ts";
import { GATE_NODE } from "../flow/latest.ts";
import { useSelection } from "../workbench/selection.ts";

/** The Copilot arrives with M2 (AI-created pipeline). Until then this pane says so plainly. */
export function Copilot() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const runs = useRuns(pipelineVersionId);
  const live = runs.data?.find((r) => r.id === runId)?.status === "running";
  const attempts = useAttempts(runId, live);
  const steps = (attempts.data ?? []).filter((a) => a.node_id !== GATE_NODE);
  const done = steps.filter((a) => a.state === "succeeded").length;
  return (
    <aside className="copilot pad" aria-label="Copilot">
      <div className="copilot-head">
        <strong>Copilot</strong>
        <span className="chip">Context · {nodeId ?? "flow"}</span>
      </div>
      <p className="muted">
        The Copilot will explain steps and propose decisions here once the AI planner (M2) exists. It is not
        connected yet.
      </p>
      {runId && (
        <div className="card">
          <p className="eyebrow">This run</p>
          <p className="mono">
            {done} of {steps.length} step attempts succeeded
          </p>
        </div>
      )}
    </aside>
  );
}

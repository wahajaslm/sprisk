import type { Attempt } from "@sprisk/contracts";

import { useRunAttempts } from "../api/hooks.ts";
import { GATE_NODE, hasOutputs } from "../flow/latest.ts";
import { useSelection } from "../workbench/selection.ts";
import { SendIcon, SparkIcon } from "./Icons.tsx";
import { QueryState } from "../components/ui/QueryState.tsx";

/** The Copilot arrives with M2 (AI-created pipeline). Until then the pane says so plainly,
 * and its input is disabled rather than pretending to answer. */
export function Copilot() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  return (
    <aside className="copilot" aria-label="Copilot">
      <div className="panel-head">
        <SparkIcon />
        <strong>Copilot</strong>
        <span className="spacer" />
        <span className="chip">Context · {nodeId ?? "flow"}</span>
      </div>
      <div className="copilot-body">
        <p className="bubble">
          I will explain steps and propose decisions here once the AI planner (M2) is connected. For now I can only
          summarise the run.
        </p>
        {runId && (
          <div className="card">
            <div className="card-head">This run</div>
            <div className="card-body">
              <QueryState query={attempts}>{(data) => <RunSummary attempts={data} />}</QueryState>
            </div>
          </div>
        )}
      </div>
      <div className="copilot-foot">
        <div className="composer">
          <input id="copilot-input" aria-label="Ask Copilot" placeholder="Copilot is not connected yet" disabled />
          <button type="button" className="send" aria-label="Send" disabled>
            <SendIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

function RunSummary({ attempts }: { attempts: Attempt[] }) {
  const steps = attempts.filter((a) => a.node_id !== GATE_NODE);
  const done = steps.filter(hasOutputs).length;
  const cached = steps.filter((a) => a.state === "cache_hit").length;
  return (
    <p className="mono">
      {done} of {steps.length} step attempts done{cached > 0 ? ` · ${cached} cached` : ""}
    </p>
  );
}

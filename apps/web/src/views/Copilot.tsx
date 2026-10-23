import type { Attempt } from "@sprisk/contracts";

import { usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { flowName } from "../flow/labels.ts";
import { hasOutputs, isGateNode } from "../flow/latest.ts";
import { useSelection } from "../workbench/selection.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { PanelToggleIcon, SendIcon } from "./Icons.tsx";
import { QueryState } from "../components/ui/QueryState.tsx";
import { CopilotMessage } from "../components/ui/CopilotMessage.tsx";

/** Copilot pane: 340px width folding to a 44px rail (ADR-0061). No AI is connected yet, and external
 * AI is off by default (rule 6), so it says so instead of answering. */
export function Copilot() {
  const { nav, pipelineVersionId, runId, nodeId } = useSelection();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const flow = usePipelineVersions().data?.find((v) => v.id === pipelineVersionId);
  const { copilotOpen, toggleCopilot } = useWorkbench();

  if (!copilotOpen) {
    return (
      <aside className="copilot-card copilot-rail" aria-label="Copilot Rail">
        <button
          type="button"
          className="copilot-toggle-btn"
          title="Expand Copilot"
          aria-label="Expand Copilot"
          onClick={toggleCopilot}
        >
          <PanelToggleIcon size={14} />
        </button>
        <span
          className="copilot-rail-label"
          role="button"
          tabIndex={0}
          onClick={toggleCopilot}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleCopilot();
          }}
        >
          Copilot
        </span>
      </aside>
    );
  }

  const contextText = nodeId
    ? `Step · ${nodeId}`
    : nav === "Flow" && flow
      ? `${flowName(flow)} · ${flow.nodes.length} steps`
      : nav;

  return (
    <aside className="copilot-card copilot" aria-label="Copilot">
      <div className="copilot-head">
        <strong>Copilot</strong>
        <span className="copilot-context">{contextText}</span>
        <button
          type="button"
          className="copilot-toggle-btn"
          title="Fold Copilot"
          aria-label="Fold Copilot"
          onClick={toggleCopilot}
        >
          <PanelToggleIcon size={14} />
        </button>
      </div>

      <div className="copilot-body">
        {runId && (
          <section className="copilot-run" aria-label="This run">
            <span className="copilot-run-label">This run</span>
            <QueryState query={attempts}>{(data) => <RunSummary attempts={data} />}</QueryState>
          </section>
        )}
        <CopilotMessage role="assistant">
          Copilot is not connected. No AI model is set up, and data never leaves this machine without your
          consent. Methodology decisions come from the rules, not from Copilot.
        </CopilotMessage>
      </div>

      <div className="copilot-foot">
        <div className="composer">
          <input id="copilot-input" aria-label="Ask Copilot" placeholder="Copilot is not connected" disabled />
          <button type="button" className="send" aria-label="Send" disabled>
            <SendIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

function RunSummary({ attempts }: { attempts: Attempt[] }) {
  const steps = attempts.filter((a) => !isGateNode(a.node_id));
  const done = steps.filter(hasOutputs).length;
  const cached = steps.filter((a) => a.state === "cache_hit").length;
  return (
    <p className="mono" style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)", marginTop: 4 }}>
      {done} of {steps.length} step attempts done{cached > 0 ? ` · ${cached} cached` : ""}
    </p>
  );
}

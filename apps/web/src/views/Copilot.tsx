import { useState } from "react";
import type { Attempt } from "@sprisk/contracts";

import { useOperators, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { askCopilot } from "../api/copilot.ts";
import { flowName } from "../flow/labels.ts";
import { hasOutputs, isGateNode, latestByNode } from "../flow/latest.ts";
import { stepTitle } from "../flow/stages.ts";
import { NAV_LABEL, useSelection } from "../workbench/selection.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { PaneFoldIcon, SendIcon } from "./Icons.tsx";
import { QueryState } from "../components/ui/QueryState.tsx";
import { CopilotMessage } from "../components/ui/CopilotMessage.tsx";

/** What a person can ask before the first message, as the design's chips. */
const SUGGESTIONS = [
  { label: "Summarise view", question: "Summarise the active view" },
  { label: "Check rules", question: "Which methodology rules apply here?" },
];

const FOLD_BUTTON = { width: "26px", height: "26px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--t-muted,#ababab)", flexShrink: "0" } as const;

/** The design's Copilot column (280px, folding to a 44px rail), answering with the local model. */
export function Copilot() {
  const { nav, pipelineVersionId, runId, nodeId } = useSelection();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const operators = useOperators();
  const flow = usePipelineVersions().data?.find((v) => v.id === pipelineVersionId);
  const { copilotOpen, toggleCopilot } = useWorkbench();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "assistant" | "user"; text: string }[]>([]);

  if (!copilotOpen) {
    return (
      <aside aria-label="Copilot Rail" style={{ background: "var(--bg-surface,#121212)", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", paddingTop: "10px", minHeight: "0" }}>
        <button type="button" className="dx-btn dx-h-06t" title="Expand Copilot" aria-label="Expand Copilot" onClick={toggleCopilot} style={FOLD_BUTTON}>
          <PaneFoldIcon side="right" open={false} />
        </button>
        <button type="button" className="dx-btn" onClick={toggleCopilot} style={{ writingMode: "vertical-rl", fontSize: "12.5px", color: "var(--t-muted,#ababab)", cursor: "pointer" }}>
          Copilot
        </button>
      </aside>
    );
  }

  const node = nodeId ? flow?.nodes.find((n) => n.id === nodeId) : undefined;
  const contextText = node
    ? stepTitle(node.operator, operators.data?.find((o) => o.id === node.operator))
    : nodeId
      ? nodeId
      : nav === "Flow" && flow
        ? `${flowName(flow)} · ${flow.nodes.length} steps`
        : nav === "Objective"
          ? "Objective · Ledger"
          : `${NAV_LABEL[nav]} · Context`;

  const sendMessage = async (text: string) => {
    if (!text.trim() || isSending) return;
    const userMsg = { role: "user" as const, text };
    const nextMessages = [...chatMessages, userMsg];
    setChatMessages(nextMessages);
    setIsSending(true);
    try {
      const reply = await askCopilot(
        nextMessages.map((m) => ({ role: m.role, content: m.text })),
        contextText,
      );
      setChatMessages([...nextMessages, { role: "assistant", text: reply }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error contacting Copilot";
      setChatMessages([
        ...nextMessages,
        { role: "assistant", text: `Sorry, I couldn't reach local Qwen 2.5: ${msg}` },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = () => {
    if (!inputText.trim() || isSending) return;
    const text = inputText;
    setInputText("");
    void sendMessage(text);
  };

  const chips = chatMessages.length === 0 ? SUGGESTIONS : [];

  return (
    <aside aria-label="Copilot" style={{ background: "var(--bg-surface,#121212)", minHeight: "0", minWidth: "0", overflow: "hidden", display: "grid", gridTemplateRows: "44px minmax(0,1fr) auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 14px", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.1)" }}>
        <span style={{ fontSize: "14px", fontWeight: "500" }}>Copilot</span>
        <span style={{ flex: "1" }} />
        <span title={contextText} style={{ fontSize: "12px", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px" }}>
          {contextText}
        </span>
        <button type="button" className="dx-btn dx-h-06t" title="Fold Copilot" aria-label="Fold Copilot" onClick={toggleCopilot} style={FOLD_BUTTON}>
          <PaneFoldIcon side="right" open />
        </button>
      </div>
      <div style={{ overflow: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {runId && <QueryState query={attempts}>{(data) => <RunNotes attempts={data} nodeId={nodeId} />}</QueryState>}
        {chatMessages.length === 0 ? (
          // Facts only: no example card stands in for an answer the model has not given.
          <CopilotMessage role="assistant">Ask about this page. Answers come from the local model and can be wrong; check them against the evidence.</CopilotMessage>
        ) : (
          chatMessages.map((m, idx) => (
            <CopilotMessage key={idx} role={m.role}>
              {m.text}
            </CopilotMessage>
          ))
        )}
        {isSending && (
          <CopilotMessage role="assistant">
            <span style={{ color: "var(--t-faint,#8c8c8c)" }}>Copilot is thinking with Qwen 2.5…</span>
          </CopilotMessage>
        )}
      </div>
      <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {chips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {chips.map(({ label, question }) => (
              <button key={label} type="button" className="dx-btn dx-h-08" onClick={() => void sendMessage(question)} style={{ padding: "4px 9px", borderRadius: "var(--r-sm,6px)", background: "rgba(var(--ink-rgb,255,255,255),0.05)", fontSize: "12.5px", color: "var(--t-secondary,#d4d4d4)" }}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="dx-field" style={{ height: "36px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.12)", display: "flex", alignItems: "center", gap: "8px", padding: "0 6px 0 12px", fontSize: "13px", color: "var(--t-faint,#8c8c8c)" }}>
          <input
            id="copilot-input"
            className="dx-input"
            aria-label="Ask Copilot"
            placeholder={`Ask about ${contextText.toLowerCase()}`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button type="button" className="dx-btn dx-h-06t" aria-label="Send" disabled={!inputText.trim() || isSending} onClick={handleSend} style={{ width: "24px", height: "24px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t-muted,#ababab)", flexShrink: "0" }}>
            <SendIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

/** What the run on screen says, in plain sentences: how far it got, and why the selected step
 * failed, from that step's own attempt. Facts only; nothing is generated. */
function RunNotes({ attempts, nodeId }: { attempts: Attempt[]; nodeId: string | undefined }) {
  const steps = attempts.filter((a) => !isGateNode(a.node_id));
  const done = steps.filter(hasOutputs).length;
  const cached = steps.filter((a) => a.state === "cache_hit").length;
  const failed = nodeId ? latestByNode(attempts).get(nodeId)?.error : undefined;
  return (
    <>
      <CopilotMessage>{`This run: ${done} of ${steps.length} step attempts done${cached > 0 ? ` · ${cached} cached` : ""}.`}</CopilotMessage>
      {failed && <CopilotMessage>{`${nodeId} failed: ${failed.message}`}</CopilotMessage>}
    </>
  );
}

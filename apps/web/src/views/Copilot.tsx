import { useState } from "react";
import type { Attempt } from "@sprisk/contracts";

import { useRunAttempts } from "../api/hooks.ts";
import { askCopilot } from "../api/copilot.ts";
import { hasOutputs, isGateNode } from "../flow/latest.ts";
import { useSelection } from "../workbench/selection.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { PanelToggleIcon, SendIcon, SparkIcon } from "./Icons.tsx";
import { QueryState } from "../components/ui/QueryState.tsx";
import { CopilotMessage } from "../components/ui/CopilotMessage.tsx";
import { Tag } from "../components/ui/Tag.tsx";

/** Copilot pane: 340px width folding to a 44px rail (ADR-0061). */
export function Copilot() {
  const { nav, pipelineVersionId, runId, nodeId } = useSelection();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const { copilotOpen, toggleCopilot } = useWorkbench();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "assistant" | "user"; text: string }[]>([]);

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
    : nav === "Objective"
      ? "Objective · Ledger"
      : nav === "Flow"
        ? "German Credit · 7 steps"
        : `${nav} · Context`;

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

  const handleChipClick = (suggestion: string) => {
    void sendMessage(suggestion);
  };

  return (
    <aside className="copilot-card copilot" aria-label="Copilot">
      <div className="copilot-head">
        <SparkIcon />
        <strong>Copilot</strong>
        <span className="spacer" />
        <span className="chip">{contextText}</span>
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
          <div className="card" style={{ padding: "10px 12px", border: "1px solid var(--border-panel)", borderRadius: "var(--radius-sm)", marginBottom: 12, background: "var(--bg-surface)" }}>
            <div className="card-head" style={{ fontSize: "var(--fs-12-5)", color: "var(--text-label)", marginBottom: 4, fontWeight: "var(--fw-medium)" }}>This run</div>
            <div className="card-body">
              <QueryState query={attempts}>{(data) => <RunSummary attempts={data} />}</QueryState>
            </div>
          </div>
        )}
        {chatMessages.length === 0 ? (
          <>
            {nav === "Objective" ? (
              <CopilotMessage
                role="assistant"
                card={{
                  title: "Objective Fact Extraction",
                  rows: [
                    { k: "Profiled dataset", v: "store_sales_2021_2026.csv" },
                    { k: "Open questions", v: "3 in ledger", warn: true },
                    { k: "Identified target", v: "Sales (units or revenue)" },
                  ],
                  foot: "Answer ledger questions to unlock pipeline generation.",
                }}
              >
                I drafted the objective ledger from your prompt and dataset profile. Answer the open questions to generate the full pipeline graph.
              </CopilotMessage>
            ) : nav === "Flow" ? (
              <CopilotMessage
                role="assistant"
                card={{
                  title: "Step Audit · Missing values ≥ 20%",
                  rows: [
                    { k: "Affected columns", v: "3 dropped", warn: true },
                    { k: "Accuracy impact", v: "−0.4 points" },
                    { k: "Alternative", v: "Median imputation (+41 cells)" },
                  ],
                  foot: "Rule CLEAN-02 recommends dropping when missing rate exceeds 20%.",
                }}
              >
                Above 20% missing, imputation creates synthetic bias. Dropping costs 0.4 points of accuracy while preserving signal integrity.
              </CopilotMessage>
            ) : nav === "Reports" ? (
              <CopilotMessage
                role="assistant"
                card={{
                  title: "Evidence Linkage",
                  rows: [
                    { k: "Active ledger", v: "German Credit v2" },
                    { k: "Linked evidence", v: "3 artifacts" },
                    { k: "Sign-off gate", v: "Pending" },
                  ],
                }}
              >
                This report links questions directly to audited run evidence. I will flag any changes if upstream pipeline runs differ.
              </CopilotMessage>
            ) : (
              <CopilotMessage role="assistant">
                Studio assistant active for {nav}. Select any step, node, or metric to audit methodology decisions and parameter sensitivity.
              </CopilotMessage>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {nav === "Objective" ? (
                <>
                  <Tag tone="default" onClick={() => handleChipClick("Explain open questions")}>
                    Explain questions
                  </Tag>
                  <Tag tone="default" onClick={() => handleChipClick("Show data profile")}>
                    Show data profile
                  </Tag>
                </>
              ) : nav === "Flow" ? (
                <>
                  <Tag tone="default" onClick={() => handleChipClick("Compare with 30% cutoff")}>
                    Compare with 30%
                  </Tag>
                  <Tag tone="default" onClick={() => handleChipClick("Show affected rows")}>
                    Show affected rows
                  </Tag>
                </>
              ) : (
                <>
                  <Tag tone="default" onClick={() => handleChipClick("Summarise active view")}>
                    Summarise view
                  </Tag>
                  <Tag tone="default" onClick={() => handleChipClick("Check methodology rules")}>
                    Check rules
                  </Tag>
                </>
              )}
            </div>
          </>
        ) : (
          chatMessages.map((m, idx) => (
            <CopilotMessage key={idx} role={m.role}>
              {m.text}
            </CopilotMessage>
          ))
        )}
        {isSending && (
          <CopilotMessage role="assistant">
            <span style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
              Copilot is thinking with Qwen 2.5…
            </span>
          </CopilotMessage>
        )}
      </div>

      <div className="copilot-foot">
        <div className="composer">
          <input
            id="copilot-input"
            aria-label="Ask Copilot"
            placeholder={`Ask about ${contextText.toLowerCase()}…`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button
            type="button"
            className="send"
            aria-label="Send"
            disabled={!inputText.trim()}
            onClick={handleSend}
          >
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

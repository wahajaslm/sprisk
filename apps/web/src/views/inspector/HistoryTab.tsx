import type { NodeRun } from "../../api/history.ts";
import { ink, P } from "../../styles/palette.ts";
import { useSelection } from "../../workbench/selection.ts";
import { formatMetric } from "../NodeFact.tsx";
import { AttemptLog } from "./ConsoleTab.tsx";

const STATE_TEXT: Record<string, string> = {
  succeeded: "✓ ran",
  cache_hit: "✓ cached",
  failed: "✕ failed",
  timed_out: "✕ timed out",
  running: "running…",
  leased: "starting…",
  queued: "queued",
};

const BUTTON = { height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.14)", display: "flex", alignItems: "center", fontSize: "12.5px", fontWeight: "500", color: "var(--t-secondary,#d4d4d4)", cursor: "pointer" } as const;
const FAINT = "var(--t-faint,#8c8c8c)";

/** This step across the latest runs, newest first. Retries and errors of the shown run below. */
export function HistoryTab({ history, runId, metric }: { history: NodeRun[]; runId: string | undefined; metric: string | undefined }) {
  const { setCompare, openExperiments } = useSelection();
  if (history.length === 0) return <p style={{ margin: "0", fontSize: "12.5px", color: FAINT }}>No runs of this pipeline yet.</p>;
  const shown = history.find((h) => h.run.id === runId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <table className="dx-table" aria-label="Runs of this step">
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Started</th>
            <th scope="col">This step</th>
            {metric && <th scope="col" className="num">{metric}</th>}
            <th scope="col"><span className="sr-only">Compare</span></th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const last = h.attempts.at(-1);
            const failed = last !== undefined && /failed|timed_out/.test(last.state);
            return (
              <tr key={h.run.id} style={h.run.id === runId ? { background: ink(0.04) } : undefined}>
                <td>#{history.length - i}{h.run.id === runId && <span style={{ marginLeft: "8px", fontSize: "12px", color: FAINT }}>shown</span>}</td>
                <td>{ago(h.run.created_at)}</td>
                <td className={failed ? "error" : undefined} style={failed ? { color: P.red } : undefined}>
                  {last ? (STATE_TEXT[last.state] ?? last.state) : "not run"}
                  {h.attempts.length > 1 && <span style={{ color: FAINT }}> · {h.attempts.length} attempts</span>}
                </td>
                {metric && <td className="num">{h.metrics?.[metric] === undefined ? "—" : formatMetric(h.metrics[metric])}</td>}
                <td style={{ width: "1%" }}>
                  {runId && h.run.id !== runId && (
                    <button
                      type="button"
                      className="dx-btn dx-h-06"
                      style={BUTTON}
                      aria-label={`Compare run #${history.length - i} with the shown run`}
                      onClick={() => {
                        setCompare([h.run.id, runId]);
                        openExperiments("Compare");
                      }}
                    >
                      Compare
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown && shown.attempts.some((a) => a.error) && (
        <section style={{ display: "flex", flexDirection: "column", gap: "8px" }} aria-label="Attempts in this run">
          <p style={{ margin: "0", fontSize: "12.5px", color: "var(--t-label,#959595)" }}>Attempts in the shown run</p>
          <AttemptLog attempts={shown.attempts} />
        </section>
      )}
    </div>
  );
}

function ago(timestamp: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(timestamp)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

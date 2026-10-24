import type { NodeRun } from "../../api/history.ts";
import { useSelection } from "../../workbench/selection.ts";
import { formatMetric } from "../NodeFact.tsx";

const STATE_TEXT: Record<string, string> = {
  succeeded: "✓ ran",
  cache_hit: "✓ cached",
  failed: "✕ failed",
  timed_out: "✕ timed out",
  running: "running…",
  leased: "starting…",
  queued: "queued",
};

/** This step across the latest runs, newest first. Retries and errors of the shown run below. */
export function HistoryTab({ history, runId, metric }: { history: NodeRun[]; runId: string | undefined; metric: string | undefined }) {
  const { setCompare, openExperiments } = useSelection();
  if (history.length === 0) return <p className="muted">No runs of this flow yet.</p>;
  const shown = history.find((h) => h.run.id === runId);
  return (
    <div className="history">
      <table className="history-table" aria-label="Runs of this step">
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Started</th>
            <th scope="col">This step</th>
            {metric && <th scope="col">{metric}</th>}
            <th scope="col"><span className="sr-only">Compare</span></th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const last = h.attempts.at(-1);
            return (
              <tr key={h.run.id} className={h.run.id === runId ? "current" : undefined}>
                <td>#{history.length - i}{h.run.id === runId && <span className="current-tag">shown</span>}</td>
                <td>{ago(h.run.created_at)}</td>
                <td className={last && /failed|timed_out/.test(last.state) ? "error" : undefined}>
                  {last ? (STATE_TEXT[last.state] ?? last.state) : "not run"}
                  {h.attempts.length > 1 && <span className="muted"> · {h.attempts.length} attempts</span>}
                </td>
                {metric && <td>{h.metrics?.[metric] === undefined ? "—" : formatMetric(h.metrics[metric])}</td>}
                <td>
                  {runId && h.run.id !== runId && (
                    <button
                      type="button"
                      className="page-btn"
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
        <section className="attempt-log" aria-label="Attempts in this run">
          <p className="output-title">Attempts in the shown run</p>
          <ol className="log">
            {shown.attempts.map((a) => (
              <li key={a.id} className={`state-${a.state}`}>
                <span className="mono">#{a.number}</span> {a.state}
                {a.error && <span className="error"> · {a.error.code}: {a.error.message}</span>}
              </li>
            ))}
          </ol>
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

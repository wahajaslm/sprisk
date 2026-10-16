import type { RunChecks } from "../../api/checks.ts";
import { Loading } from "../../components/ui/Loading.tsx";

/** Methodology checks from the run's gate that cite this step (ADR-0017). */
export function ChecksTab({ run, nodeId }: { run: RunChecks; nodeId: string }) {
  if (run.status === "error") return <p role="alert" className="error">{run.message}</p>;
  if (run.status === "none") return <p className="muted">No methodology run for this flow yet.</p>;
  if (run.status === "loading") return <Loading />;
  const mine = run.checks.filter((c) => c.cited_nodes.includes(nodeId));
  if (mine.length === 0) return <p className="muted">No methodology check concerns this step.</p>;
  return (
    <section className="checks" aria-label="Methodology checks">
      {mine.map((c) => (
        <div key={c.id} className={`check ${c.verdict}`}>
          <span className="check-mark" aria-label={c.verdict.replace("_", " ")}>
            {c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : "!"}
          </span>
          <div className="check-body">
            <p>{c.rationale}</p>
            {c.limitations && <p className="check-limit">{c.limitations}</p>}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Checks citing this step that did not pass; shown as a badge on the tab. */
export const concerns = (run: RunChecks, nodeId: string) =>
  run.status === "ready" ? run.checks.filter((c) => c.verdict !== "pass" && c.cited_nodes.includes(nodeId)).length : 0;

import type { MethodologyCheck } from "@sprisk/contracts";

import type { RunChecks } from "../../api/checks.ts";
import { useMethodologyRules } from "../../api/methodology.ts";
import { Loading } from "../../components/ui/Loading.tsx";

const PHASE: Record<NonNullable<MethodologyCheck["phase"]>, string> = {
  plan: "Plan",
  code: "Code",
  runtime: "Run",
  result: "Result",
  release: "Release",
};

/** Methodology checks from the run's gate that cite this step (ADR-0017), each with the rule
 *  it verifies, so a verdict reads as the second half of that rule's decision. */
export function ChecksTab({ run, nodeId }: { run: RunChecks; nodeId: string }) {
  const rules = useMethodologyRules();
  if (run.status === "error") return <p role="alert" className="error">{run.message}</p>;
  if (run.status === "none") return <p className="muted">No methodology run for this flow yet.</p>;
  if (run.status === "loading") return <Loading />;
  const mine = run.checks.filter((c) => c.cited_nodes.includes(nodeId));
  if (mine.length === 0) return <p className="muted">No methodology check concerns this step.</p>;
  const ruleName = new Map((rules.data ?? []).map((r) => [r.id, r.name]));
  return (
    <section className="checks" aria-label="Methodology checks">
      {mine.map((c) => (
        <article key={c.id} className={`check ${c.verdict}`}>
          <span className="check-mark" aria-label={c.verdict.replace("_", " ")}>
            {c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : "!"}
          </span>
          <div className="check-body">
            <p>
              <strong>{ruleName.get(c.check) ?? c.check}</strong>
            </p>
            {(c.phase || c.coverage) && (
              <p className="check-limit">
                {[c.phase && PHASE[c.phase], c.coverage && `${c.coverage.replace("_", " ")} coverage`].filter(Boolean).join(" · ")}
              </p>
            )}
            <p>{c.rationale}</p>
            {c.methodology_decision_id && <p className="check-limit">Set by a methodology decision.</p>}
            {c.limitations && <p className="check-limit">{c.limitations}</p>}
          </div>
        </article>
      ))}
    </section>
  );
}

/** Checks citing this step that did not pass; shown as a badge on the tab. */
export const concerns = (run: RunChecks, nodeId: string) =>
  run.status === "ready" ? run.checks.filter((c) => c.verdict !== "pass" && c.cited_nodes.includes(nodeId)).length : 0;

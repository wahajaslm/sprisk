import type { MethodologyCheck, MethodologyRule } from "@sprisk/contracts";

import type { RunChecks } from "../../api/checks.ts";
import { useMethodologyDecision, useMethodologyProposal, useMethodologyRules } from "../../api/methodology.ts";
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
  const byId = new Map((rules.data ?? []).map((r) => [r.id, r]));
  return (
    <section className="checks" aria-label="Methodology checks">
      {mine.map((c) => (
        <article key={c.id} className={`check ${c.verdict}`}>
          <span className="check-mark" aria-label={c.verdict.replace("_", " ")}>
            {c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : "!"}
          </span>
          <div className="check-body">
            <p>
              <strong>{byId.get(c.check)?.name ?? c.check}</strong>
            </p>
            {(c.phase || c.coverage) && (
              <p className="check-limit">
                {[c.phase && PHASE[c.phase], c.coverage && `${c.coverage.replace("_", " ")} coverage`].filter(Boolean).join(" · ")}
              </p>
            )}
            <p>{c.rationale}</p>
            {c.methodology_decision_id && <DecisionLine id={c.methodology_decision_id} rule={byId.get(c.check)} />}
            {c.limitations && <p className="check-limit">{c.limitations}</p>}
          </div>
        </article>
      ))}
    </section>
  );
}

/** What the decision that set this step chose, the reason given, and the evidence it weighed. */
function DecisionLine({ id, rule }: { id: string; rule: MethodologyRule | undefined }) {
  const decision = useMethodologyDecision(id);
  const proposal = useMethodologyProposal(decision.data?.proposal_id);
  if (decision.isError) return <p role="alert" className="error">{decision.error.message}</p>;
  if (proposal.isError) return <p role="alert" className="error">{proposal.error.message}</p>;
  if (!decision.data) return <p className="check-limit">Set by a methodology decision.</p>;
  const { alternative_id, reason } = decision.data;
  const label = rule?.alternatives.find((a) => a.id === alternative_id)?.label ?? alternative_id;
  return (
    <>
      <p className="check-limit">{`Decision chose ${label}${reason ? `: ${reason}` : "."}`}</p>
      {proposal.data && proposal.data.evidence.length > 0 && (
        <ul className="check-limit" aria-label="Evidence the decision weighed">
          {proposal.data.evidence.map((e) => (
            <li key={`${e.kind}:${e.label}`}>{`${e.label}: ${e.value} (${e.origin})`}</li>
          ))}
        </ul>
      )}
    </>
  );
}

import type { MethodologyCheck, MethodologyRule } from "@sprisk/contracts";

import type { RunChecks } from "../../api/checks.ts";
import { byRule, useMethodologyDecision, useMethodologyProposal, useMethodologyRules } from "../../api/methodology.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { P } from "../../styles/palette.ts";

const PHASE: Record<NonNullable<MethodologyCheck["phase"]>, string> = {
  plan: "Plan",
  code: "Code",
  runtime: "Run",
  result: "Result",
  release: "Release",
};

const LABEL = { fontSize: "12.5px", color: "var(--t-label,#959595)" } as const;
const QUIET = { fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" } as const;
const LIMIT = { margin: "0", fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", lineHeight: "1.5" } as const;

/** Methodology checks from the run's gate that cite this step (ADR-0017), each with the rule
 *  it verifies, so a verdict reads as the second half of that rule's decision. */
export function ChecksTab({ run, nodeId }: { run: RunChecks; nodeId: string }) {
  const rules = useMethodologyRules();
  if (run.status === "error") return <p role="alert" className="error">{run.message}</p>;
  if (run.status === "none") return <span style={QUIET}>No methodology run for this pipeline yet.</span>;
  if (run.status === "loading") return <Loading />;
  const mine = run.checks.filter((c) => c.cited_nodes.includes(nodeId));
  if (mine.length === 0) return <span style={QUIET}>No methodology check concerns this step.</span>;
  const byId = new Map((rules.data ?? []).map((r) => [r.id, r]));
  return (
    <section aria-label="Methodology checks" style={{ display: "flex", flexDirection: "column", minWidth: "0" }}>
      <span style={{ ...LABEL, paddingBottom: "4px" }}>Checks</span>
      {mine.map((c) => (
        <article key={c.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.05)" }}>
          <span aria-label={c.verdict.replace("_", " ")} style={{ width: "12px", flexShrink: "0", fontSize: "12px", lineHeight: "18px", textAlign: "center", color: c.verdict === "fail" || c.verdict === "warning" ? P.red : P.t3 }}>
            {c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : "!"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
            <span style={{ fontSize: "13px", fontWeight: "500", lineHeight: "1.4", color: P.t0 }}>{byId.get(c.check)?.name ?? c.check}</span>
            {(c.phase || c.coverage) && (
              <p style={LIMIT}>
                {[c.phase && PHASE[c.phase], c.coverage && `${c.coverage.replace("_", " ")} coverage`].filter(Boolean).join(" · ")}
              </p>
            )}
            <p style={{ margin: "0", fontSize: "12.5px", color: "var(--t-muted,#ababab)", lineHeight: "1.5", textWrap: "pretty" }}>{c.rationale}</p>
            {c.methodology_decision_id && <DecisionLine id={c.methodology_decision_id} rule={byId.get(c.check)} />}
            {c.limitations && <p style={LIMIT}>{c.limitations}</p>}
          </div>
        </article>
      ))}
    </section>
  );
}

/** What the decision that set this step chose, the reason given, and the evidence it weighed. */
function DecisionLine({ id, rule }: { id: string; rule: MethodologyRule | undefined }) {
  const decision = useMethodologyDecision(id);
  const ruled = byRule(decision.data) ? decision.data : undefined;
  const proposal = useMethodologyProposal(ruled?.proposal_id);
  if (decision.isError) return <p role="alert" className="error">{decision.error.message}</p>;
  if (proposal.isError) return <p role="alert" className="error">{proposal.error.message}</p>;
  if (!decision.data) return <p style={LIMIT}>Set by a methodology decision.</p>;
  const made = decision.data;
  if (!byRule(made)) return <p style={LIMIT}>{`Decision took ${made.option}: ${made.reason}`}</p>;
  const { alternative_id, reason } = made;
  const label = rule?.alternatives.find((a) => a.id === alternative_id)?.label ?? alternative_id;
  return (
    <>
      <p style={LIMIT}>{`Decision chose ${label}${reason ? `: ${reason}` : "."}`}</p>
      {proposal.data && proposal.data.evidence.length > 0 && (
        <ul aria-label="Evidence the decision weighed" style={{ ...LIMIT, padding: "0", listStyle: "none" }}>
          {proposal.data.evidence.map((e) => (
            <li key={`${e.kind}:${e.label}`}>{`${e.label}: ${e.value} (${e.origin})`}</li>
          ))}
        </ul>
      )}
    </>
  );
}

import type { FlowDecision } from "@sprisk/contracts";
import { Fact } from "../../components/ui/Fact.tsx";

import { P } from "../../styles/palette.ts";
import { PromiseList } from "../PromiseList.tsx";

const TAKEN: Record<FlowDecision["assurance"], string> = {
  rule: "Chosen by the method",
  confirmed: "Confirmed by a person",
};

// The Methodology tab's grid, column, label and fact row (MethodologyTab.tsx), copied because
// that module imports this one.
const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: "20px 40px", alignItems: "start" } as const;
const COLUMN = { display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" } as const;
const LABEL = { fontSize: "12.5px", color: "var(--t-label,#959595)" } as const;


/** One method's decision on a step, in the Methodology tab's columns: the method and its
 * pick, the bindings it made, and its promises with their standing on this version. */
export function MethodDecision({ decision }: { decision: FlowDecision }) {
  const bindings = decision.bindings ?? [];
  return (
    <section aria-label={decision.activity} style={GRID}>
      <div style={COLUMN}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", paddingBottom: "6px" }}>
          <span style={LABEL}>Method · {decision.activity}</span>
          <span style={{ fontSize: "14px", fontWeight: "550" }}>{decision.question}</span>
          <span style={{ fontSize: "13px", color: P.t1 }}>Chooses: {decision.label}</span>
          <span style={{ fontSize: "12.5px", color: "var(--t-muted,#ababab)", lineHeight: "1.5", textWrap: "pretty", marginTop: "2px" }}>{decision.reason}</span>
          <span style={{ fontSize: "11.5px", color: "var(--t-faint,#8c8c8c)", marginTop: "2px" }}>{TAKEN[decision.assurance]}</span>
        </div>
      </div>
      <div style={COLUMN}>
        <span style={LABEL}>Bindings</span>
        {bindings.length === 0 ? (
          <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" }}>No binding made.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {bindings.map((b) => (
              <Fact key={b.concept} k={b.concept} v={b.source.step ? `${b.source.column} · from ${b.source.step}` : b.source.column} />
            ))}
          </div>
        )}
      </div>
      <div style={COLUMN}>
        <span style={LABEL}>Promises</span>
        <PromiseList promises={decision.promises} />
      </div>
    </section>
  );
}

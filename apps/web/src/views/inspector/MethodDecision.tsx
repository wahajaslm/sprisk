import type { FlowDecision } from "@sprisk/contracts";

import { PromiseList } from "../PromiseList.tsx";

export const TAKEN: Record<FlowDecision["assurance"], string> = {
  rule: "Chosen by the method",
  confirmed: "Confirmed by a person",
};

/** One method's decision on a step, in the Methodology tab's columns: the method and its
 * pick, the bindings it made, and its promises with their standing on this version. */
export function MethodDecision({ decision }: { decision: FlowDecision }) {
  const bindings = decision.bindings ?? [];
  return (
    <section className="rule-decision method-decision" aria-label={decision.activity}>
      <div className="rd-col">
        <p className="rd-label">Method · {decision.activity}</p>
        <h3 className="rd-title">{decision.question}</h3>
        <p>Chooses: {decision.label}</p>
        <p className="muted">{decision.reason}</p>
        <p className="rd-tag">{TAKEN[decision.assurance]}</p>
      </div>
      <div className="rd-col">
        <p className="rd-label">Bindings</p>
        {bindings.length === 0 ? (
          <p className="muted">No binding made.</p>
        ) : (
          <dl className="rd-facts">
            {bindings.map((b) => (
              <div key={b.concept}>
                <dt>{b.concept}</dt>
                <dd>{b.source.step ? `${b.source.column} · from ${b.source.step}` : b.source.column}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="rd-col promise-col">
        <p className="rd-label">Promises</p>
        <PromiseList promises={decision.promises} />
      </div>
    </section>
  );
}

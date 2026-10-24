import type { FlowDecision, PromiseStatus } from "@sprisk/contracts";

/** How each promise stands, in a word. Stale is never shown as holding (ADR-0063). */
export const STANDING: Record<PromiseStatus["status"], { word: string; tone: "good" | "bad" | "warn" | "idle" }> = {
  pass: { word: "Holds", tone: "good" },
  fail: { word: "Fails", tone: "bad" },
  inconclusive: { word: "Inconclusive", tone: "warn" },
  not_evaluated: { word: "Not checked", tone: "idle" },
  stale: { word: "Stale", tone: "warn" },
};

const TAKEN: Record<FlowDecision["assurance"], string> = {
  rule: "Chosen by the method",
  confirmed: "Confirmed by a person",
};

/** A decision's promises, each with its standing and what its check found. */
export function PromiseList({ promises }: { promises: PromiseStatus[] }) {
  if (promises.length === 0) return <p className="muted">This option makes no promise to check.</p>;
  return (
    <ul className="promise-list">
      {promises.map((p) => (
        <li key={p.verification} aria-label={p.promise} className={`promise tone-${STANDING[p.status].tone}`}>
          <span className="promise-head">
            <span className="promise-text">{p.promise}</span>
            <span className="promise-standing">{STANDING[p.status].word}</span>
          </span>
          <small>{p.detail}</small>
        </li>
      ))}
    </ul>
  );
}

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

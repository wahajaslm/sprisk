import type { PromiseStatus } from "@sprisk/contracts";

/** How each promise stands, in a word. Stale is never shown as holding (ADR-0063). */
export const STANDING: Record<PromiseStatus["status"], { word: string; tone: "good" | "bad" | "warn" | "idle" }> = {
  pass: { word: "Holds", tone: "good" },
  fail: { word: "Fails", tone: "bad" },
  inconclusive: { word: "Inconclusive", tone: "warn" },
  not_evaluated: { word: "Not checked", tone: "idle" },
  stale: { word: "Stale", tone: "warn" },
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

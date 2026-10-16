import type { Operator } from "@sprisk/contracts";

import { useOperators } from "../api/hooks.ts";
import { kindOf, shortName, STAGES, stageOf } from "../flow/stages.ts";

export function StepLibrary() {
  const operators = useOperators();
  if (operators.isPending) return <p className="muted pad">Loading…</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (operators.data.length === 0) return <p className="muted pad">No operators registered.</p>;
  const ops = operators.data;
  return (
    <div className="library">
      {STAGES.map((stage, i) => {
      const inStage = ops.filter((op) => stageOf(op) === stage);
      if (inStage.length === 0) return null;
      return (
        <section key={stage} aria-label={stage} className="stage-group">
          <h3 className="eyebrow">
            {String(i + 1).padStart(2, "0")} {stage}
          </h3>
          {inStage.map((op) => (
            <StepItem key={op.id} operator={op} />
          ))}
        </section>
      );
      })}
    </div>
  );
}

function StepItem({ operator }: { operator: Operator }) {
  return (
    <div className="step-item" title={operator.description}>
      <span className={`kind-icon ${kindOf(operator)}`} aria-hidden="true" />
      <span className="step-name">{shortName(operator.id)}</span>
      <span className="step-hint">{operator.capability_class}</span>
    </div>
  );
}

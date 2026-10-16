import type { Operator } from "@sprisk/contracts";

import { useOperators } from "../api/hooks.ts";
import { kindOf, STAGES, stageOf } from "../flow/stages.ts";
import { QueryState } from "./QueryState.tsx";

/** "sprisk.clean.impute@1.0.0" → "impute". */
export const shortName = (ref: string) => ref.split("@")[0]?.split(".").at(-1) ?? ref;

export function StepLibrary() {
  const operators = useOperators();
  return (
    <div className="library">
      <QueryState query={operators} empty="No operators registered.">
        {(ops) =>
          STAGES.map((stage, i) => {
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
          })
        }
      </QueryState>
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

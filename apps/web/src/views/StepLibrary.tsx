import type { Operator } from "@sprisk/contracts";
import { useState } from "react";

import { useOperators } from "../api/hooks.ts";
import { kindOf, shortName, STAGES, stageNumber, stageOf } from "../flow/stages.ts";
import { KindIcon, SearchIcon } from "./Icons.tsx";

export function StepLibrary() {
  const operators = useOperators();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  return (
    <div className="library">
      <div className="library-search">
        <label className="search">
          <SearchIcon />
          <input
            id="step-search"
            type="search"
            placeholder="Search steps"
            aria-label="Search steps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="library-list">
        {operators.isPending && <p className="muted">Loading…</p>}
        {operators.isError && <p role="alert" className="error">{operators.error.message}</p>}
        {operators.isSuccess && operators.data.length === 0 && <p className="muted">No operators registered.</p>}
        {operators.isSuccess &&
          STAGES.map((stage) => {
            const inStage = operators.data.filter(
              (op) => stageOf(op) === stage && (needle === "" || op.id.toLowerCase().includes(needle)),
            );
            if (inStage.length === 0) return null;
            return (
              <section key={stage} aria-label={stage} className="stage-group">
                <h3 className="stage-heading">
                  <span className="stage-num">{stageNumber(stage)}</span>
                  {stage}
                </h3>
                {inStage.map((op) => (
                  <StepItem key={op.id} operator={op} />
                ))}
              </section>
            );
          })}
      </div>
    </div>
  );
}

function StepItem({ operator }: { operator: Operator }) {
  const kind = kindOf(operator);
  return (
    <div className="step-item" title={operator.description}>
      <span className={`icon-tile small kind-${kind}`}>
        <KindIcon kind={kind} size={12} />
      </span>
      <span className="step-name">{shortName(operator.id)}</span>
      <span className="step-hint">{operator.capability_class}</span>
    </div>
  );
}

import type { Operator } from "@sprisk/contracts";
import { useState } from "react";

import { useOperators } from "../api/hooks.ts";
import { kindOf, newestVersions, STAGES, stageOf, stepTitle } from "../flow/stages.ts";
import { Chevron, KindIcon, SearchIcon } from "./Icons.tsx";
import { Loading } from "../components/ui/Loading.tsx";

export function StepLibrary() {
  const operators = useOperators();
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (stage: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(stage)) next.add(stage);
      return next;
    });
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
        {operators.isPending && <Loading />}
        {operators.isError && <p role="alert" className="error">{operators.error.message}</p>}
        {operators.isSuccess && operators.data.length === 0 && <p className="muted">No operators registered.</p>}
        {operators.isSuccess &&
          STAGES.map((stage) => {
            const inStage = newestVersions(operators.data).filter(
              (op) => stageOf(op) === stage && (needle === "" || `${op.id} ${stepTitle(op.id)}`.toLowerCase().includes(needle)),
            );
            if (inStage.length === 0) return null;
            const open = !folded.has(stage);
            return (
              <section key={stage} aria-label={stage} className="stage-group">
                <h3 className="stage-heading">
                  <button type="button" aria-expanded={open} onClick={() => toggle(stage)}>
                    <span className="stage-chevron">
                      <Chevron />
                    </span>
                    {stage}
                    <span className="stage-count">{inStage.length}</span>
                  </button>
                </h3>
                {open && inStage.map((op) => <StepItem key={op.id} operator={op} />)}
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
    <div className="step-item" title={operator.description ? `${operator.description}\n${operator.id}` : operator.id}>
      <span className={`step-icon kind-${kind}`}>
        <KindIcon kind={kind} size={12} />
      </span>
      <span className="step-name">{stepTitle(operator.id)}</span>
    </div>
  );
}

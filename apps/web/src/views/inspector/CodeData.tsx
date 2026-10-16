import type { CodeInterface, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import type { Read } from "../../api/code.ts";
import { NOTEBOOK_OPERATOR } from "../../flow/notebook.ts";
import { useRunEdit } from "./useRunEdit.ts";
import { Variables } from "./Variables.tsx";

type Props = { pipeline: PipelineVersion; nodeId: string; params: Record<string, unknown>; found: Read<CodeInterface> };

/** For a code step: the variables it ended with, and which table it passes on. */
export function CodeData({ pipeline, nodeId, params, found }: Props) {
  if (found.status === "error") return <p role="alert" className="error">{found.message}</p>;
  if (found.status !== "ready") return null;
  // A notebook step passes on the names later steps read (ADR-0031); there is nothing to pick.
  const byName = pipeline.nodes.find((n) => n.id === nodeId)?.operator === NOTEBOOK_OPERATOR;
  return (
    <>
      <Variables found={found.value.outputs} />
      {!byName && <PassOn key={JSON.stringify(found.value.outputs)} pipeline={pipeline} nodeId={nodeId} params={params} found={found.value} />}
    </>
  );
}

function PassOn({ pipeline, nodeId, params, found }: Omit<Props, "found"> & { found: CodeInterface }) {
  const saved = typeof params.output === "string" ? params.output : "";
  const [output, setOutput] = useState(saved);
  const edit = useRunEdit(pipeline, nodeId);
  // Only a DataFrame can become the step's data output.
  const tables = found.outputs.filter((o) => o.type === "polars.DataFrame");
  const run = () => {
    const next: Record<string, unknown> = { ...params };
    if (output === "") delete next.output;
    else next.output = output;
    edit.run(next);
  };
  return (
    <section className="found" aria-label="Values in your code">
      <p className="found-label">Pass on to the next step</p>
      <div role="radiogroup" aria-label="Output" className="found-list">
        <label className="found-radio">
          <input type="radio" name={`out-${nodeId}`} checked={output === ""} onChange={() => setOutput("")} />
          <span className="muted">what <code>sprisk.output()</code> gives, or the input unchanged</span>
        </label>
        {tables.map((o) => (
          <label key={o.name} className="found-radio">
            <input
              type="radio"
              name={`out-${nodeId}`}
              aria-label={`${o.name} · ${o.rows} rows × ${o.columns} cols`}
              checked={output === o.name}
              onChange={() => setOutput(o.name)}
            />
            <span className="mono">{o.name}</span>
            <span className="found-meta">{o.rows} rows × {o.columns} cols</span>
          </label>
        ))}
      </div>
      {output !== saved && (
        <div className="settings-actions">
          {edit.error && <span role="alert" className="error">{edit.error}</span>}
          <span className="spacer" />
          <button type="button" className="run-code" disabled={edit.pending} onClick={run}>
            {edit.pending ? "Starting…" : "Pass this on and run"}
          </button>
        </div>
      )}
    </section>
  );
}

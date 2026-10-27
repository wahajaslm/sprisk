import type { CodeInterface, PipelineVersion } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import type { Read } from "../../api/code.ts";
import { NOTEBOOK_OPERATOR } from "../../flow/notebook.ts";
import { ink, P } from "../../styles/palette.ts";
import { useRunEdit } from "./useRunEdit.ts";

/** The design's primary button (Methodology's Apply). */
const PRIMARY = { height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid transparent", display: "flex", alignItems: "center", fontSize: "12.5px", fontWeight: "550", background: "var(--t-primary,#f2f2f2)", color: "var(--bg-app,#0a0a0a)", cursor: "pointer" } as const;

/** One choice as the design's radio row: a hidden real radio, a drawn ring, the text. */
function Choice({ name, on, label, onPick, children }: { name: string; on: boolean; label?: string; onPick: () => void; children: ReactNode }) {
  return (
    <label className={on ? "dx-field" : "dx-field dx-h-03"} style={{ position: "relative", padding: "7px 10px", borderRadius: "var(--r-sm,6px)", display: "flex", gap: "10px", alignItems: "center", cursor: "pointer", background: on ? ink(0.05) : "transparent", fontSize: "13px" }}>
      <input type="radio" name={name} aria-label={label} checked={on} onChange={onPick} style={{ position: "absolute", opacity: "0", width: "1px", height: "1px", margin: "0" }} />
      <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "6px", flexShrink: "0", border: `1px solid ${on ? P.t0 : ink(0.3)}`, boxShadow: on ? `inset 0 0 0 3px ${P.surf}, inset 0 0 0 6px ${P.t0}` : "none" }} />
      {children}
    </label>
  );
}

type Props = { pipeline: PipelineVersion; nodeId: string; params: Record<string, unknown>; found: Read<CodeInterface> };

/** For an older code step: which of its tables passes on. A notebook step passes on the names
 * later steps read (ADR-0031), so it has nothing to pick. */
export function PassOn({ pipeline, nodeId, params, found }: Props) {
  if (found.status !== "ready") return null;
  if (pipeline.nodes.find((n) => n.id === nodeId)?.operator === NOTEBOOK_OPERATOR) return null;
  return <PassOnChoice key={JSON.stringify(found.value.outputs)} pipeline={pipeline} nodeId={nodeId} params={params} found={found.value} />;
}

function PassOnChoice({ pipeline, nodeId, params, found }: Omit<Props, "found"> & { found: CodeInterface }) {
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
    <section aria-label="Values in your code" style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "560px" }}>
      <span style={{ fontSize: "12.5px", color: "var(--t-label,#959595)", paddingBottom: "2px" }}>Pass on to the next step</span>
      <div role="radiogroup" aria-label="Output" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <Choice name={`out-${nodeId}`} on={output === ""} onPick={() => setOutput("")}>
          <span style={{ color: "var(--t-muted,#ababab)" }}>what <code>sprisk.output()</code> gives, or the input unchanged</span>
        </Choice>
        {tables.map((o) => (
          <Choice key={o.name} name={`out-${nodeId}`} on={output === o.name} label={`${o.name} · ${o.rows} rows × ${o.columns} cols`} onPick={() => setOutput(o.name)}>
            <span className="mono" style={{ fontSize: "12.5px", color: P.t0 }}>{o.name}</span>
            <span style={{ marginLeft: "auto", fontSize: "12px", fontVariantNumeric: "tabular-nums", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap" }}>{o.rows} rows × {o.columns} cols</span>
          </Choice>
        ))}
      </div>
      {output !== saved && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px", paddingTop: "6px" }}>
          <button type="button" className="dx-btn" disabled={edit.pending} onClick={run} style={PRIMARY}>
            {edit.pending ? "Starting…" : "Pass this on and run"}
          </button>
          {edit.error && <span role="alert" className="error">{edit.error}</span>}
        </div>
      )}
    </section>
  );
}

import * as Tabs from "@radix-ui/react-tabs";
import type { CodeOutputCandidate } from "@sprisk/contracts";
import { useState } from "react";

import { ink, P } from "../../styles/palette.ts";
import { RowsTable } from "../RowsTable.tsx";

/** Every variable the code ended with, one at a time (ADR-0030). Only the capped summary the
 * worker wrote reaches the browser, never a whole value (rule 9). */
// Plain values a person reads at a glance; anything else that is not a table waits under Other.
const VALUE_TYPES = new Set(["int", "float", "str", "bool", "NoneType", "complex", "numpy.float64", "numpy.int64", "numpy.bool"]);

type Group = { title: string; items: CodeOutputCandidate[] };

const LABEL = { margin: "0", padding: "8px 10px 4px", fontSize: "12.5px", color: "var(--t-label,#959595)", textAlign: "left" } as const;
const NOTE = { margin: "0", fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" } as const;

/** Every variable the code ended with, grouped into tables, plain values and the rest, one shown
 * at a time (ADR-0030). `omitted` already have a tab of their own. Only the capped summary the
 * worker wrote reaches the browser, never a whole value (rule 9). */
export function Variables({ found, omitted }: { found: CodeOutputCandidate[]; omitted: string[] }) {
  const [showOther, setShowOther] = useState(false);
  const groups: Group[] = [
    { title: "Tables", items: found.filter((v) => v.rows !== undefined) },
    { title: "Values", items: found.filter((v) => v.rows === undefined && VALUE_TYPES.has(v.type)) },
  ];
  const other = found.filter((v) => v.rows === undefined && !VALUE_TYPES.has(v.type));
  const first = groups.flatMap((g) => g.items)[0] ?? other[0];
  const [picked, setPicked] = useState(first?.name);
  return (
    <Tabs.Root
      orientation="vertical"
      value={picked}
      onValueChange={setPicked}
      aria-label="Variables"
      role="region"
      style={{ display: "grid", gridTemplateColumns: "minmax(180px,280px) minmax(0,1fr)", gap: "24px", alignItems: "start", minWidth: "0" }}
    >
      <Tabs.List aria-label="Variables" style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
        {omitted.length > 0 && <p style={{ ...NOTE, padding: "0 10px 4px" }}>{`${omitted.join(", ")} ${omitted.length === 1 ? "has its own tab" : "have their own tabs"} above.`}</p>}
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <p style={LABEL}>{g.title}</p>
                {g.items.map((v) => (
                  <VariableTab key={v.name} v={v} on={v.name === picked} />
                ))}
              </div>
            ),
        )}
        {other.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <button type="button" className="dx-btn dx-h-text" aria-expanded={showOther} onClick={() => setShowOther(!showOther)} style={LABEL}>
              {`Other (${other.length})`}
            </button>
            {showOther && other.map((v) => <VariableTab key={v.name} v={v} on={v.name === picked} />)}
          </div>
        )}
      </Tabs.List>
      {found.map((v) => (
        <Tabs.Content key={v.name} value={v.name} style={{ minWidth: "0" }}>
          <Variable v={v} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/** One variable as the design's selectable row: its name, then what it is. */
function VariableTab({ v, on }: { v: CodeOutputCandidate; on: boolean }) {
  return (
    <Tabs.Trigger
      value={v.name}
      className={on ? "dx-btn" : "dx-btn dx-h-03"}
      style={{ padding: "7px 10px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "baseline", gap: "8px", minWidth: "0", fontSize: "13px", background: on ? ink(0.05) : "transparent", color: on ? P.t0 : P.t1 }}
    >
      <span className="mono" style={{ fontSize: "12.5px" }}>{v.name}</span>
      {v.chosen && <span style={{ fontSize: "11.5px", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap" }}> → next steps</span>}{" "}
      <span style={{ marginLeft: "auto", fontSize: "11.5px", fontVariantNumeric: "tabular-nums", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary(v)}</span>
    </Tabs.Trigger>
  );
}

const summary = (v: CodeOutputCandidate) => (v.rows === undefined ? v.type : `${v.type} · ${v.rows} × ${v.columns}`);

function Variable({ v }: { v: CodeOutputCandidate }) {
  if (v.text !== undefined) return <pre className="code">{v.text}</pre>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
      {v.fields && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>
          <div style={{ maxWidth: "100%", overflowX: "auto" }}>
            <table className="dx-table" aria-label={`Fields of ${v.name}`}>
              <thead>
                <tr>
                  <th scope="col" className="text">Field</th>
                  <th scope="col" className="text">Type</th>
                  <th scope="col" className="num">Missing</th>
                </tr>
              </thead>
              <tbody>
                {v.fields.map((f) => (
                  <tr key={f.name}>
                    <td className="text">{f.name}</td>
                    <td className="text">{f.data_type}</td>
                    <td className="num">{f.null_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {v.columns !== undefined && v.fields.length < v.columns && (
            <p className="muted" style={NOTE}>First {v.fields.length} of {v.columns} fields.</p>
          )}
        </div>
      )}
      {v.sample ? (
        <RowsTable page={v.sample} label={`First rows of ${v.name}`} />
      ) : (
        <p className="muted" style={NOTE}>The first rows were not kept: the step's report has a size limit.</p>
      )}
    </div>
  );
}

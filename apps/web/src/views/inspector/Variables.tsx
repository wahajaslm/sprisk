import * as Tabs from "@radix-ui/react-tabs";
import type { CodeOutputCandidate } from "@sprisk/contracts";
import { useState } from "react";

import { RowsTable } from "../RowsTable.tsx";

/** Every variable the code ended with, one at a time (ADR-0030). Only the capped summary the
 * worker wrote reaches the browser, never a whole value (rule 9). */
// Plain values a person reads at a glance; anything else that is not a table waits under Other.
const VALUE_TYPES = new Set(["int", "float", "str", "bool", "NoneType", "complex", "numpy.float64", "numpy.int64", "numpy.bool"]);

type Group = { title: string; items: CodeOutputCandidate[] };

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
  return (
    <Tabs.Root className="variables" orientation="vertical" defaultValue={first?.name} aria-label="Variables" role="region">
      <Tabs.List className="variable-tabs" aria-label="Variables">
        {omitted.length > 0 && <p className="variable-note">{`${omitted.join(", ")} ${omitted.length === 1 ? "has its own tab" : "have their own tabs"} above.`}</p>}
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title} className="variable-group">
                <p className="variable-group-title">{g.title}</p>
                {g.items.map((v) => (
                  <VariableTab key={v.name} v={v} />
                ))}
              </div>
            ),
        )}
        {other.length > 0 && (
          <div className="variable-group">
            <button type="button" className="variable-group-title toggle" aria-expanded={showOther} onClick={() => setShowOther(!showOther)}>
              {`Other (${other.length})`}
            </button>
            {showOther && other.map((v) => <VariableTab key={v.name} v={v} />)}
          </div>
        )}
      </Tabs.List>
      {found.map((v) => (
        <Tabs.Content key={v.name} value={v.name} className="variable-panel">
          <Variable v={v} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

function VariableTab({ v }: { v: CodeOutputCandidate }) {
  return (
    <Tabs.Trigger value={v.name} className="variable">
      <span className="mono">{v.name}</span>
      {v.chosen && <span className="variable-out"> → next steps</span>} <span className="found-meta">{summary(v)}</span>
    </Tabs.Trigger>
  );
}

const summary = (v: CodeOutputCandidate) => (v.rows === undefined ? v.type : `${v.type} · ${v.rows} × ${v.columns}`);

function Variable({ v }: { v: CodeOutputCandidate }) {
  if (v.text !== undefined) return <pre className="code">{v.text}</pre>;
  return (
    <div className="variable-detail">
      {v.fields && (
        <div className="peek-scroll">
          <table className="peek-table" aria-label={`Fields of ${v.name}`}>
            <thead>
              <tr>
                <th scope="col" className="text">Field</th>
                <th scope="col" className="text">Type</th>
                <th scope="col">Missing</th>
              </tr>
            </thead>
            <tbody>
              {v.fields.map((f) => (
                <tr key={f.name}>
                  <td className="text">{f.name}</td>
                  <td className="text">{f.data_type}</td>
                  <td>{f.null_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.columns !== undefined && v.fields.length < v.columns && (
            <p className="muted">First {v.fields.length} of {v.columns} fields.</p>
          )}
        </div>
      )}
      {v.sample ? (
        <RowsTable page={v.sample} label={`First rows of ${v.name}`} />
      ) : (
        <p className="muted">The first rows were not kept: the step's report has a size limit.</p>
      )}
    </div>
  );
}

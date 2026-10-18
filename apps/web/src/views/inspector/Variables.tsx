import * as Tabs from "@radix-ui/react-tabs";
import type { CodeOutputCandidate } from "@sprisk/contracts";

import { RowsTable } from "../RowsTable.tsx";

/** Every variable the code ended with, one at a time (ADR-0030). Only the capped summary the
 * worker wrote reaches the browser, never a whole value (rule 9). */
export function Variables({ found }: { found: CodeOutputCandidate[] }) {
  const first = found[0];
  if (!first) return null;
  return (
    <Tabs.Root className="variables" orientation="vertical" defaultValue={first.name} aria-label="Variables" role="region">
      <Tabs.List className="variable-tabs" aria-label="Variables">
        {found.map((v) => (
          <Tabs.Trigger key={v.name} value={v.name} className="variable">
            <span className="mono">{v.name}</span> <span className="found-meta">{summary(v)}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {found.map((v) => (
        <Tabs.Content key={v.name} value={v.name} className="variable-panel">
          <Variable v={v} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
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

import type { CodeOutputCandidate } from "@sprisk/contracts";
import { useState } from "react";

import { RowsTable } from "../RowsTable.tsx";

/** Every variable the code ended with, one at a time (ADR-0030). Only the capped summary the
 * worker wrote reaches the browser, never a whole value (rule 9). */
export function Variables({ found }: { found: CodeOutputCandidate[] }) {
  const [picked, setPicked] = useState(found[0]?.name);
  const shown = found.find((v) => v.name === picked) ?? found[0];
  if (!shown) return null;
  return (
    <section className="variables" aria-label="Variables">
      <p className="found-label">Variables</p>
      <ul className="variable-list">
        {found.map((v) => (
          <li key={v.name}>
            <button type="button" className="variable" aria-pressed={v.name === shown.name} onClick={() => setPicked(v.name)}>
              <span className="mono">{v.name}</span> <span className="found-meta">{summary(v)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Variable key={shown.name} v={shown} />
    </section>
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

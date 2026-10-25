import type { LoadedTable } from "@sprisk/contracts";
import { useState } from "react";

import { useDatasetProfile } from "../../api/datasets.ts";
import { useTablePage } from "../../api/hooks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { SolidBars } from "../../components/ui/StudioVisuals.tsx";
import { isNumeric } from "../RowsTable.tsx";
import { shapeOf } from "./ProfileTab.tsx";

/** Rows on one page of the preview: one request each, never the table (ADR-0038 amendment). */
export const PREVIEW_ROWS = 50;

/** The table, a page at a time, as the design's data preview shows it: each column headed by
 * its type and its distribution. A person pages, jumps to a row, and hides columns. */
export function PreviewTab({ dataset }: { dataset: LoadedTable }) {
  const [offset, setOffset] = useState(0);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [goTo, setGoTo] = useState("");
  const page = useTablePage(dataset.artifact.id, offset, PREVIEW_ROWS);
  const profile = useDatasetProfile(dataset.artifact.id).data;
  if (page.isError) return <p role="alert" className="error">The rows could not be read: {page.error.message}</p>;
  if (page.isPending) return <Loading text="Reading the first rows…" />;
  const { total_rows: total, columns, rows } = page.data;
  const shown = columns.map((c, i) => ({ ...c, at: i })).filter((c) => !hidden.has(c.name));
  const last = Math.min(page.data.offset + rows.length, total);
  const jump = () => {
    const row = Number(goTo);
    if (!Number.isInteger(row) || row < 1) return;
    setOffset(Math.min(row, Math.max(1, total)) - 1);
    setGoTo("");
  };
  const toggle = (name: string) =>
    setHidden((was) => {
      const now = new Set(was);
      if (now.has(name)) now.delete(name);
      else now.add(name);
      return now;
    });
  return (
    <section className="ds-preview" aria-label="Preview">
      <div className="ds-preview-bar">
        <span className="mono">{`Rows ${(page.data.offset + 1).toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}</span>
        <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PREVIEW_ROWS))}>
          Previous rows
        </Button>
        <Button size="sm" disabled={offset + PREVIEW_ROWS >= total} onClick={() => setOffset(offset + PREVIEW_ROWS)}>
          Next rows
        </Button>
        <label className="ds-goto">
          <span>Go to row</span>
          <input type="number" min={1} max={total} value={goTo} aria-label="Go to row" onChange={(e) => setGoTo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && jump()} />
        </label>
      </div>
      <fieldset className="ds-preview-columns">
        <legend>Columns</legend>
        {columns.map((c) => (
          <label key={c.name}>
            <input type="checkbox" checked={!hidden.has(c.name)} onChange={() => toggle(c.name)} />
            <span className="mono">{c.name}</span>
          </label>
        ))}
      </fieldset>
      <div className="plain-table ds-preview-table">
        <table aria-label={`Rows of ${dataset.name}`}>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              {shown.map((c) => {
                const column = profile?.columns.find((p) => p.name === c.name);
                const shape = column ? shapeOf(column) : [];
                return (
                  <th key={c.name} scope="col" className={isNumeric(c.data_type) ? "num" : undefined}>
                    <span className="ds-col-name">{c.name}</span>
                    <span className="ds-col-type">{c.data_type}</span>
                    {shape.length > 1 && <SolidBars name={`Distribution of ${c.name}`} values={shape} height={22} />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={page.data.offset + r}>
                <td className="num row-number">{page.data.offset + r + 1}</td>
                {shown.map((c) => {
                  const numeric = isNumeric(c.data_type);
                  const value = row.values[c.at];
                  return row.missing.includes(c.at) ? (
                    <td key={c.name} className={numeric ? "num missing" : "missing"}>—</td>
                  ) : (
                    <td key={c.name} className={numeric ? "num" : "ds-text-cell"} title={numeric ? undefined : String(value)}>
                      {String(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ds-note">Every row, including held-out test rows; for looking only. — is a missing value.</p>
    </section>
  );
}

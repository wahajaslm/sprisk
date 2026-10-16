import type { TableColumn } from "@sprisk/contracts";
import { useState } from "react";

import { CHART_KINDS, type ChartSpec } from "../flow/edit.ts";
import { isText } from "./RowsTable.tsx";

const NEEDS_Y: ReadonlySet<ChartSpec["kind"]> = new Set(["scatter", "line"]);

/** "Chart" above a table: pick a kind and columns, then add a chart step (ADR-0023). */
export function ChartMenu({ columns, onAdd, busy }: { columns: TableColumn[]; onAdd: (spec: ChartSpec) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChartSpec["kind"]>("histogram");
  // Start on a number column: the default chart is a histogram.
  const [x, setX] = useState((columns.find((c) => !isText(c.data_type)) ?? columns[0])?.name ?? "");
  const [y, setY] = useState("");
  const missingY = NEEDS_Y.has(kind) && y === "";
  return (
    <div className="chart-menu">
      <button type="button" className="page-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        Chart
      </button>
      {open && (
        <form
          className="chart-form"
          aria-label="New chart"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd(y === "" ? { kind, x } : { kind, x, y });
            setOpen(false);
          }}
        >
          <label>
            Chart
            <select aria-label="Chart" value={kind} onChange={(e) => setKind(e.target.value as ChartSpec["kind"])}>
              {CHART_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            x
            <select aria-label="x" value={x} onChange={(e) => setX(e.target.value)}>
              {columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            y
            <select aria-label="y" value={y} onChange={(e) => setY(e.target.value)}>
              <option value="">{NEEDS_Y.has(kind) ? "choose…" : "none"}</option>
              {columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="run-code" disabled={busy || x === "" || missingY}>
            Add chart
          </button>
        </form>
      )}
    </div>
  );
}

import type { DisplayItem, NotebookExecution, TablePage } from "@sprisk/contracts";

import { useTablePage } from "../../api/hooks.ts";
import { isNumeric } from "../RowsTable.tsx";
import { FigureView } from "../inspector/FiguresTab.tsx";

/** Whether a run left anything to show: outputs, an error, or a time limit hit. */
export const hasOutputs = (result: NotebookExecution) => result.outputs.length > 0 || result.error !== undefined || result.status === "timed_out";

/** What one run of a cell printed, showed and drew, then its error, as a notebook shows them. */
export function CellOutputs({ result }: { result: NotebookExecution }) {
  return (
    <div className="nb-output">
      <OutputItems items={result.outputs} />
      {result.status === "timed_out" && <p role="alert" className="error">The cell ran past its time limit and was stopped.</p>}
      {result.error && (
        <div className="nb-error" role="alert">
          <p className="nb-error-title">{`${result.error.name}: ${result.error.message}`}</p>
          {result.error.traceback.length > 0 && <pre className="code">{result.error.traceback.join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}

/** What a cell printed, showed and drew, in order; also what a running cell has shown so far. */
export function OutputItems({ items }: { items: DisplayItem[] }) {
  let figure = 0;
  return items.map((item, i) => {
    if (item.kind === "figure" && item.figure) return <FigureView key={i} figure={item.figure} index={figure++} />;
    if (item.kind === "image" && item.png_base64) return <img key={i} className="figure" alt={`Figure ${++figure}`} src={`data:image/png;base64,${item.png_base64}`} />;
    if (item.kind === "table") {
      return item.table ? <PlainTable key={i} page={item.table} /> : <p key={i} role="alert" className="error">Table {i + 1} has no content.</p>;
    }
    if (item.kind === "text") return <pre key={i} className={`code nb-text${item.channel === "stderr" ? " stderr" : ""}`}>{item.text ?? ""}</pre>;
    return <p key={i} role="alert" className="error">Output {i + 1} ({item.kind}) has no content.</p>;
  });
}

/** Rows a notebook shows of a table: the first rows, then its size, as Jupyter prints one. */
const SHOWN_ROWS = 10;

/** A saved table's first rows, fetched from its artifact. */
export function ArtifactTable({ artifactId }: { artifactId: string }) {
  const page = useTablePage(artifactId, 0, SHOWN_ROWS);
  if (page.isError) return <p role="alert" className="error">The table could not be read: {page.error.message}</p>;
  return page.data ? <PlainTable page={page.data} /> : null;
}

/** A table as plain output: column names, values (numbers on the right, a missing value as a
 * dash), then its size. No types, no tools. Row numbers when asked. */
export function PlainTable({ page, label, rowNumbers = false }: { page: TablePage; label?: string; rowNumbers?: boolean }) {
  const numeric = page.columns.map((c) => isNumeric(c.data_type));
  return (
    <div className="plain-table">
      <table aria-label={label}>
        <thead>
          <tr>
            {rowNumbers && <th scope="col" className="num">#</th>}
            {page.columns.map((c, i) => (
              <th key={c.name} scope="col" className={numeric[i] ? "num" : undefined}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, r) => (
            <tr key={r}>
              {rowNumbers && <td className="num row-number">{page.offset + r + 1}</td>}
              {row.values.map((value, col) => (
                row.missing.includes(col) ? (
                  <td key={col} className={numeric[col] ? "num missing" : "missing"}>—</td>
                ) : (
                  <td key={col} className={numeric[col] ? "num" : undefined}>{String(value)}</td>
                )
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="plain-table-size">{`${page.total_rows.toLocaleString()} rows × ${page.total_columns} columns`}</p>
    </div>
  );
}

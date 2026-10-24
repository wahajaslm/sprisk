import type { DisplayItem, NotebookExecution, TablePage } from "@sprisk/contracts";

import { useTablePage } from "../../api/hooks.ts";
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

/** A table as plain notebook output: column names, values, and its size. No types, no tools. */
export function PlainTable({ page }: { page: TablePage }) {
  return (
    <div className="nb-table">
      <table>
        <thead>
          <tr>
            {page.columns.map((c) => (
              <th key={c.name} scope="col">{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.slice(0, SHOWN_ROWS).map((row, r) => (
            <tr key={r}>
              {row.values.map((value, col) => (
                <td key={col}>{row.missing.includes(col) ? "null" : String(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nb-table-size">{`${page.total_rows} rows × ${page.total_columns} columns`}</p>
    </div>
  );
}

import type { TableColumn, TablePage } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

import { tablePageQuery, useTablePage } from "../api/hooks.ts";
import { isText } from "./RowsTable.tsx";

const PAGE_ROWS = 100;
const ROW_HEIGHT = 26;

/** A whole table artifact, scrolled like any table. Only the pages under the visible rows are
 * fetched and drawn, so the browser never holds the table (rule 9). */
export function TablePeek({ artifactId, port, actions }: { artifactId: string; port: string; actions?: (columns: TableColumn[]) => ReactNode }) {
  const first = useTablePage(artifactId, 0, PAGE_ROWS);
  if (first.isPending) return <p className="muted">Loading rows…</p>;
  if (first.isError) return <p role="alert" className="error">{first.error.message}</p>;
  const { columns, total_rows, total_columns } = first.data;
  return (
    <div className="peek">
      <div className="peek-head">
        <span>{total_rows} rows</span>
        <span>· {total_columns} columns</span>
        {total_columns > columns.length && <span>· first {columns.length} shown</span>}
        <span className="spacer" />
        {actions?.(columns)}
      </div>
      <ScrollRows artifactId={artifactId} label={`${port} rows`} head={first.data} />
    </div>
  );
}

function ScrollRows({ artifactId, label, head }: { artifactId: string; label: string; head: TablePage }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: head.total_rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    // jsdom and the first paint have no layout yet; start with a typical panel size.
    initialRect: { width: 800, height: 400 },
  });
  const items = rows.getVirtualItems();
  const pageIndexes = [...new Set(items.map((i) => Math.floor(i.index / PAGE_ROWS)))];
  const pages = useQueries({ queries: pageIndexes.map((p) => tablePageQuery(artifactId, p * PAGE_ROWS, PAGE_ROWS)) });
  const rowAt = (index: number) => {
    const at = pageIndexes.indexOf(Math.floor(index / PAGE_ROWS));
    return pages[at]?.data?.rows[index % PAGE_ROWS];
  };
  const failed = pages.find((p) => p.isError)?.error;
  const top = items[0]?.start ?? 0;
  const bottom = rows.getTotalSize() - (items.at(-1)?.end ?? 0);

  return (
    <div className="peek-scroll" ref={scroller}>
      {failed && <p role="alert" className="error">{failed.message}</p>}
      <table className="peek-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="row-num">#</th>
            {head.columns.map((c) => (
              <th key={c.name} scope="col" className={isText(c.data_type) ? "text" : undefined}>
                {c.name}
                <span className="col-type">{c.data_type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {top > 0 && <tr aria-hidden="true" style={{ height: top }} />}
          {items.map((item) => {
            const row = rowAt(item.index);
            return (
              <tr key={item.index} style={{ height: ROW_HEIGHT }}>
                <td className="row-num">{item.index + 1}</td>
                {head.columns.map((c, col) =>
                  !row ? (
                    <td key={c.name} className="loading-cell" />
                  ) : row.missing.includes(col) ? (
                    <td key={c.name} className="missing" aria-label="missing">∅</td>
                  ) : (
                    <td key={c.name} className={isText(c.data_type) ? "text" : undefined}>
                      {row.values[col]}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
          {bottom > 0 && <tr aria-hidden="true" style={{ height: bottom }} />}
        </tbody>
      </table>
    </div>
  );
}

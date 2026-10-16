import { useState } from "react";

import { useTablePage } from "../api/hooks.ts";
import { RowsTable } from "./RowsTable.tsx";

const PAGE_ROWS = 50;

/** Paged rows of a table artifact. Only one page is ever in the browser (rule 9). */
export function TablePeek({ artifactId, port }: { artifactId: string; port: string }) {
  const [offset, setOffset] = useState(0);
  const page = useTablePage(artifactId, offset, PAGE_ROWS);

  if (page.isPending) return <p className="muted">Loading rows…</p>;
  if (page.isError) return <p role="alert" className="error">{page.error.message}</p>;
  const { columns, rows, total_rows, total_columns } = page.data;
  const first = page.data.offset + 1;
  const last = page.data.offset + rows.length;

  return (
    <div className="peek">
      <RowsTable page={page.data} label={`${port} rows`} />
      <div className="peek-foot">
        <span>{rows.length === 0 ? `No rows (of ${total_rows})` : `Rows ${first}–${last} of ${total_rows}`}</span>
        {total_columns > columns.length && <span>· first {columns.length} of {total_columns} columns</span>}
        <span className="spacer" />
        <button type="button" className="page-btn" disabled={offset === 0 || page.isPlaceholderData} onClick={() => setOffset(Math.max(0, offset - PAGE_ROWS))}>
          Previous rows
        </button>
        <button type="button" className="page-btn" disabled={last >= total_rows || page.isPlaceholderData} onClick={() => setOffset(offset + PAGE_ROWS)}>
          Next rows
        </button>
      </div>
    </div>
  );
}

import type { LoadedTable } from "@sprisk/contracts";

import { useTablePage } from "../../api/hooks.ts";
import { PlainTable } from "../notebook/CellOutputs.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection, RowItem, RowList } from "../../components/ui/RowList.tsx";

/** One step that loads the table, named for people. */
export type Use = { label: string; use: LoadedTable["used_by"][number] };

/** Rows a preview shows: one page from the server, never the table (ADR-0038 amendment). */
const PREVIEW_ROWS = 50;

/** The table's first rows, as the design shows them, in the one plain table. */
export function PreviewTab({ dataset }: { dataset: LoadedTable }) {
  const page = useTablePage(dataset.artifact.id, 0, PREVIEW_ROWS);
  if (page.isError) return <p role="alert" className="error">The rows could not be read: {page.error.message}</p>;
  if (page.isPending) return <Loading text="Reading the first rows…" />;
  return (
    <div className="ds-preview">
      <PlainTable page={page.data} label={`First rows of ${dataset.name}`} rowNumbers />
      <p className="ds-note">{`First ${page.data.rows.length} rows. Includes held-out test rows; for looking only.`}</p>
    </div>
  );
}

/** Each flow and step that loads the table, each with a way to open it. */
export function LineageTab({ lineage, onOpen }: { lineage: Use[]; onOpen: (use: Use["use"]) => void }) {
  if (lineage.length === 0) return <p className="muted">No flow loads this table yet.</p>;
  return (
    <BodySection title="Loaded by" note="Each flow and step that loads this table.">
      <RowList label="Lineage">
        {lineage.map((l) => (
          <RowItem key={l.label} name={l.label} meta={`run ${l.use.run_id.slice(-6)}`} action={<Button size="sm" onClick={() => onOpen(l.use)}>Open</Button>} />
        ))}
      </RowList>
    </BodySection>
  );
}

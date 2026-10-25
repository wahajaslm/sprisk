import type { LoadedTable } from "@sprisk/contracts";

import { Button } from "../../components/ui/Button.tsx";
import { BodySection, RowItem, RowList } from "../../components/ui/RowList.tsx";

/** One step that loads the table, named for people. */
export type Use = { label: string; use: LoadedTable["used_by"][number] };

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

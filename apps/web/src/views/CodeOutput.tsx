import type { CodeDisplay } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { useArtifactText } from "../api/hooks.ts";
import { RowsTable } from "./RowsTable.tsx";

/** What a code step showed: printed text, tables and figures, in order (ADR-0020). */
export function CodeOutput({ artifactId }: { artifactId: string }) {
  const text = useArtifactText(artifactId);
  if (text.isPending) return <p className="muted">Loading output…</p>;
  if (text.isError) return <p role="alert" className="error">{text.error.message}</p>;
  let display: CodeDisplay;
  try {
    display = parse("CodeDisplay", JSON.parse(text.data));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return <p role="alert" className="error">Unreadable code output {artifactId}: {reason}</p>;
  }
  if (display.items.length === 0) return <p className="muted">The code showed nothing. End it with an expression, a print or a plot.</p>;
  let figure = 0;
  return (
    <section className="code-output" aria-label="Code output">
      {display.items.map((item, i) => {
        if (item.kind === "text") return <pre key={i} className="code">{item.text}</pre>;
        if (item.kind === "table" && item.table) {
          return (
            <div key={i} className="peek">
              <RowsTable page={item.table} label={`result ${i + 1}`} />
              <div className="peek-foot">{`${item.table.rows.length} of ${item.table.total_rows} rows`}</div>
            </div>
          );
        }
        if (item.kind === "image" && item.png_base64) {
          figure += 1;
          return <img key={i} className="figure" alt={`Figure ${figure}`} src={`data:image/png;base64,${item.png_base64}`} />;
        }
        return <p key={i} role="alert" className="error">Output item {i + 1} ({item.kind}) has no content.</p>;
      })}
    </section>
  );
}

import type { CodeDisplay } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useEffect, useState } from "react";

import { useArtifactText } from "../api/hooks.ts";
import { type ResultLayout, useResultLayout } from "../workbench/detail.ts";
import { RowsTable } from "./RowsTable.tsx";

/** What a code step showed, in the order it happened: printed text, tables and figures
 * (ADR-0020, Node Framework Scenario F). Inline or as a grid; switching never re-runs. */
export function CodeOutput({ artifactId }: { artifactId: string }) {
  const text = useArtifactText(artifactId);
  const { layout, setLayout } = useResultLayout();
  const [enlarged, setEnlarged] = useState<{ label: string; src: string } | undefined>();
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
    <>
      <div className="result-bar">
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      <section className={`code-output ${layout}`} aria-label="Code output">
        {display.items.map((item, i) => {
          if (item.kind === "text") {
            const channel = item.channel ?? "stdout";
            return (
              <div key={i} className={`result-text ${channel}`} data-channel={channel}>
                {channel === "stderr" && <span className="result-tag">stderr</span>}
                <pre className="code">{item.text}</pre>
              </div>
            );
          }
          if (item.kind === "table" && item.table) {
            return (
              <div key={i} className="peek result-tile">
                <RowsTable page={item.table} label={`result ${i + 1}`} />
                <div className="peek-foot">{`${item.table.rows.length} of ${item.table.total_rows} rows`}</div>
              </div>
            );
          }
          if (item.kind === "image" && item.png_base64) {
            figure += 1;
            const label = `Figure ${figure}`;
            const src = `data:image/png;base64,${item.png_base64}`;
            return (
              <button key={i} type="button" className="figure-button result-tile" aria-label={`Enlarge ${label}`} onClick={() => setEnlarged({ label, src })}>
                <img className="figure" alt={label} src={src} />
              </button>
            );
          }
          return <p key={i} role="alert" className="error">Output item {i + 1} ({item.kind}) has no content.</p>;
        })}
      </section>
      {enlarged && <Enlarged {...enlarged} onClose={() => setEnlarged(undefined)} />}
    </>
  );
}

function LayoutSwitch({ layout, setLayout }: { layout: ResultLayout; setLayout: (l: ResultLayout) => void }) {
  return (
    <div className="detail-switch small" role="radiogroup" aria-label="Result layout">
      {(["inline", "grid"] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={layout === l} onClick={() => setLayout(l)}>
          {l === "inline" ? "Inline" : "Grid"}
        </button>
      ))}
    </div>
  );
}

/** One figure, large, over everything. Escape or a click outside closes it. */
function Enlarged({ label, src, onClose }: { label: string; src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={label} />
        <figcaption>
          {label}
          <button type="button" className="page-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </figcaption>
      </figure>
    </div>
  );
}

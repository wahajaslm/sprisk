import type { NotebookExecution } from "@sprisk/contracts";

import { FigureView } from "../inspector/FiguresTab.tsx";
import { ShownTable } from "../inspector/VisualsTab.tsx";

/** What one run of a cell printed, showed and drew, then its error, as a notebook shows them. */
export function CellOutputs({ result }: { result: NotebookExecution }) {
  let figure = 0;
  if (result.outputs.length === 0 && !result.error && result.status !== "timed_out") return null;
  return (
    <div className="nb-output">
      {result.outputs.map((item, i) => {
        if (item.kind === "figure" && item.figure) return <FigureView key={i} figure={item.figure} index={figure++} />;
        if (item.kind === "image" && item.png_base64) return <img key={i} className="figure" alt={`Figure ${++figure}`} src={`data:image/png;base64,${item.png_base64}`} />;
        if (item.kind === "table") return <ShownTable key={i} item={item} index={i} />;
        if (item.kind === "text") return <pre key={i} className={`code nb-text${item.channel === "stderr" ? " stderr" : ""}`}>{item.text ?? ""}</pre>;
        return <p key={i} role="alert" className="error">Output {i + 1} ({item.kind}) has no content.</p>;
      })}
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

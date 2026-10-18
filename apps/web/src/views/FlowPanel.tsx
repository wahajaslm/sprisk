import { lazy, Suspense } from "react";

import { Loading } from "../components/ui/Loading.tsx";
import { useSelection } from "../workbench/selection.ts";

// React Flow is heavy; load it only when the canvas first renders.
const FlowCanvas = lazy(() => import("./FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));

/** The flow's canvas. Its notebooks are on the Notebooks page, kept in sync with it (ADR-0037). */
export function FlowPanel() {
  const setNav = useSelection((s) => s.setNav);
  return (
    <div className="flow-panel">
      <div className="flow-panel-bar">
        <button type="button" className="page-btn" onClick={() => setNav("Notebooks")}>
          This flow's notebooks
        </button>
      </div>
      <Suspense fallback={<Loading text="Loading flow…" pad />}>
        <FlowCanvas />
      </Suspense>
    </div>
  );
}

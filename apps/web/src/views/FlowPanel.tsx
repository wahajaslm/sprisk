import { lazy, Suspense } from "react";

import { Loading } from "../components/ui/Loading.tsx";
import { FLOW_VIEWS, type FlowView, useWorkbench } from "../workbench/workbench.ts";
import { NotebookView } from "./NotebookView.tsx";

// React Flow is heavy; load it only when the canvas first renders.
const FlowCanvas = lazy(() => import("./FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));


const LABEL: Record<FlowView, string> = { canvas: "Flow", notebook: "Notebook" };

/** The flow as a canvas or as notebook cells: two views of one saved version (ADR-0033). */
export function FlowPanel() {
  const { flowView, setFlowView } = useWorkbench();
  return (
    <div className="flow-panel">
      <div className="flow-panel-bar">
        <div className="detail-switch" role="radiogroup" aria-label="Show the flow as">
          {FLOW_VIEWS.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={flowView === v} onClick={() => setFlowView(v)}>
              {LABEL[v]}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<Loading text="Loading flow…" pad />}>{flowView === "canvas" ? <FlowCanvas /> : <NotebookView />}</Suspense>
    </div>
  );
}

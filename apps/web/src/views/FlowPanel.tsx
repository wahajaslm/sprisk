import { lazy, Suspense } from "react";

import { Loading } from "../components/ui/Loading.tsx";
import { OpenAsNotebook } from "./notebook/OpenAsNotebook.tsx";

// React Flow is heavy; load it only when the canvas first renders.
const FlowCanvas = lazy(() => import("./FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));

/** The flow's canvas. Its code can be opened as a notebook to explore on a kernel (ADR-0036). */
export function FlowPanel() {
  return (
    <div className="flow-panel">
      <div className="flow-panel-bar">
        <OpenAsNotebook />
      </div>
      <Suspense fallback={<Loading text="Loading flow…" pad />}>
        <FlowCanvas />
      </Suspense>
    </div>
  );
}

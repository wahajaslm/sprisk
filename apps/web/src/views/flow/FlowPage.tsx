import { lazy, Suspense } from "react";
import { StepLibrary } from "../StepLibrary.tsx";
import { FlowInspector } from "./FlowInspector.tsx";
import { Loading } from "../../components/ui/Loading.tsx";

const FlowCanvas = lazy(() => import("../FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));

/** The Flow page: StepLibrary sidebar + interactive FlowCanvas graph + bottom Inspector drawer (ADR-0061). */
export function FlowPage() {
  return (
    <div className="page-frame">
      <StepLibrary />
      <main className="center-screen flow-center" aria-label="Flow canvas and step details">
        <div className="flow-canvas-viewport">
          <Suspense fallback={<Loading text="Loading flow…" pad />}>
            <FlowCanvas />
          </Suspense>
        </div>
        <FlowInspector />
      </main>
    </div>
  );
}

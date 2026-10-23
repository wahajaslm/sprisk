import { lazy, Suspense } from "react";
import { StepLibrary } from "../StepLibrary.tsx";
import { Loading } from "../../components/ui/Loading.tsx";

const FlowCanvas = lazy(() => import("../FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));

/** The Flow page: StepLibrary sidebar + interactive FlowCanvas graph (ADR-0061). */
export function FlowPage() {
  return (
    <div className="flow-page-layout" style={{ display: "flex", width: "100%", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <aside
        style={{
          width: "var(--size-sidebar)",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-panel)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
        aria-label="Step library"
      >
        <StepLibrary />
      </aside>
      <main
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        aria-label="Flow canvas and step details"
      >
        <Suspense fallback={<Loading text="Loading flow…" pad />}>
          <FlowCanvas />
        </Suspense>
      </main>
    </div>
  );
}

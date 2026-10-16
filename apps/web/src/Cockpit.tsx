import { lazy } from "react";

import { Copilot } from "./views/Copilot.tsx";
import { Inspector } from "./views/Inspector.tsx";
import { ComingView, Placeholder } from "./views/Placeholder.tsx";
import { StepLibrary } from "./views/StepLibrary.tsx";
import { TopBar } from "./views/TopBar.tsx";
import { Dock } from "./workbench/DockAdapter.tsx";
import { useSelection } from "./workbench/selection.ts";

// React Flow is heavy; load it only when the Flow panel first renders.
const FlowCanvas = lazy(() => import("./views/FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));

const views = { library: StepLibrary, flow: FlowCanvas, inspector: Inspector, copilot: Copilot, placeholder: Placeholder };

const COMING = {
  Datasets: "Every dataset with origin, rows, columns, quality and where the flow uses it; column profiles from Profile.",
  Notebooks: "Notebook cells that run through the same workers, with Add to Flow.",
  Experiments: "Every run with the decisions it took, metrics, leakage flags and a decision diff.",
  Deploy: "Production and staging models, canary traffic, latency and drift.",
} as const;

export function Cockpit() {
  const nav = useSelection((s) => s.nav);
  return (
    <div className="cockpit">
      <TopBar />
      {nav === "Flow" ? <Dock views={views} /> : <ComingView title={nav} shows={COMING[nav]} />}
    </div>
  );
}

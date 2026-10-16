import { lazy } from "react";

import { Copilot } from "./views/Copilot.tsx";
import { Experiments } from "./views/Experiments.tsx";
import { StepTabLabel, StepToolbar } from "./views/inspector/step.tsx";
import { ComingView, Placeholder } from "./views/Placeholder.tsx";
import { ActivityBar } from "./views/ActivityBar.tsx";
import { Sidebar } from "./views/Sidebar.tsx";
import { StepTab } from "./views/StepTab.tsx";
import { TopBar } from "./views/TopBar.tsx";
import { Dock } from "./workbench/DockAdapter.tsx";
import { useSelection } from "./workbench/selection.ts";

// React Flow is heavy; load it only when the Flow panel first renders.
const FlowCanvas = lazy(() => import("./views/FlowCanvas.tsx").then((m) => ({ default: m.FlowCanvas })));

const views = { sidebar: Sidebar, flow: FlowCanvas, copilot: Copilot, "step-tab": StepTab, placeholder: Placeholder };

const COMING = {
  Datasets: "Every dataset with origin, rows, columns, quality and where the flow uses it; column profiles from Profile.",
  Notebooks: "Notebook cells that run through the same workers, with Add to Flow.",
  Deploy: "Production and staging models, canary traffic, latency and drift.",
} as const;

export function Cockpit() {
  const nav = useSelection((s) => s.nav);
  return (
    <div className="cockpit">
      <TopBar />
      <div className="workspace">
        <ActivityBar />
        {nav === "Flow" ? (
          <Dock views={views} tabLabels={{ "step-tab": StepTabLabel }} toolbars={{ "step-tab": StepToolbar }} />
        ) : nav === "Experiments" ? (
          <Experiments />
        ) : (
          <ComingView title={nav} shows={COMING[nav]} />
        )}
      </div>
    </div>
  );
}

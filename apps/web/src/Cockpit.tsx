import { Copilot } from "./views/Copilot.tsx";
import { Experiments } from "./views/Experiments.tsx";
import { StepTabLabel } from "./views/inspector/step.tsx";
import { ComingView, Placeholder } from "./views/Placeholder.tsx";
import { ActivityBar } from "./views/ActivityBar.tsx";
import { FlowPanel } from "./views/FlowPanel.tsx";
import { NotebooksPage } from "./views/notebook/NotebooksPage.tsx";
import { Sidebar } from "./views/Sidebar.tsx";
import { StepTab } from "./views/StepTab.tsx";
import { TopBar } from "./views/TopBar.tsx";
import { Dock } from "./workbench/DockAdapter.tsx";
import { useSelection } from "./workbench/selection.ts";

const views = { sidebar: Sidebar, flow: FlowPanel, copilot: Copilot, "step-tab": StepTab, placeholder: Placeholder };

const COMING = {
  Datasets: "Every dataset with origin, rows, columns, quality and where the flow uses it; column profiles from Profile.",
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
          <Dock views={views} tabLabels={{ "step-tab": StepTabLabel }} />
        ) : nav === "Experiments" ? (
          <Experiments />
        ) : nav === "Notebooks" ? (
          <NotebooksPage />
        ) : (
          <ComingView title={nav} shows={COMING[nav]} />
        )}
      </div>
    </div>
  );
}

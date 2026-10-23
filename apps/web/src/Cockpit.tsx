import { Copilot } from "./views/Copilot.tsx";
import { DatasetsPage } from "./views/datasets/DatasetsPage.tsx";
import { Experiments } from "./views/Experiments.tsx";
import { StepTabLabel } from "./views/inspector/step.tsx";
import { ComingView, Placeholder } from "./views/Placeholder.tsx";
import { ActivityBar } from "./views/ActivityBar.tsx";
import { FlowPanel } from "./views/FlowPanel.tsx";
import { NotebooksPage } from "./views/notebook/NotebooksPage.tsx";
import { Sidebar } from "./views/Sidebar.tsx";
import { StepTab } from "./views/StepTab.tsx";
import { TopBar } from "./views/TopBar.tsx";
import { ObjectivePage } from "./views/objective/ObjectivePage.tsx";
import { MethodologyPage } from "./views/methodology/MethodologyPage.tsx";
import { Dock } from "./workbench/DockAdapter.tsx";
import { useSelection } from "./workbench/selection.ts";

import { ReportsPage } from "./views/reports/ReportsPage.tsx";
import { DeployPage } from "./views/deploy/DeployPage.tsx";
import { SettingsPage } from "./views/settings/SettingsPage.tsx";

import { useState, useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette.tsx";

const views = { sidebar: Sidebar, flow: FlowPanel, copilot: Copilot, "step-tab": StepTab, placeholder: Placeholder };

const COMING: Record<string, string> = {};

export function Cockpit() {
  const nav = useSelection((s) => s.nav);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="cockpit">
      <TopBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div className="workspace">
        <ActivityBar />
        <div className="workspace-main">
          {nav === "Objective" ? (
            <ObjectivePage />
          ) : nav === "Flow" ? (
            <Dock views={views} tabLabels={{ "step-tab": StepTabLabel }} />
          ) : nav === "Methodology" ? (
            <MethodologyPage />
          ) : nav === "Experiments" ? (
            <Experiments />
          ) : nav === "Notebooks" ? (
            <NotebooksPage />
          ) : nav === "Datasets" ? (
            <DatasetsPage />
          ) : nav === "Deploy" ? (
            <DeployPage />
          ) : nav === "Reports" ? (
            <ReportsPage />
          ) : nav === "Settings" ? (
            <SettingsPage />
          ) : (
            <ComingView title={nav} shows={COMING[nav] ?? "Page in development."} />
          )}
        </div>
      </div>
    </div>
  );
}

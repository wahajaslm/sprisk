import { useState, useEffect } from "react";
import { TopBar } from "./views/TopBar.tsx";
import { ActivityBar } from "./views/ActivityBar.tsx";
import { Copilot } from "./views/Copilot.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { ObjectivePage } from "./views/objective/ObjectivePage.tsx";
import { FlowPage } from "./views/flow/FlowPage.tsx";
import { DatasetsPage } from "./views/datasets/DatasetsPage.tsx";
import { NotebooksPage } from "./views/notebook/NotebooksPage.tsx";
import { MethodologyPage } from "./views/methodology/MethodologyPage.tsx";
import { Experiments } from "./views/Experiments.tsx";
import { DeployPage } from "./views/deploy/DeployPage.tsx";
import { ReportsPage } from "./views/reports/ReportsPage.tsx";
import { SettingsPage } from "./views/settings/SettingsPage.tsx";
import { SplitChoiceExample } from "./views/examples/SplitChoiceExample.tsx";
import { useSelection } from "./workbench/selection.ts";
import { useWorkbench } from "./workbench/workbench.ts";

export function Cockpit() {
  const nav = useSelection((s) => s.nav);
  const copilotOpen = useWorkbench((s) => s.copilotOpen);
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
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
    <div className={`cockpit ${sidebarOpen ? "with-sidebar" : "folded-sidebar"}`}>
      <TopBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div
        className={`cockpit-shell ${sidebarOpen ? "with-sidebar" : "folded-sidebar"} ${
          copilotOpen ? "with-copilot" : "folded-copilot"
        }`}
      >
        <ActivityBar />
        <main className="cockpit-main">
          {nav === "Objective" ? (
            <ObjectivePage />
          ) : nav === "Flow" ? (
            <FlowPage />
          ) : nav === "Methodology" ? (
            <MethodologyPage />
          ) : nav === "SplitExample" ? (
            <SplitChoiceExample />
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
            <ObjectivePage />
          )}
        </main>
        <Copilot />
      </div>
    </div>
  );
}

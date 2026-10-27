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
import { LAYOUT } from "./styles/palette.ts";
import { useSelection } from "./workbench/selection.ts";
import { useWorkbench } from "./workbench/workbench.ts";

/** The design's main screen frame: a 48px top bar over the rail, the page and the Copilot
 * column, joined by 1px lines (designx "09 Main screen"). */
export function Cockpit() {
  const nav = useSelection((s) => s.nav);
  const copilotOpen = useWorkbench((s) => s.copilotOpen);
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
    <div style={{ height: "calc(100vh - 16px)", margin: "8px", borderRadius: "var(--r-lg,10px)", border: `1px solid ${LAYOUT.frame}`, background: "var(--bg-app,#0a0a0a)", overflow: "hidden", display: "grid", gridTemplateRows: "48px minmax(0,1fr)", color: "var(--t-primary,#f2f2f2)", fontFamily: "var(--font-sans)", fontSize: "13.5px", lineHeight: "1.5" }}>
      <TopBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div style={{ display: "grid", gridTemplateColumns: `var(--size-rail) minmax(0,1fr) ${copilotOpen ? "var(--size-copilot)" : "var(--size-copilot-rail)"}`, gap: LAYOUT.gap, background: LAYOUT.divider, borderTop: `1px solid ${LAYOUT.divider}`, minHeight: "0" }}>
        <ActivityBar />
        <main style={{ minHeight: "0", minWidth: "0", overflow: "hidden", display: "flex", background: "var(--bg-surface,#121212)" }}>
          {nav === "Objective" ? (
            <ObjectivePage />
          ) : nav === "Flow" ? (
            <FlowPage />
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
            <ObjectivePage />
          )}
        </main>
        <Copilot />
      </div>
    </div>
  );
}

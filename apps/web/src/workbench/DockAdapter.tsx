// The only module that imports dockview (apps/web/CLAUDE.md).
import "dockview-react/dist/styles/dockview.css";

import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps, type SerializedDockview } from "dockview-react";
import { type FunctionComponent, Suspense } from "react";

import { readSavedLayout, restoreLayout, saveLayout, type ViewType } from "./layout.ts";

type Views = Record<ViewType, FunctionComponent>;

/** The Studio cockpit: library left, flow over inspector in the centre, copilot right (ADR-0018). */
function addDefaultLayout(event: DockviewReadyEvent): void {
  const api = event.api;
  api.addPanel({ id: "flow", component: "flow", title: "Flow" });
  api.addPanel({ id: "library", component: "library", title: "Steps", position: { referencePanel: "flow", direction: "left" }, initialWidth: 236 });
  api.addPanel({ id: "copilot", component: "copilot", title: "Copilot", position: { referencePanel: "flow", direction: "right" }, initialWidth: 330 });
  api.addPanel({ id: "inspector", component: "inspector", title: "Inspector", position: { referencePanel: "flow", direction: "below" }, initialHeight: 340 });
}

/** Studio panels have no tab bars; each region carries its own header. */
function hideTabBars(event: DockviewReadyEvent): void {
  for (const group of event.api.groups) group.model.header.hidden = true;
}

export function Dock({ views }: { views: Views }) {
  const components = Object.fromEntries(
    Object.entries(views).map(([type, View]) => [
      type,
      (_: IDockviewPanelProps) => (
        <Suspense fallback={<p className="muted pad">Loading…</p>}>
          <View />
        </Suspense>
      ),
    ]),
  );
  const onReady = (event: DockviewReadyEvent) => {
    const saved = restoreLayout(readSavedLayout());
    if (saved) {
      try {
        event.api.fromJSON(saved as unknown as SerializedDockview);
      } catch (e) {
        // A saved layout dockview cannot read is a stale preference, not an error to surface.
        console.warn("Saved layout could not be restored; using the default.", e);
        event.api.clear();
        addDefaultLayout(event);
      }
    } else {
      addDefaultLayout(event);
    }
    hideTabBars(event);
    event.api.onDidAddGroup(() => hideTabBars(event));
    event.api.onDidLayoutChange(() => saveLayout(event.api.toJSON()));
  };
  return <DockviewReact className="sprisk-dock" components={components} onReady={onReady} />;
}

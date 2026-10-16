// The only module that imports dockview (apps/web/CLAUDE.md).
import "dockview-react/dist/styles/dockview.css";

import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { type FunctionComponent, Suspense, useEffect, useRef } from "react";

import { type InspectorTab, readTab, TAB_DRAG_TYPE, TAB_LABEL } from "./inspectorTabs.ts";
import { readPin, type Pin, ViewInstance } from "./instance.tsx";
import { ADDABLE_VIEWS, DEFAULT_PANELS, readSavedLayout, restoreLayout, saveLayout, type ViewType } from "./layout.ts";
import { useWorkbench } from "./workbench.ts";

type Views = Record<ViewType, FunctionComponent>;

/** The Studio cockpit: sidebar left, flow over inspector in the centre, copilot right (ADR-0018). */
function addDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: "flow", component: "flow", title: "Flow" });
  api.addPanel({ id: "sidebar", component: "sidebar", title: "Sidebar", position: { referencePanel: "flow", direction: "left" }, initialWidth: 236 });
  api.addPanel({ id: "copilot", component: "copilot", title: "Copilot", position: { referencePanel: "flow", direction: "right" }, initialWidth: 330 });
  api.addPanel({ id: "inspector", component: "inspector", title: "Inspector", position: { referencePanel: "flow", direction: "below" }, initialHeight: 340 });
}

const isDefault = (id: string) => (DEFAULT_PANELS as readonly string[]).includes(id);

/** Studio regions carry their own headers, so their tab bars are hidden unless the user is
 * editing the layout. Panels the user added keep a tab bar so they can be moved and closed. */
function syncTabBars(api: DockviewApi, editing: boolean): void {
  for (const group of api.groups) {
    group.model.header.hidden = !editing && group.panels.every((p) => isDefault(p.id));
  }
}

type Placement = { referenceGroup: string; direction: "left" | "right" | "above" | "below" | "within" };

function addTabPanel(api: DockviewApi, tab: InspectorTab, placement?: Placement): void {
  const near = api.getPanel("inspector") ?? api.getPanel("flow");
  const position = placement ?? (near ? { referencePanel: near.id, direction: "right" as const } : undefined);
  api.addPanel({ id: `step-tab-${crypto.randomUUID().slice(0, 8)}`, component: "step-tab", title: TAB_LABEL[tab], params: { tab }, ...(position ? { position } : {}) });
  syncTabBars(api, useWorkbench.getState().editing);
}

const DROP_DIRECTION = { left: "left", right: "right", top: "above", bottom: "below", center: "within" } as const;

/** An Inspector tab dragged onto the dock opens as its own panel where it was dropped. */
function acceptTabDrops(api: DockviewApi): void {
  const draggedTab = (e: { nativeEvent: DragEvent | PointerEvent }) =>
    e.nativeEvent instanceof DragEvent && (e.nativeEvent.dataTransfer?.types.includes(TAB_DRAG_TYPE) ?? false);
  api.onUnhandledDragOver((e) => {
    if (draggedTab(e)) e.accept();
  });
  api.onDidDrop((e) => {
    if (!(e.nativeEvent instanceof DragEvent)) return;
    const tab = readTab({ tab: e.nativeEvent.dataTransfer?.getData(TAB_DRAG_TYPE) });
    if (!tab) return;
    addTabPanel(api, tab, e.group ? { referenceGroup: e.group.id, direction: DROP_DIRECTION[e.position] } : undefined);
  });
}

function commands(api: DockviewApi) {
  return {
    addView: (type: ViewType) => {
      const title = ADDABLE_VIEWS.find((v) => v.type === type)?.title ?? type;
      const reference = api.getPanel("flow") ? { referencePanel: "flow", direction: "right" as const } : undefined;
      api.addPanel({ id: `${type}-${crypto.randomUUID().slice(0, 8)}`, component: type, title, ...(reference ? { position: reference } : {}) });
      syncTabBars(api, useWorkbench.getState().editing);
    },
    openTab: (tab: InspectorTab) => addTabPanel(api, tab),
    resetLayout: () => {
      api.clear();
      addDefaultLayout(api);
      syncTabBars(api, useWorkbench.getState().editing);
    },
    setEditing: (on: boolean) => syncTabBars(api, on),
    setSidebarVisible: (on: boolean) => api.getPanel("sidebar")?.group.api.setVisible(on),
  };
}

export function Dock({ views }: { views: Views }) {
  const attachDock = useWorkbench((s) => s.attachDock);
  const dockApi = useRef<DockviewApi | undefined>(undefined);
  // Strict Mode unmounts and remounts effects once; re-attach so the commands survive it.
  useEffect(() => {
    if (dockApi.current) attachDock(commands(dockApi.current));
    return () => attachDock(undefined);
  }, [attachDock]);

  const components = Object.fromEntries(
    Object.entries(views).map(([type, View]) => [
      type,
      ({ params, api }: IDockviewPanelProps) => {
        const pin = readPin(params);
        const setPin = (next: Pin | undefined) => {
          api.updateParameters({ pin: next });
          api.setTitle(next ? `${api.title?.split(" · ")[0] ?? type} · pinned` : (api.title?.split(" · ")[0] ?? type));
        };
        return (
          <ViewInstance pin={pin} setPin={setPin} tab={readTab(params)}>
            <Suspense fallback={<p className="muted pad">Loading…</p>}>
              <View />
            </Suspense>
          </ViewInstance>
        );
      },
    ]),
  );

  const onReady = ({ api }: DockviewReadyEvent) => {
    const saved = restoreLayout(readSavedLayout());
    if (saved) {
      try {
        api.fromJSON(saved as unknown as SerializedDockview);
      } catch (e) {
        // A saved layout dockview cannot read is a stale preference, not an error to surface.
        console.warn("Saved layout could not be restored; using the default.", e);
        api.clear();
        addDefaultLayout(api);
      }
    } else {
      addDefaultLayout(api);
    }
    const { editing, activity } = useWorkbench.getState();
    syncTabBars(api, editing);
    api.getPanel("sidebar")?.group.api.setVisible(activity !== undefined);
    api.onDidAddGroup(() => syncTabBars(api, useWorkbench.getState().editing));
    api.onDidLayoutChange(() => saveLayout(api.toJSON()));
    acceptTabDrops(api);
    dockApi.current = api;
    attachDock(commands(api));
  };
  return <DockviewReact className="sprisk-dock" components={components} onReady={onReady} />;
}

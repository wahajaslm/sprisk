// The only module that imports dockview (apps/web/CLAUDE.md).
import "dockview-react/dist/styles/dockview.css";

import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { type FunctionComponent, Suspense, useEffect, useRef } from "react";

import { INSPECTOR_TABS, type InspectorTab, readTab, TAB_LABEL } from "./inspectorTabs.ts";
import { readPin, type Pin, ViewInstance } from "./instance.tsx";
import { HEADED_PANELS, readSavedLayout, restoreLayout, saveLayout, type ViewType } from "./layout.ts";
import { useWorkbench } from "./workbench.ts";

type Views = Record<ViewType, FunctionComponent>;
/** Dock tab labels for view types that show more than a title (badges, muted states). */
type TabLabels = Partial<Record<ViewType, FunctionComponent>>;

/** The Studio cockpit: sidebar left, flow over the Inspector tabs in the centre, copilot right (ADR-0018). */
function addDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: "flow", component: "flow", title: "Flow" });
  api.addPanel({ id: "sidebar", component: "sidebar", title: "Sidebar", position: { referencePanel: "flow", direction: "left" }, initialWidth: 236 });
  api.addPanel({ id: "copilot", component: "copilot", title: "Copilot", position: { referencePanel: "flow", direction: "right" }, initialWidth: 330 });
  const [first, ...rest] = INSPECTOR_TABS;
  addTabPanel(api, first, { referencePanel: "flow", direction: "below" }, 340);
  for (const tab of rest) addTabPanel(api, tab, { referencePanel: `step-${first}`, direction: "within" });
  api.getPanel(`step-${first}`)?.api.setActive();
}

const isHeaded = (id: string) => (HEADED_PANELS as readonly string[]).includes(id);

/** Studio regions carry their own headers, so their tab bars are hidden unless the user is
 * editing the layout. Every other group keeps its tab bar: its tabs are how you switch. */
function syncTabBars(api: DockviewApi, editing: boolean): void {
  for (const group of api.groups) {
    group.model.header.hidden = !editing && group.panels.every((p) => isHeaded(p.id));
  }
}

type Position = { referencePanel: string; direction: "right" | "below" | "within" };

/** Default tab panels have stable ids (step-console); extra ones get a unique suffix. */
function addTabPanel(api: DockviewApi, tab: InspectorTab, position?: Position, initialHeight?: number): void {
  const id = api.getPanel(`step-${tab}`) ? `step-${tab}-${crypto.randomUUID().slice(0, 8)}` : `step-${tab}`;
  api.addPanel({ id, component: "step-tab", tabComponent: "step-tab", title: TAB_LABEL[tab], params: { tab }, ...(position ? { position } : {}), ...(initialHeight ? { initialHeight } : {}) });
}

function commands(api: DockviewApi) {
  return {
    openTab: (tab: InspectorTab) => {
      const near = api.getPanel("flow");
      addTabPanel(api, tab, near ? { referencePanel: near.id, direction: "right" } : undefined);
      syncTabBars(api, useWorkbench.getState().editing);
    },
    resetLayout: () => {
      api.clear();
      addDefaultLayout(api);
      syncTabBars(api, useWorkbench.getState().editing);
    },
    setEditing: (on: boolean) => syncTabBars(api, on),
    setSidebarVisible: (on: boolean) => api.getPanel("sidebar")?.group.api.setVisible(on),
  };
}

export function Dock({ views, tabLabels }: { views: Views; tabLabels: TabLabels }) {
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

  const tabComponents = Object.fromEntries(
    Object.entries(tabLabels).map(([type, Label]) => [
      type,
      ({ params, api }: IDockviewPanelHeaderProps) => (
        <ViewInstance pin={readPin(params)} setPin={undefined} tab={readTab(params)}>
          <span className="dock-tab">
            <Label />
            <button type="button" className="dock-tab-close" aria-label={`Close ${api.title ?? type}`} onClick={() => api.close()}>
              ×
            </button>
          </span>
        </ViewInstance>
      ),
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
    const resync = () => syncTabBars(api, useWorkbench.getState().editing);
    api.onDidAddPanel(resync);
    api.onDidMovePanel(resync);
    api.onDidLayoutChange(() => saveLayout(api.toJSON()));
    dockApi.current = api;
    attachDock(commands(api));
  };
  return <DockviewReact className="sprisk-dock" components={components} tabComponents={tabComponents} onReady={onReady} />;
}

// The only module that imports dockview (apps/web/CLAUDE.md).
import "dockview-react/dist/styles/dockview.css";

import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { type FunctionComponent, Suspense, useEffect, useRef, useSyncExternalStore } from "react";

import { closedTabs, INSPECTOR_TABS, type InspectorTab, readTab, TAB_LABEL } from "./inspectorTabs.ts";
import { readPin, type Pin, ViewInstance } from "./instance.tsx";
import { HEADED_PANELS, readSavedLayout, restoreLayout, saveLayout, type ViewType } from "./layout.ts";
import { useWorkbench } from "./workbench.ts";

type Views = Record<ViewType, FunctionComponent>;
/** Per view type: a dock tab label that shows more than a title (badges, muted states), and a
 * toolbar shown at the right of the tab bar for the active panel, as in VS Code. */
type TabParts = Partial<Record<ViewType, FunctionComponent>>;
type PanelApi = IDockviewPanelProps["api"];

/** Pinning stores the pin in the panel's params, so it is saved with the layout. */
function pinSetter(api: PanelApi, fallbackTitle: string) {
  return (next: Pin | undefined) => {
    const base = api.title?.split(" · ")[0] ?? fallbackTitle;
    api.updateParameters({ pin: next });
    api.setTitle(next ? `${base} · pinned` : base);
  };
}

/** The panel's params, re-read whenever they change (e.g. a pin from the toolbar). */
function usePanelParams(api: PanelApi): unknown {
  return useSyncExternalStore(
    (onChange) => {
      const sub = api.onDidParametersChange(onChange);
      return () => sub.dispose();
    },
    () => api.getParameters(),
  );
}

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

type Position = { referencePanel: string; direction: "below" | "within" };

/** Default tab panels have stable ids (step-console); extra ones get a unique suffix. */
function addTabPanel(api: DockviewApi, tab: InspectorTab, position?: Position, initialHeight?: number): void {
  const id = api.getPanel(`step-${tab}`) ? `step-${tab}-${crypto.randomUUID().slice(0, 8)}` : `step-${tab}`;
  api.addPanel({ id, component: "step-tab", tabComponent: "step-tab", title: TAB_LABEL[tab], params: { tab }, ...(position ? { position } : {}), ...(initialHeight ? { initialHeight } : {}) });
}

const openTabs = (api: DockviewApi): InspectorTab[] =>
  api.panels.flatMap((p) => {
    const tab = readTab(p.params);
    return tab ? [tab] : [];
  });

/** Into the group that already holds Inspector tabs; under the Flow when every tab was closed. */
function reopenTab(api: DockviewApi, tab: InspectorTab): void {
  const sibling = api.panels.find((p) => readTab(p.params) !== undefined);
  const position: Position | undefined = sibling
    ? { referencePanel: sibling.id, direction: "within" }
    : api.getPanel("flow")
      ? { referencePanel: "flow", direction: "below" }
      : undefined;
  addTabPanel(api, tab, position, sibling ? undefined : 340);
  syncTabBars(api, useWorkbench.getState().editing);
}

/** Right end of a tab bar, as in VS Code: close the shown tab; in the Inspector, reopen a closed one. */
function TabGroupActions({ group, containerApi, activePanel, toolbars }: IDockviewHeaderActionsProps & { toolbars: TabParts }) {
  const isTabGroup = group.panels.some((p) => readTab(p.params) !== undefined);
  const closed = isTabGroup ? closedTabs(openTabs(containerApi)) : [];
  const Toolbar = activePanel ? toolbars[activePanel.view.contentComponent as ViewType] : undefined;
  return (
    <div className="tab-actions">
      {activePanel && Toolbar && <PanelToolbar api={activePanel.api} Toolbar={Toolbar} />}
      {closed.length > 0 && (
        <details className="reopen-tabs">
          <summary aria-label="Reopen a closed tab" title="Reopen a closed tab">+</summary>
          <div className="reopen-menu" role="menu">
            {closed.map((tab) => (
              <button key={tab} type="button" role="menuitem" onClick={() => reopenTab(containerApi, tab)}>
                {TAB_LABEL[tab]}
              </button>
            ))}
          </div>
        </details>
      )}
      {activePanel && (
        <button type="button" className="tab-action" aria-label={`Close ${activePanel.title ?? "tab"}`} title="Close tab (or middle-click it)" onClick={() => activePanel.api.close()}>
          ×
        </button>
      )}
    </div>
  );
}

function PanelToolbar({ api, Toolbar }: { api: PanelApi; Toolbar: FunctionComponent }) {
  const params = usePanelParams(api);
  return (
    <ViewInstance pin={readPin(params)} setPin={pinSetter(api, api.title ?? "")} tab={readTab(params)}>
      <Toolbar />
    </ViewInstance>
  );
}

function commands(api: DockviewApi) {
  return {
    openTab: (tab: InspectorTab) => reopenTab(api, tab),
    showTab: (tab: InspectorTab) => {
      const panel = api.panels.find((p) => readTab(p.params) === tab);
      if (panel) panel.api.setActive();
      else reopenTab(api, tab);
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

export function Dock({ views, tabLabels, toolbars }: { views: Views; tabLabels: TabParts; toolbars: TabParts }) {
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
        return (
          <ViewInstance pin={readPin(params)} setPin={pinSetter(api, type)} tab={readTab(params)}>
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
          {/* Middle-click closes, as in VS Code; the close button sits at the end of the tab bar. */}
          <span className="dock-tab" onAuxClick={(e) => e.button === 1 && api.close()}>
            <Label />
          </span>
        </ViewInstance>
      ),
    ]),
  );

  /** Every tab is a plain name; closing is at the end of the tab bar (VS Code). */
  const PlainTab = ({ api }: IDockviewPanelHeaderProps) => (
    <span className="dock-tab" onAuxClick={(e) => e.button === 1 && api.close()}>
      {api.title}
    </span>
  );

  const GroupActions = (props: IDockviewHeaderActionsProps) => <TabGroupActions {...props} toolbars={toolbars} />;

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
  return <DockviewReact className="sprisk-dock" components={components} tabComponents={tabComponents} defaultTabComponent={PlainTab} rightHeaderActionsComponent={GroupActions} onReady={onReady} />;
}

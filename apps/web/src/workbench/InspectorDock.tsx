// The only module that imports dockview (apps/web/CLAUDE.md, ADR-0010).
import "dockview-react/dist/styles/dockview.css";

import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { useEffect, useRef } from "react";

import { TabBody, useStep } from "../views/inspector/step.tsx";
import { closedTabs, INSPECTOR_TABS, type InspectorTab, readTab, TAB_LABEL } from "./inspectorTabs.ts";
import { ViewInstance } from "./instance.tsx";
import { useWorkbench } from "./workbench.ts";

/** One Inspector tab: the selected step's answer to one question, or a prompt to pick a step. */
function TabPanel({ params }: IDockviewPanelProps) {
  const tab = readTab(params) ?? "checks";
  const step = useStep();
  return (
    <ViewInstance pin={undefined} setPin={undefined} tab={tab}>
      {step.nodeId ? (
        <TabBody tab={tab} step={step} />
      ) : (
        <div className="flow-inspector-empty">
          <p className="muted">Select a step in the flow to inspect its {TAB_LABEL[tab].toLowerCase()}.</p>
        </div>
      )}
    </ViewInstance>
  );
}

/** A tab's name, with the count of what needs a look on Methodology and Console. */
function TabLabel({ params, api }: IDockviewPanelHeaderProps) {
  const tab = readTab(params) ?? "checks";
  const step = useStep();
  const count = tab === "checks" ? step.concernCount : tab === "console" ? step.problems : 0;
  return (
    // Middle-click closes, as in VS Code; reopen from + at the end of the tab bar.
    <span className="dock-tab" onAuxClick={(e) => e.button === 1 && api.close()}>
      {TAB_LABEL[tab]}
      {count > 0 && <span className="flow-tab-badge alert">{count}</span>}
    </span>
  );
}

function addTab(api: DockviewApi, tab: InspectorTab, reference?: string): void {
  const id = api.getPanel(`step-${tab}`) ? `step-${tab}-${crypto.randomUUID().slice(0, 8)}` : `step-${tab}`;
  api.addPanel({ id, component: "tab", tabComponent: "tab", title: TAB_LABEL[tab], params: { tab }, ...(reference ? { position: { referencePanel: reference, direction: "within" } } : {}) });
}

function addDefaultTabs(api: DockviewApi): void {
  for (const tab of INSPECTOR_TABS) addTab(api, tab, api.panels[0]?.id);
  api.getPanel("step-checks")?.api.setActive();
}

const openTabs = (api: DockviewApi): InspectorTab[] => api.panels.flatMap((p) => readTab(p.params) ?? []);

/** Right end of each tab bar: reopen a closed tab, float the group, and fold or fill the panel. */
function GroupActions({ group, containerApi }: IDockviewHeaderActionsProps) {
  const { inspectorCollapsed, inspectorMaximized, toggleInspectorCollapsed, toggleInspectorMaximized } = useWorkbench();
  const closed = closedTabs(openTabs(containerApi));
  const floating = group.api.location.type === "floating";
  return (
    <div className="flow-inspector-actions">
      {closed.length > 0 && (
        <details className="reopen-tabs">
          <summary aria-label="Reopen a closed tab" title="Reopen a closed tab">+</summary>
          <div className="reopen-menu" role="menu">
            {closed.map((tab) => (
              <button key={tab} type="button" role="menuitem" onClick={() => addTab(containerApi, tab, containerApi.panels[0]?.id)}>
                {TAB_LABEL[tab]}
              </button>
            ))}
          </div>
        </details>
      )}
      {!floating && (
        <>
          <button type="button" className="flow-inspector-btn" aria-label={inspectorMaximized ? "Restore panel" : "Maximize panel"} title={inspectorMaximized ? "Restore" : "Maximize"} onClick={toggleInspectorMaximized}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d={inspectorMaximized ? "M4 1v3H1m11-3h3v3m0 8v3h-3m-8 0H1v-3" : "M1 5V1h4m6 0h4v4m0 6v4h-4m-6 0H1v-4"} />
            </svg>
          </button>
          <button type="button" className="flow-inspector-btn" aria-label="Float panel" title="Float panel" onClick={() => group.activePanel && containerApi.addFloatingGroup(group.activePanel)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2.5h7.5V10M13.5 2.5L7 9M11 11.5v2h-8.5V5h2" />
            </svg>
          </button>
          <button type="button" className="flow-inspector-btn" aria-label={inspectorCollapsed ? "Expand panel" : "Collapse panel"} title={inspectorCollapsed ? "Expand" : "Collapse"} onClick={toggleInspectorCollapsed}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: inspectorCollapsed ? "rotate(180deg)" : "none" }}>
              <path d="M3 6l5 5 5-5" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

/** The Flow page's bottom panel as a dock (ADR-0010): its tabs can be split, floated, closed and reopened. */
export function InspectorDock() {
  const attachDock = useWorkbench((s) => s.attachDock);
  const dockApi = useRef<DockviewApi | undefined>(undefined);
  // Strict Mode unmounts and remounts effects once; re-attach so the commands survive it.
  useEffect(() => {
    const api = dockApi.current;
    if (api) attachDock(commands(api));
    return () => attachDock(undefined);
  }, [attachDock]);

  const onReady = ({ api }: DockviewReadyEvent) => {
    addDefaultTabs(api);
    dockApi.current = api;
    attachDock(commands(api));
  };
  return (
    <DockviewReact
      className="sprisk-dock"
      components={{ tab: TabPanel }}
      tabComponents={{ tab: TabLabel }}
      rightHeaderActionsComponent={GroupActions}
      onReady={onReady}
    />
  );
}

function commands(api: DockviewApi) {
  return {
    openTab: (tab: InspectorTab) => addTab(api, tab, api.panels[0]?.id),
    showTab: (tab: InspectorTab) => {
      const panel = api.panels.find((p) => readTab(p.params) === tab);
      if (panel) panel.api.setActive();
      else addTab(api, tab, api.panels[0]?.id);
      if (useWorkbench.getState().inspectorCollapsed) useWorkbench.getState().toggleInspectorCollapsed();
    },
    resetLayout: () => {
      api.clear();
      addDefaultTabs(api);
    },
  };
}

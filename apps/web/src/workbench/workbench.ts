import { create } from "zustand";

import type { InspectorTab } from "./inspectorTabs.ts";

export const ACTIVITIES = ["steps", "runs", "views"] as const;

export type Activity = (typeof ACTIVITIES)[number];

/** What the Inspector dock can do, registered by InspectorDock so nothing else imports dockview. */
export type DockCommands = {
  /** Open another panel for one Inspector tab, e.g. to pin it and compare runs. */
  openTab: (tab: InspectorTab) => void;
  /** Bring a tab to the front, reopening it if it was closed. */
  showTab: (tab: InspectorTab) => void;
  resetLayout: () => void;
};

type Workbench = {
  /** Sidebar content; undefined means the sidebar is collapsed (VS Code behaviour). */
  activity: Activity | undefined;
  editing: boolean;
  copilotOpen: boolean;
  sidebarOpen: boolean;
  dock: DockCommands | undefined;
  /** The Flow page's bottom panel: folded to its tab bar, or filling the centre. */
  inspectorCollapsed: boolean;
  inspectorMaximized: boolean;
  toggleInspectorCollapsed: () => void;
  toggleInspectorMaximized: () => void;
  toggleActivity: (activity: Activity) => void;
  toggleEditing: () => void;
  toggleCopilot: () => void;
  toggleSidebar: () => void;
  attachDock: (dock: DockCommands | undefined) => void;
};

/** UI layout state only (arch §2A). Never scientific state. */
export const useWorkbench = create<Workbench>((set, get) => ({
  activity: "steps",
  editing: false,
  copilotOpen: true,
  sidebarOpen: true,
  dock: undefined,
  inspectorCollapsed: false,
  inspectorMaximized: false,
  toggleInspectorCollapsed: () => set({ inspectorCollapsed: !get().inspectorCollapsed, inspectorMaximized: false }),
  toggleInspectorMaximized: () => set({ inspectorMaximized: !get().inspectorMaximized, inspectorCollapsed: false }),
  toggleActivity: (activity) => {
    const next = get().activity === activity ? undefined : activity;
    set({ activity: next });
  },
  toggleEditing: () => {
    const editing = !get().editing;
    set({ editing });
  },
  toggleCopilot: () => set({ copilotOpen: !get().copilotOpen }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  attachDock: (dock) => set({ dock }),
}));


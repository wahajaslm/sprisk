import { create } from "zustand";

import type { InspectorTab } from "./inspectorTabs.ts";

export const ACTIVITIES = ["steps", "runs", "views"] as const;

export type Activity = (typeof ACTIVITIES)[number];

/** What the dock can do, registered by DockAdapter so nothing else imports dockview. */
export type DockCommands = {
  /** Open another panel for one Inspector tab, e.g. to pin it and compare runs. */
  openTab: (tab: InspectorTab) => void;
  /** Bring a tab to the front, reopening it if it was closed. */
  showTab: (tab: InspectorTab) => void;
  resetLayout: () => void;
  setEditing: (on: boolean) => void;
  setSidebarVisible: (on: boolean) => void;
};

type Workbench = {
  /** Sidebar content; undefined means the sidebar is collapsed (VS Code behaviour). */
  activity: Activity | undefined;
  editing: boolean;
  dock: DockCommands | undefined;
  toggleActivity: (activity: Activity) => void;
  toggleEditing: () => void;
  attachDock: (dock: DockCommands | undefined) => void;
};

/** UI layout state only (arch §2A). Never scientific state. */
export const useWorkbench = create<Workbench>((set, get) => ({
  activity: "steps",
  editing: false,
  dock: undefined,
  toggleActivity: (activity) => {
    const next = get().activity === activity ? undefined : activity;
    set({ activity: next });
    get().dock?.setSidebarVisible(next !== undefined);
  },
  toggleEditing: () => {
    const editing = !get().editing;
    set({ editing });
    get().dock?.setEditing(editing);
  },
  attachDock: (dock) => set({ dock }),
}));

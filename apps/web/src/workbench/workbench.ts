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

export type ShellMode = "docked" | "joined";

type Workbench = {
  /** Sidebar content; undefined means the sidebar is collapsed (VS Code behaviour). */
  activity: Activity | undefined;
  editing: boolean;
  copilotOpen: boolean;
  sidebarOpen: boolean;
  shellMode: ShellMode;
  dock: DockCommands | undefined;
  toggleActivity: (activity: Activity) => void;
  toggleEditing: () => void;
  toggleCopilot: () => void;
  toggleSidebar: () => void;
  setShellMode: (mode: ShellMode) => void;
  toggleShellMode: () => void;
  attachDock: (dock: DockCommands | undefined) => void;
};

const INITIAL_SHELL_MODE: ShellMode =
  typeof window !== "undefined" && window.localStorage.getItem("sprisk.shell_mode") === "joined"
    ? "joined"
    : "docked";

/** UI layout state only (arch §2A). Never scientific state. */
export const useWorkbench = create<Workbench>((set, get) => ({
  activity: "steps",
  editing: false,
  copilotOpen: true,
  sidebarOpen: true,
  shellMode: INITIAL_SHELL_MODE,
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
  toggleCopilot: () => set({ copilotOpen: !get().copilotOpen }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  setShellMode: (mode) => {
    try {
      window.localStorage.setItem("sprisk.shell_mode", mode);
    } catch {
      // ignore
    }
    set({ shellMode: mode });
  },
  toggleShellMode: () => {
    const next = get().shellMode === "docked" ? "joined" : "docked";
    get().setShellMode(next);
  },
  attachDock: (dock) => set({ dock }),
}));


import { create } from "zustand";

export const NAV = [
  "Objective",
  "Flow",
  "Datasets",
  "Notebooks",
  "Methodology",
  "Experiments",
  "Deploy",
  "Reports",
  "Settings",
] as const;
export type Nav = (typeof NAV)[number];

/** UI context only (arch §2A WorkbenchContext). Never scientific state. */
type Selection = {
  nav: Nav;
  pipelineVersionId: string | undefined;
  runId: string | undefined;
  nodeId: string | undefined;
  /** The notebook open on the Notebooks page (ADR-0036). */
  notebookId: string | undefined;
  stageTarget: string | undefined;
  setNav: (nav: Nav) => void;
  openNotebook: (id: string) => void;
  openStageNotebook: (stage: string) => void;
  selectPipelineVersion: (id: string) => void;
  selectRun: (id: string | undefined) => void;
  selectNode: (id: string | undefined) => void;
  /** The two runs the Experiments view compares, older first. Empty until the user picks. */
  compare: string[];
  setCompare: (runIds: string[]) => void;
  /** Jump to a step of a run, e.g. right after saving a new version and starting it. */
  showRun: (pipelineVersionId: string, runId: string, nodeId?: string) => void;
};

/** The page named in the URL hash (`#Datasets`), so a reload or a shared link opens it. */
function navFromHash(): Nav | undefined {
  const named = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  return NAV.find((n) => n.toLowerCase() === named);
}

export const useSelection = create<Selection>((set) => ({
  nav: navFromHash() ?? "Flow",
  pipelineVersionId: undefined,
  runId: undefined,
  nodeId: undefined,
  notebookId: undefined,
  stageTarget: undefined,
  setNav: (nav) => {
    if (navFromHash() !== nav) window.location.hash = nav;
    set({ nav });
  },
  openNotebook: (id) => set({ notebookId: id, stageTarget: undefined, nav: "Notebooks" }),
  openStageNotebook: (stage) => set({ stageTarget: stage, notebookId: undefined, nav: "Notebooks" }),
  selectPipelineVersion: (id) => set({ pipelineVersionId: id, runId: undefined, nodeId: undefined }),
  selectRun: (id) => set({ runId: id }),
  selectNode: (id) => set({ nodeId: id }),
  showRun: (pipelineVersionId, runId, nodeId) => set({ pipelineVersionId, runId, nodeId }),
  compare: [],
  setCompare: (compare) => set({ compare }),
}));

// Back and forward in the browser change the hash; follow them.
window.addEventListener("hashchange", () => {
  const nav = navFromHash();
  if (nav && useSelection.getState().nav !== nav) useSelection.setState({ nav });
});

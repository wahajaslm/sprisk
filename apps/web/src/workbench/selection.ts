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
  /** Number of unresolved items in the objective ledger (default 3 for intake demo). */
  objectiveOpenCount: number;
  setObjectiveOpenCount: (count: number) => void;
  /** Jump to a step of a run, e.g. right after saving a new version and starting it. */
  showRun: (pipelineVersionId: string, runId: string, nodeId?: string) => void;
};

export const useSelection = create<Selection>((set) => ({
  nav: "Objective",
  pipelineVersionId: undefined,
  runId: undefined,
  nodeId: undefined,
  notebookId: undefined,
  stageTarget: undefined,
  objectiveOpenCount: 3,
  setNav: (nav) => set({ nav }),
  openNotebook: (id) => set({ notebookId: id, stageTarget: undefined, nav: "Notebooks" }),
  openStageNotebook: (stage) => set({ stageTarget: stage, notebookId: undefined, nav: "Notebooks" }),
  selectPipelineVersion: (id) => set({ pipelineVersionId: id, runId: undefined, nodeId: undefined }),
  selectRun: (id) => set({ runId: id }),
  selectNode: (id) => set({ nodeId: id }),
  setObjectiveOpenCount: (count) => set({ objectiveOpenCount: count }),
  showRun: (pipelineVersionId, runId, nodeId) => set({ pipelineVersionId, runId, nodeId }),
  compare: [],
  setCompare: (compare) => set({ compare }),
}));

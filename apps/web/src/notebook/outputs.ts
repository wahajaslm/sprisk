import type { NotebookExecution } from "@sprisk/contracts";
import { create } from "zustand";

/** What one cell last ran in the kernel, and what came of it. */
export type Ran = { code: string; result: NotebookExecution };

/** Each cell's last run in this browser session (ADR-0036). Scratch: never saved, never
 * provenance; kept here so leaving the Notebooks page does not lose it. */
type Outputs = {
  byNotebook: Record<string, Record<string, Ran>>;
  set: (notebookId: string, cellId: string, ran: Ran) => void;
  clear: (notebookId: string) => void;
};

export const useOutputs = create<Outputs>((set) => ({
  byNotebook: {},
  // A restarted kernel holds nothing: every other cell's result no longer describes it.
  set: (notebookId, cellId, ran) =>
    set((s) => {
      const kept = ran.result.kernel_restarted ? {} : s.byNotebook[notebookId];
      return { byNotebook: { ...s.byNotebook, [notebookId]: { ...kept, [cellId]: ran } } };
    }),
  clear: (notebookId) => set((s) => ({ byNotebook: { ...s.byNotebook, [notebookId]: {} } })),
}));

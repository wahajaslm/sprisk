import type { NotebookExecution } from "@sprisk/contracts";
import { create } from "zustand";

/** Each cell's last result in this browser session (ADR-0036). Scratch: never saved, never
 * provenance; kept here so leaving the Notebooks page does not lose it. */
type Outputs = {
  byNotebook: Record<string, Record<string, NotebookExecution>>;
  set: (notebookId: string, cellId: string, result: NotebookExecution) => void;
  clear: (notebookId: string) => void;
};

export const useOutputs = create<Outputs>((set) => ({
  byNotebook: {},
  set: (notebookId, cellId, result) =>
    set((s) => ({ byNotebook: { ...s.byNotebook, [notebookId]: { ...s.byNotebook[notebookId], [cellId]: result } } })),
  clear: (notebookId) => set((s) => ({ byNotebook: { ...s.byNotebook, [notebookId]: {} } })),
}));

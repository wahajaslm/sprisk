import { create } from "zustand";

/** The two parts of a cell that fold on their own, as in VS Code. */
export type CellPart = "input" | "output";

export type Folded = Partial<Record<CellPart, boolean>>;

/** Which cell parts are collapsed, per notebook and cell. View state only: never saved, never
 * provenance (rule 9); kept here, like outputs, so leaving the Notebooks page does not lose it. */
type Collapsed = {
  byNotebook: Record<string, Record<string, Folded>>;
  toggle: (notebookId: string, cellId: string, part: CellPart) => void;
  setOutputsCollapsed: (notebookId: string, cellIds: string[], collapsed: boolean) => void;
};

export const useCollapsed = create<Collapsed>((set) => ({
  byNotebook: {},
  toggle: (notebookId, cellId, part) =>
    set((s) => {
      const cells = s.byNotebook[notebookId] ?? {};
      const folded = cells[cellId] ?? {};
      return { byNotebook: { ...s.byNotebook, [notebookId]: { ...cells, [cellId]: { ...folded, [part]: !folded[part] } } } };
    }),
  setOutputsCollapsed: (notebookId, cellIds, collapsed) =>
    set((s) => {
      const cells = { ...s.byNotebook[notebookId] };
      for (const id of cellIds) cells[id] = { ...cells[id], output: collapsed };
      return { byNotebook: { ...s.byNotebook, [notebookId]: cells } };
    }),
}));

import type { CellRange, NotebookVersion } from "@sprisk/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getList, getOne, postEmpty, postOne } from "./client.ts";

/** Each notebook's latest saved version (ADR-0036). */
export const useNotebooks = () => useQuery({ queryKey: ["notebooks"], queryFn: () => getList("NotebookVersion", "/notebooks?limit=200") });

/** Save a notebook version; the list shows it in place of the notebook's older one. */
export function useSaveNotebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: NotebookVersion) => postOne("NotebookVersion", "/notebook_versions", version),
    onSuccess: (saved) => {
      client.setQueryData<NotebookVersion[]>(["notebooks"], (list) => [saved, ...(list ?? []).filter((v) => v.notebook_id !== saved.notebook_id)]);
      void client.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });
}

/** Run one cell's code in the notebook's kernel. Its result is scratch, kept only on screen. */
export const executeCell = (notebookId: string, cellId: string, code: string) =>
  postOne("NotebookExecution", `/notebooks/${notebookId}/execute`, { cell_id: cellId, code });

export const interruptKernel = (notebookId: string) => postEmpty(`/notebooks/${notebookId}/interrupt`);

export const restartKernel = (notebookId: string) => postEmpty(`/notebooks/${notebookId}/restart`);

/** Which names the kernel holds, and which are tables (the values that cross a node boundary). */
export const kernelVariables = (notebookId: string, names: string[]) =>
  getOne("NotebookVariables", `/notebooks/${notebookId}/variables?names=${names.join(",")}`);

/** Python reads the code cells with the picked ones kept together (ADR-0036). Never runs them. */
export const splitPicked = (cells: string[], together: CellRange) => postOne("CodeSplit", "/code/split", { cells, together });

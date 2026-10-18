import type { CodeSplitRequest, NotebookExecute, NotebookVersion } from "@sprisk/contracts";
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
  postOne("NotebookExecution", `/notebooks/${notebookId}/execute`, { cell_id: cellId, code } satisfies NotebookExecute);

export const interruptKernel = (notebookId: string) => postEmpty(`/notebooks/${notebookId}/interrupt`);

export const restartKernel = (notebookId: string) => postEmpty(`/notebooks/${notebookId}/restart`);

/** Which names the kernel holds, and which are tables (the values that cross a node boundary). */
export const kernelVariables = (notebookId: string, names: string[]) =>
  getOne("NotebookVariables", `/notebooks/${notebookId}/variables?names=${names.join(",")}`);

/** Python reads a notebook's code cells into steps (ADR-0031, ADR-0037). It never runs them. */
export const splitNotebook = (cells: string[]) => postOne("CodeSplit", "/code/split", { cells } satisfies CodeSplitRequest);

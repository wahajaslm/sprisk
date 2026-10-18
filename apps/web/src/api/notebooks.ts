import type { CodeSplitRequest, DisplayItem, NotebookExecute, NotebookExecution, NotebookVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getList, getOne, jsonLines, postEmpty, postOne, postStreamed, problemText } from "./client.ts";

/** Each notebook's latest saved version (ADR-0036). */
export const useNotebooks = () => useQuery({ queryKey: ["notebooks"], queryFn: () => getList("NotebookVersion", "/notebooks?limit=200") });

/** Save a notebook version; the list shows it in place of the notebook's older one, or drops
 * the notebook when the version removes it (ADR-0041). */
export function useSaveNotebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: NotebookVersion) => postOne("NotebookVersion", "/notebook_versions", version),
    onSuccess: (saved) => {
      client.setQueryData<NotebookVersion[]>(["notebooks"], (list) => {
        const others = (list ?? []).filter((v) => v.notebook_id !== saved.notebook_id);
        return saved.removed ? others : [saved, ...others];
      });
      void client.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });
}

/** Run one cell's code in the notebook's kernel. Its result is scratch, kept only on screen.
 * While it runs, `running` gets every output so far (ADR-0041). */
export async function executeCell(
  notebookId: string,
  cellId: string,
  code: string,
  running: (outputs: DisplayItem[]) => void = () => {},
): Promise<NotebookExecution> {
  const response = await postStreamed(`/notebooks/${notebookId}/execute`, { cell_id: cellId, code } satisfies NotebookExecute);
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    return parse("NotebookExecution", await response.json());
  }
  for await (const line of jsonLines(response)) {
    const event = parse("NotebookExecutionEvent", line);
    if (event.kind === "running") running(event.outputs);
    else if (event.kind === "done") return event.execution;
    else throw new ApiError(response.status, problemText(event.problem) ?? "the cell failed");
  }
  throw new ApiError(response.status, "the kernel's answer ended before the cell did");
}

export const interruptKernel = (notebookId: string) => postEmpty(`/notebooks/${notebookId}/interrupt`);

export const restartKernel = (notebookId: string) => postEmpty(`/notebooks/${notebookId}/restart`);

/** Which names the kernel holds, and which are tables (the values that cross a node boundary). */
export const kernelVariables = (notebookId: string, names: string[]) =>
  getOne("NotebookVariables", `/notebooks/${notebookId}/variables?names=${names.join(",")}`);

/** Python reads a notebook's code cells into steps (ADR-0031, ADR-0037). It never runs them. */
export const splitNotebook = (cells: string[]) => postOne("CodeSplit", "/code/split", { cells } satisfies CodeSplitRequest);

import type { Attempt, CodeDisplay, CodeInterface, NotebookCodeRequest, NotebookSettingsRequest } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useMutation } from "@tanstack/react-query";

import { ApiError, artifactDownloadUrl, postOne } from "./client.ts";
import { useArtifactText, useOutputs } from "./hooks.ts";

/** Code output carries figures, so it may be larger than other JSON; still capped (rule 9). */
const MAX_CODE_DISPLAY_BYTES = 4 * 1024 * 1024;

export type Read<T> =
  | { status: "none"; reason: string; download?: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

/** One JSON report an attempt wrote on `port`, parsed through its contract. */
export function useReport<T>(attempt: Attempt | undefined, port: string, parseIt: (raw: unknown) => T, limit: number): Read<T> {
  const outputs = useOutputs(attempt?.id);
  const artifact = outputs.data?.find((o) => o.port === port)?.artifact;
  const small = artifact !== undefined && artifact.size_bytes <= limit;
  const text = useArtifactText(small ? artifact.id : undefined);
  if (!attempt) return { status: "none", reason: "Run the step first." };
  if (outputs.isError) return { status: "error", message: outputs.error.message };
  if (outputs.isPending) return { status: "loading" };
  if (!artifact) return { status: "none", reason: "This step's version does not report it. Edit and run it to upgrade." };
  if (!small) {
    // Never fetched into the page; the server serves it as a file download (ADR-0027, ADR-0029).
    const mb = Math.round(artifact.size_bytes / (1024 * 1024));
    return { status: "none", reason: `Too large to draw here (${mb} MB).`, download: artifactDownloadUrl(artifact.id) };
  }
  if (text.isError) return { status: "error", message: text.error.message };
  if (text.data === undefined) return { status: "loading" };
  try {
    return { status: "ready", value: parseIt(JSON.parse(text.data)) };
  } catch (e) {
    return { status: "error", message: `Unreadable ${port} report ${artifact.id}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** What a code step showed: printed text, tables and figures, in order. */
export const useCodeDisplay = (attempt: Attempt | undefined): Read<CodeDisplay> =>
  useReport(attempt, "display", (raw) => parse("CodeDisplay", raw), MAX_CODE_DISPLAY_BYTES);

/** What a code step's run found about its interface (ADR-0021). */
export const useCodeInterface = (attempt: Attempt | undefined): Read<CodeInterface> =>
  useReport(attempt, "interface", (raw) => parse("CodeInterface", raw), 1024 * 1024);

/** What any step printed and warned (ADR-0025). Absent when it printed nothing. */
export const useConsole = (attempt: Attempt | undefined): Read<CodeDisplay> =>
  useReport(attempt, "console", (raw) => parse("CodeDisplay", raw), 1024 * 1024);

/** Python reads notebook cells into suggested code steps (ADR-0031). It never runs them. */
export const useSplitCells = () =>
  useMutation({ mutationFn: (cells: string[]) => postOne("CodeSplit", "/code/split", { cells }) });

/** What an edited ready-made cell is (ADR-0055): the step with the settings it states, when
 * only values changed, or code. */
export const useReadSettings = () =>
  useMutation({
    mutationFn: ({ operator, request }: { operator: string; request: NotebookSettingsRequest }) =>
      postOne("NotebookSettings", `/operators/${encodeURIComponent(operator)}/notebook_settings`, request),
  });

/** A ready-made step as plain Python for its notebook cell (ADR-0055); null while the step has
 * none yet. */
export const plainCodeQuery = (operator: string, request: NotebookCodeRequest) => ({
  queryKey: ["notebook_code", operator, request],
  queryFn: async (): Promise<string | null> => {
    try {
      return (await postOne("NotebookCode", `/operators/${encodeURIComponent(operator)}/notebook_code`, request)).code;
    } catch (e) {
      if (e instanceof ApiError && e.errors.some((x) => x.code === "no_plain_code")) return null;
      throw e;
    }
  },
  staleTime: Infinity,
});

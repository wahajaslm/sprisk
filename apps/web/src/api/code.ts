import type { Attempt, CodeDisplay, CodeInterface } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { useArtifactText, useOutputs } from "./hooks.ts";

/** Code output carries figures, so it may be larger than other JSON; still capped (rule 9). */
const MAX_CODE_DISPLAY_BYTES = 4 * 1024 * 1024;

export type Read<T> =
  | { status: "none"; reason: string }
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
  if (!small) return { status: "none", reason: `Too large to show here (${artifact.size_bytes} bytes).` };
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

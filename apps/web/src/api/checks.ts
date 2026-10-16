import type { Attempt, MethodologyCheck } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { useArtifactText, useOutputs } from "./hooks.ts";

export type RunChecks =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; checks: MethodologyCheck[] };

/** The methodology checks the run's gate attempt emitted (ADR-0017). */
export function useRunChecks(gate: Attempt | undefined): RunChecks {
  const ran = gate?.state === "succeeded";
  const outputs = useOutputs(ran ? gate.id : undefined);
  const text = useArtifactText(outputs.data?.find((o) => o.port === "checks")?.artifact.id);
  if (outputs.isError) return { status: "error", message: outputs.error.message };
  if (text.isError) return { status: "error", message: text.error.message };
  if (!ran) return { status: "none" };
  if (text.data === undefined) return { status: "loading" };
  try {
    const raw: unknown = JSON.parse(text.data);
    if (!Array.isArray(raw)) throw new Error("expected a list of checks");
    return { status: "ready", checks: raw.map((c) => parse("MethodologyCheck", c)) };
  } catch (e) {
    return { status: "error", message: `Unreadable methodology checks: ${e instanceof Error ? e.message : String(e)}` };
  }
}

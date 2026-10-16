import type { PipelineVersion } from "@sprisk/contracts";

import { useSaveAndRun } from "../../api/hooks.ts";
import { setParams } from "../../flow/edit.ts";
import { useSelection } from "../../workbench/selection.ts";

/** Save a step with new params as a new version, run it, and keep showing that step.
 * Rust compiles and checks the version; its errors come back on `error` (rule 3). */
export function useRunEdit(pipeline: PipelineVersion, nodeId: string) {
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);
  const run = (params: Record<string, unknown>) => {
    const version = setParams(pipeline, nodeId, params);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };
  return { run, pending: saveAndRun.isPending, error: saveAndRun.isError ? saveAndRun.error.message : undefined };
}

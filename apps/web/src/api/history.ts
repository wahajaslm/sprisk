import type { Attempt, Run } from "@sprisk/contracts";

import { useRuns } from "./hooks.ts";
import { useRunNodes } from "./runs.ts";

/** How many recent runs history covers. */
const HISTORY_RUNS = 8;

export type NodeRun = {
  run: Run;
  attempts: Attempt[];
  metrics: Record<string, number> | undefined;
};

/** One step across the latest runs of a pipeline version, newest first. */
export function useNodeHistory(pipelineVersionId: string | undefined, nodeId: string): NodeRun[] {
  const runs = (useRuns(pipelineVersionId).data ?? []).slice(0, HISTORY_RUNS);
  const nodes = useRunNodes(runs, [nodeId]);
  return runs.map((run, i) => ({ run, attempts: nodes[i]?.[nodeId]?.attempts ?? [], metrics: nodes[i]?.[nodeId]?.metrics }));
}

import type { PipelineVersion } from "@sprisk/contracts";
import { create } from "zustand";

import { useRunAgain, useSaveAndRun } from "../../api/hooks.ts";
import { readersOf, removeStep } from "../../flow/edit.ts";
import { useSelection } from "../../workbench/selection.ts";

type CanvasNotice = { notice: string | undefined; say: (notice: string | undefined) => void };

/** One message the canvas shows: why a step action was refused, or why it failed. */
export const useCanvasNotice = create<CanvasNotice>((set) => ({ notice: undefined, say: (notice) => set({ notice }) }));

/** Run from a step and delete it, the same way from its buttons, its keys and the canvas. */
export function useStepActions(pipeline: PipelineVersion | undefined) {
  const { pipelineVersionId, runId, selectNode, showRun } = useSelection();
  const saveAndRun = useSaveAndRun(runId);
  const runAgain = useRunAgain(runId);
  const say = useCanvasNotice((s) => s.say);
  const failed = (error: Error) => say(error.message);

  // Steps are pure: finished ones before this step are reused from the run on screen (ADR-0026),
  // and the step and what reads it run if they are not done.
  const runFrom = () => {
    if (!pipelineVersionId) return;
    say(undefined);
    runAgain.mutate(pipelineVersionId, { onSuccess: (r) => showRun(pipelineVersionId, r.id), onError: failed });
  };

  const remove = (nodeId: string) => {
    if (!pipeline) return;
    const readers = readersOf(pipeline, nodeId);
    if (readers.length > 0) {
      say(`${nodeId} is read by ${readers.join(", ")}: remove those first.`);
      return;
    }
    say(undefined);
    const next = removeStep(pipeline, nodeId);
    saveAndRun.mutate(next, {
      onSuccess: (r) => {
        selectNode(undefined);
        showRun(next.id, r.id);
      },
      onError: failed,
    });
  };

  return { runFrom, remove, readers: (nodeId: string) => (pipeline ? readersOf(pipeline, nodeId) : []) };
}

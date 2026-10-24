import type { PipelineVersion } from "@sprisk/contracts";
import { create } from "zustand";

import { useRunFrom, useSaveAndRun } from "../../api/hooks.ts";
import { readersOf, removeStep } from "../../flow/edit.ts";
import { useSelection } from "../../workbench/selection.ts";

type CanvasNotice = { notice: string | undefined; say: (notice: string | undefined) => void };

/** One message the canvas shows: why a step action was refused, or why it failed. */
export const useCanvasNotice = create<CanvasNotice>((set) => ({ notice: undefined, say: (notice) => set({ notice }) }));

/** Run from a step and delete it, the same way from its buttons, its keys and the menu. */
export function useStepActions(pipeline: PipelineVersion | undefined) {
  const { pipelineVersionId, runId, selectNode, showRun } = useSelection();
  const saveAndRun = useSaveAndRun(runId);
  const runFromStep = useRunFrom(runId);
  const say = useCanvasNotice((s) => s.say);
  const failed = (error: Error) => say(error.message);

  // The step and every step after it run again; the steps before it are reused from the run
  // on screen (ADR-0026 amendment).
  const runFrom = (nodeId: string) => {
    if (!pipelineVersionId) return;
    say(undefined);
    runFromStep.mutate(
      { pipelineVersionId, nodeId },
      { onSuccess: (r) => showRun(pipelineVersionId, r.id), onError: failed },
    );
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

  const pending = saveAndRun.isPending || runFromStep.isPending;
  return { runFrom, remove, pending, readers: (nodeId: string) => (pipeline ? readersOf(pipeline, nodeId) : []) };
}

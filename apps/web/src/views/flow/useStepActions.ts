import type { PipelineVersion } from "@sprisk/contracts";
import { create } from "zustand";

import { useRunAgain, useSaveAndRun } from "../../api/hooks.ts";
import { readersOf, removeStep } from "../../flow/edit.ts";
import { useSelection } from "../../workbench/selection.ts";

type CanvasNotice = { notice: string | undefined; say: (notice: string | undefined) => void };

/** One message the canvas shows: why a step action was refused, or why it failed. */
export const useCanvasNotice = create<CanvasNotice>((set) => ({ notice: undefined, say: (notice) => set({ notice }) }));

/** Run what is not done and delete a step, the same way from its buttons, its keys and the menu. */
export function useStepActions(pipeline: PipelineVersion | undefined) {
  const { pipelineVersionId, runId, selectNode, showRun } = useSelection();
  const saveAndRun = useSaveAndRun(runId);
  const runAgain = useRunAgain(runId);
  const say = useCanvasNotice((s) => s.say);
  const failed = (error: Error) => say(error.message);

  // Steps are pure: every finished step of the run on screen is reused (ADR-0026), so only the
  // steps not done run. The API cannot start a run at one step.
  const runUnfinished = () => {
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

  const pending = saveAndRun.isPending || runAgain.isPending;
  return { runUnfinished, remove, pending, readers: (nodeId: string) => (pipeline ? readersOf(pipeline, nodeId) : []) };
}

import type { Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useSplitCells } from "../api/code.ts";
import { useSaveAndRun } from "../api/hooks.ts";
import { type NotebookStep, splitRequest, versionFromSplit } from "../flow/notebook.ts";
import { useViewSelection } from "../workbench/instance.tsx";
import { useSelection } from "../workbench/selection.ts";

/** Save edited notebook cells as the next version and run it from the edited step
 * (ADR-0033). Python reads the links first (POST /code/split); Rust compiles the version. The
 * notebook view and a code step's Code tab both save this way, so both views stay one flow. */
export function useSaveCells(pipeline: PipelineVersion, operators: Map<string, Operator>) {
  const split = useSplitCells();
  const saveAndRun = useSaveAndRun(useViewSelection().runId);
  const showRun = useSelection((s) => s.showRun);
  const [problem, setProblem] = useState<string | undefined>();
  const [notes, setNotes] = useState<string[]>([]);

  /** Saves `steps`, then shows the step that holds cell number `show` (counted from 0). `base`
   * is the flow with the code its own-code cells now hold (default: the flow as saved). */
  const save = async (steps: NotebookStep[], show: number | undefined, base: PipelineVersion = pipeline) => {
    setProblem(undefined);
    try {
      const request = splitRequest(base, operators, steps);
      const found = await split.mutateAsync(request.cells);
      const { version, notes, cellNodes } = versionFromSplit(base, operators, request, found);
      setNotes(notes);
      const run = await saveAndRun.mutateAsync(version);
      showRun(version.id, run.id, show === undefined ? undefined : cellNodes[show]);
    } catch (e) {
      // Shown next to the cells, where the person can fix them.
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return { save, pending: split.isPending || saveAndRun.isPending, problem, notes };
}

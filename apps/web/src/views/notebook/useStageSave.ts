import type { NotebookCell, Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useReadSettings, useSplitCells } from "../../api/code.ts";
import { useRunAgain, useSaveAndRun } from "../../api/hooks.ts";
import { nodeOf, splitRequest, versionFromSplit } from "../../flow/notebook.ts";
import { type Stage, stepLabel } from "../../flow/stages.ts";
import { codeRequest, editedReadyMade, newStepsIn, stageCells, stageEdits, withSettings } from "../../notebook/stageCells.ts";
import { useSelection } from "../../workbench/selection.ts";

/** Save a stage's cells as the next flow version when they changed, then run it, reusing
 * unchanged steps (ADR-0026, ADR-0055). The stage notebook and a step's Code tab both save
 * this way, so a cell and its node never disagree. `code` holds ready-made steps' plain Python. */
export function useStageSave(pipeline: PipelineVersion, byRef: Map<string, Operator>, stage: Stage, code: Map<string, string>) {
  const runId = useSelection((s) => s.runId);
  const showRun = useSelection((s) => s.showRun);
  const split = useSplitCells();
  const readSettings = useReadSettings();
  const saveAndRun = useSaveAndRun(runId);
  const runAgain = useRunAgain(runId);
  const [problem, setProblem] = useState<string>();
  const [notes, setNotes] = useState<string[]>([]);

  const save = async (now: NotebookCell[], show: string | undefined) => {
    setProblem(undefined);
    try {
      // Cells as the flow has them: run it again, no new version.
      if (sameCells(now, stageCells(pipeline, byRef, stage, code))) {
        const run = await runAgain.mutateAsync(pipeline.id);
        return showRun(pipeline.id, run.id, show);
      }
      // An edit that only changes values keeps the step, with those settings, and its checks.
      let flow = pipeline;
      const known = new Map(code);
      const converted: string[] = [];
      for (const id of editedReadyMade(pipeline, now, code)) {
        const node = nodeOf(pipeline, id);
        const source = now.find((c) => c.id === id)!.source;
        const read = await readSettings.mutateAsync({ operator: node.operator, request: { ...codeRequest(pipeline, byRef, id), code: source } });
        if (read.reads_as === "settings") {
          flow = withSettings(flow, id, read.settings);
          known.set(id, source);
        } else {
          const kind = stepLabel(node).title;
          converted.push(`${id} is now your own Python code. The methodology checks for ${/^[AEIOU]/.test(kind) ? "an" : "a"} ${kind} step no longer cover it.`);
        }
      }
      const edits = stageEdits(flow, byRef, stage, now, known);
      if ("refused" in edits) return setProblem(edits.refused);
      const request = splitRequest(edits.base, byRef, edits.steps);
      const found = await split.mutateAsync(request.cells);
      const made = versionFromSplit(edits.base, byRef, request, found);
      setNotes([...converted, ...made.notes]);
      const version = newStepsIn(made.version, pipeline, stage);
      const run = await saveAndRun.mutateAsync(version);
      showRun(version.id, run.id, show);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return { save, busy: readSettings.isPending || split.isPending || saveAndRun.isPending || runAgain.isPending, problem, setProblem, notes };
}

/** Equal but for empty cells the person added and never wrote in. */
function sameCells(now: NotebookCell[], flow: NotebookCell[]) {
  const written = now.filter((c) => c.source.trim() !== "" || flow.some((f) => f.id === c.id));
  return JSON.stringify(written.map((c) => [c.id, c.kind, c.source])) === JSON.stringify(flow.map((c) => [c.id, c.kind, c.source]));
}

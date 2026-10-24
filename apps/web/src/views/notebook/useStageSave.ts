import type { NotebookCell, Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useReadSettings, useSplitCells } from "../../api/code.ts";
import { useRunAgain, useSaveAndRun } from "../../api/hooks.ts";
import { nodeOf, splitRequest, versionFromSplit } from "../../flow/notebook.ts";
import { stepLabel } from "../../flow/stages.ts";
import { codeRequest, editedReadyMade, newStepsIn, stageCells, stageEdits, withSettings } from "../../notebook/stageCells.ts";
import type { Section } from "../../notebook/stageNotebooks.ts";
import { useSelection } from "../../workbench/selection.ts";

/** Save a section's cells as the next flow version when they changed, then run it, reusing
 * unchanged steps (ADR-0026, ADR-0055). The section notebook and a step's Code tab both save
 * this way, so a cell and its node never disagree. `code` holds ready-made steps' plain Python. */
export function useStageSave(pipeline: PipelineVersion, byRef: Map<string, Operator>, section: Section, code: Map<string, string>) {
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
      if (sameCells(now, stageCells(section, code))) {
        const run = await runAgain.mutateAsync(pipeline.id);
        return showRun(pipeline.id, run.id, show);
      }
      // An edit that only changes values keeps the step, with those settings, and its checks.
      let flow = pipeline;
      const known = new Map(code);
      const converted: string[] = [];
      for (const { id, source } of editedReadyMade(pipeline, now, code)) {
        const node = nodeOf(pipeline, id);
        const read = await readSettings.mutateAsync({ operator: node.operator, request: { ...codeRequest(pipeline, byRef, id), code: source } });
        if (read.reads_as === "settings") {
          flow = withSettings(flow, id, read.settings);
          known.set(id, source);
        } else {
          converted.push(`${id} is now your own Python code. The methodology checks for ${stepLabel(node, byRef.get(node.operator)).title} steps no longer cover it.`);
        }
      }
      const edits = stageEdits(flow, byRef, section.name, now, known);
      if ("refused" in edits) return setProblem(edits.refused);
      const request = splitRequest(edits.base, byRef, edits.steps);
      const found = await split.mutateAsync(request.cells);
      const made = versionFromSplit(edits.base, byRef, request, found);
      setNotes([...converted, ...made.notes]);
      const version = newStepsIn(made.version, pipeline, section.home);
      const run = await saveAndRun.mutateAsync(version);
      showRun(version.id, run.id, show);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  /** Save `version` as it is and run it, as deleting a step does. */
  const saveVersion = async (version: PipelineVersion) => {
    setProblem(undefined);
    try {
      const run = await saveAndRun.mutateAsync(version);
      showRun(version.id, run.id, undefined);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return { save, saveVersion, busy: readSettings.isPending || split.isPending || saveAndRun.isPending || runAgain.isPending, problem, setProblem, notes };
}

/** Equal but for empty cells the person added and never wrote in. */
function sameCells(now: NotebookCell[], flow: NotebookCell[]) {
  const written = now.filter((c) => c.source.trim() !== "" || flow.some((f) => f.id === c.id));
  return JSON.stringify(written.map((c) => [c.id, c.kind, c.source])) === JSON.stringify(flow.map((c) => [c.id, c.kind, c.source]));
}

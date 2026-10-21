import type { Node, NotebookCell, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../flow/edit.ts";
import { isNotebookStep, type NotebookStep, notebookSteps, withSource } from "../flow/notebook.ts";
import type { Stage } from "../flow/stages.ts";
import { stageNotebooks } from "./stageNotebooks.ts";

type Operators = Map<string, Operator>;

const STAGE_KEY: Record<Stage, NonNullable<Node["stage"]> | undefined> = {
  Explore: "explore",
  Split: "split",
  Clean: "clean",
  Model: "model",
  Evaluate: "evaluate",
  Unknown: undefined,
};

const stageNodes = (pipeline: PipelineVersion, operators: Operators, stage: Stage) =>
  stageNotebooks(pipeline, operators).find((s) => s.stage === stage)?.nodes ?? [];

/** A stage's cells, read from the flow (ADR-0055): each step's notes as Markdown around one
 * code cell named by the step. A code step's cell holds its code; a ready-made step's holds
 * none, since its cell shows its settings form. */
export function stageCells(pipeline: PipelineVersion, operators: Operators, stage: Stage): NotebookCell[] {
  return stageNodes(pipeline, operators, stage).flatMap((node) => [
    ...(node.notes?.before ?? []).map((source, k): NotebookCell => ({ id: `${node.id}-before-${k}`, kind: "markdown", source })),
    { id: node.id, kind: "code" as const, source: isCodeOperator(node.operator) ? String(node.params["source"] ?? "") : "" },
    ...(node.notes?.after ?? []).map((source, k): NotebookCell => ({ id: `${node.id}-after-${k}`, kind: "markdown", source })),
  ]);
}

/** Whether a cell is a ready-made step of the flow: shown as its form, never as code. */
export const isReadyMade = (pipeline: PipelineVersion, cellId: string) => {
  const node = pipeline.nodes.find((n) => n.id === cellId);
  return node !== undefined && !isCodeOperator(node.operator);
};

/** The flow with a stage's cells as edited: Markdown kept as the notes of the step below it
 * (after the last step for text at the end), edited code in its step, and each new code cell
 * as a new step right after the step above it. `steps` go to Python to read their links
 * (POST /code/split); `base` holds the notes and v1 code edits. Steps whose cells were
 * deleted are removed when deleted, not here. */
export function stageEdits(
  pipeline: PipelineVersion,
  operators: Operators,
  stage: Stage,
  cells: NotebookCell[],
): { base: PipelineVersion; steps: NotebookStep[] } | { refused: string } {
  const ids = new Set(pipeline.nodes.map((n) => n.id));
  const stepCells = cells.filter((c) => c.kind === "code" && ids.has(c.id));
  const notes = new Map<string, { before: string[]; after: string[] }>(stepCells.map((c) => [c.id, { before: [], after: [] }]));
  let waiting: string[] = [];
  for (const cell of cells) {
    if (cell.kind === "markdown") waiting.push(cell.source);
    else if (ids.has(cell.id)) {
      notes.get(cell.id)!.before.push(...waiting);
      waiting = [];
    }
  }
  const last = stepCells.at(-1);
  if (waiting.length > 0 && !last) return { refused: `Text in ${stage} needs a step in the same notebook to stay with.` };
  if (last) notes.get(last.id)!.after.push(...waiting);

  const sources = new Map(stepCells.filter((c) => isCodeOperator(pipeline.nodes.find((n) => n.id === c.id)!.operator)).map((c) => [c.id, c.source]));
  const base: PipelineVersion = {
    ...pipeline,
    nodes: pipeline.nodes.map((n) => {
      const kept = notes.get(n.id);
      const { notes: _old, ...rest } = n;
      const withNotes: Node = kept && (kept.before.length > 0 || kept.after.length > 0) ? { ...rest, notes: noteFields(kept) } : kept ? rest : n;
      const source = sources.get(n.id);
      // A v1 code step keeps its code in params; a v2 step's code goes through Python below.
      return source !== undefined && !isNotebookStep(n.operator) ? { ...withNotes, params: { ...withNotes.params, source } } : withNotes;
    }),
  };

  let steps = notebookSteps(base, operators);
  for (const [id, source] of sources) if (isNotebookStep(base.nodes.find((n) => n.id === id)!.operator)) steps = withSource(steps, id, source);
  // New cells go right after the step cell above them, in order; at the top, before the stage.
  const first = stepCells[0]?.id;
  let at = first !== undefined ? steps.findIndex((s) => s.nodeId === first) : steps.length;
  for (const cell of cells) {
    if (cell.kind !== "code") continue;
    if (ids.has(cell.id)) {
      at = steps.findIndex((s) => s.nodeId === cell.id) + 1;
      continue;
    }
    if (cell.source.trim() === "") continue;
    steps = [...steps.slice(0, at), { kind: "cells", nodeId: undefined, cells: [cell.source] }, ...steps.slice(at)];
    at += 1;
  }
  return { base, steps };
}

const noteFields = ({ before, after }: { before: string[]; after: string[] }) => ({
  ...(before.length > 0 ? { before } : {}),
  ...(after.length > 0 ? { after } : {}),
});

/** `made` with each step it has and `before` had not placed in `stage`, so a cell added to
 * a stage's notebook stays in that notebook. */
export function newStepsIn(made: PipelineVersion, before: PipelineVersion, stage: Stage): PipelineVersion {
  const old = new Set(before.nodes.map((n) => n.id));
  const key = STAGE_KEY[stage];
  return { ...made, nodes: made.nodes.map((n) => (old.has(n.id) || !key ? n : { ...n, stage: key })) };
}

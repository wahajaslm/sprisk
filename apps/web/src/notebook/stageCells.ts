import type { Node, NotebookCell, NotebookCodeRequest, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../flow/edit.ts";
import { isNotebookStep, nodeOf, NOTEBOOK_OPERATOR, type NotebookStep, notebookSteps, outputName, withSource } from "../flow/notebook.ts";
import { portOf, stepOf } from "../flow/ports.ts";
import type { Stage } from "../flow/stages.ts";
import type { Section } from "./stageNotebooks.ts";

type Operators = Map<string, Operator>;

const STAGE_KEY: Record<Stage, NonNullable<Node["stage"]> | undefined> = {
  Load: "load",
  Split: "split",
  Explore: "explore",
  Clean: "clean",
  // Node.stage has no features value yet; a cell added there keeps its operator's stage.
  Features: undefined,
  Model: "model",
  Evaluate: "evaluate",
  Unknown: undefined,
};

/** A section's cells, read from the flow (ADR-0055): each step's notes as Markdown around one
 * code cell named by the step. A code step's cell holds its code; a ready-made step's holds
 * its plain Python (`code`, by step), or nothing when it has none yet and shows its form. */
export function stageCells(section: Section, code: Map<string, string> = new Map()): NotebookCell[] {
  return section.nodes.flatMap((node) => [
    ...(node.notes?.before ?? []).map((source, k): NotebookCell => ({ id: `${node.id}-before-${k}`, kind: "markdown", source })),
    { id: node.id, kind: "code" as const, source: isCodeOperator(node.operator) ? String(node.params["source"] ?? "") : (code.get(node.id) ?? "") },
    ...(node.notes?.after ?? []).map((source, k): NotebookCell => ({ id: `${node.id}-after-${k}`, kind: "markdown", source })),
  ]);
}

/** Whether a cell is a ready-made step of the flow. */
export const isReadyMade = (pipeline: PipelineVersion, cellId: string) => {
  const node = pipeline.nodes.find((n) => n.id === cellId);
  return node !== undefined && !isCodeOperator(node.operator);
};

/** Ready-made steps whose plain Python (`code`) a person edited in `cells`. */
export const editedReadyMade = (pipeline: PipelineVersion, cells: NotebookCell[], code: Map<string, string>) =>
  cells.filter((c) => c.kind === "code" && isReadyMade(pipeline, c.id) && code.has(c.id) && c.source !== code.get(c.id));

/** `pipeline` with step `id` running on `settings`; everything else about it stays. */
export const withSettings = (pipeline: PipelineVersion, id: string, settings: Node["params"]): PipelineVersion => ({
  ...pipeline,
  nodes: pipeline.nodes.map((n) => (n.id === id ? { ...n, params: settings } : n)),
});

/** The flow with a stage's cells as edited: Markdown kept as the notes of the step below it
 * (after the last step for text at the end), edited code in its step, and each new code cell
 * as a new step right after the step above it. `steps` go to Python to read their links
 * (POST /code/split); `base` holds the notes and v1 code edits. A ready-made step whose plain
 * Python (`code`) was edited becomes a code step running the edited code. Steps whose cells
 * were deleted are removed when deleted, not here. */
export function stageEdits(
  pipeline: PipelineVersion,
  operators: Operators,
  stage: string,
  cells: NotebookCell[],
  code: Map<string, string> = new Map(),
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

  const edited = new Set(stepCells.filter((c) => code.has(c.id) && c.source !== code.get(c.id)).map((c) => c.id));
  const sources = new Map(stepCells.filter((c) => edited.has(c.id) || isCodeOperator(pipeline.nodes.find((n) => n.id === c.id)!.operator)).map((c) => [c.id, c.source]));
  const owned = asCodeSteps(pipeline, edited);
  const base: PipelineVersion = {
    ...owned,
    nodes: owned.nodes.map((n) => {
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

/** `pipeline` with each step in `ids` as a code step: Python links what its code reads, and
 * the steps that read its outputs read them by the names its code set (ADR-0055). */
function asCodeSteps(pipeline: PipelineVersion, ids: Set<string>): PipelineVersion {
  if (ids.size === 0) return pipeline;
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((n) => (ids.has(n.id) ? { id: n.id, operator: NOTEBOOK_OPERATOR, params: { source: "", inputs: [], outputs: [] }, ...(n.stage ? { stage: n.stage } : {}), ...(n.notes ? { notes: n.notes } : {}) } : n)),
    edges: pipeline.edges
      .filter((e) => !ids.has(stepOf(e.to)))
      .map((e) => (ids.has(stepOf(e.from)) ? { ...e, from: `${stepOf(e.from)}.${outputName(pipeline, e.from)}` } : e)),
  };
}

const noteFields = ({ before, after }: { before: string[]; after: string[] }) => ({
  ...(before.length > 0 ? { before } : {}),
  ...(after.length > 0 ? { after } : {}),
});

/** `made` with each step it has and `before` had not placed in `stage`, so a cell added to
 * a stage's notebook stays in that notebook. A section's `home` is the stage to pass. */
export function newStepsIn(made: PipelineVersion, before: PipelineVersion, stage: Stage): PipelineVersion {
  const old = new Set(before.nodes.map((n) => n.id));
  const key = STAGE_KEY[stage];
  return { ...made, nodes: made.nodes.map((n) => (old.has(n.id) || !key ? n : { ...n, stage: key })) };
}

/** What a ready-made step's plain Python is written from: its settings and the variables its
 * ports go by, as cells read and set them. */
export function codeRequest(pipeline: PipelineVersion, byRef: Operators, nodeId: string): NotebookCodeRequest {
  const node = nodeOf(pipeline, nodeId);
  const inputs = Object.fromEntries(pipeline.edges.filter((e) => stepOf(e.to) === nodeId).map((e) => [portOf(e.to), outputName(pipeline, e.from)]));
  const ports = byRef.get(node.operator)?.outputs.map((o) => String(o.name)) ?? [];
  const outputs = Object.fromEntries(ports.map((p) => [p, outputName(pipeline, `${nodeId}.${p}`)]));
  return { settings: node.params, inputs, outputs };
}


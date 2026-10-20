import type { CodeSplit, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator, nextVersion } from "./edit.ts";
import { portOf, stepOf } from "./ports.ts";

/** The code step whose ports are variable names (ADR-0031). */
export const NOTEBOOK_OPERATOR = "sprisk.code.python@2.0.0";

/** Ports a step's params name (ADR-0031), as the compiler adds them: tables, listed under a
 * setting marked `x-sprisk-ports`. */
export function namedPorts(operator: Operator | undefined, params: Record<string, unknown> | undefined, side: "input" | "output"): string[] {
  const properties = operator?.params_schema["properties"];
  if (typeof properties !== "object" || properties === null || !params) return [];
  const key = Object.entries(properties).find(([, schema]) => typeof schema === "object" && schema !== null && schema["x-sprisk-ports"] === side)?.[0];
  const names = key === undefined ? undefined : params[key];
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
}

type Node = PipelineVersion["nodes"][number];
type Operators = Map<string, Operator>;

export const isNotebookStep = (ref: string) => ref.startsWith("sprisk.code.python@2.");


/** Steps in the order a notebook shows them (ADR-0033): each after the steps it reads, and
 * otherwise in saved order, so an imported notebook keeps its cell order. */
export function notebookOrder(pipeline: PipelineVersion): Node[] {
  const done = new Set<string>();
  const order: Node[] = [];
  const ready = (n: Node) => !done.has(n.id) && pipeline.edges.every((e) => stepOf(e.to) !== n.id || done.has(stepOf(e.from)));
  while (order.length < pipeline.nodes.length) {
    const next = pipeline.nodes.find(ready);
    // The compiler rejects cycles, so a saved version always has an order.
    if (!next) throw new Error(`flow ${pipeline.id} has a cycle`);
    done.add(next.id);
    order.push(next);
  }
  return order;
}

/** One step of a flow as the notebook shows it: a code step's cells, a v1 code step's code
 * with the table it gets as `data`, or a built-in step's call. */
export type NotebookStep =
  | { kind: "cells"; nodeId: string | undefined; cells: string[] }
  | { kind: "code"; nodeId: string; source: string; data: string | undefined }
  | { kind: "builtin"; nodeId: string; call: string };

export function notebookSteps(pipeline: PipelineVersion, operators: Operators): NotebookStep[] {
  return notebookOrder(pipeline).map((node) => {
    const source = String(node.params["source"] ?? "");
    if (isNotebookStep(node.operator)) return { kind: "cells", nodeId: node.id, cells: splitOnMarkers(source) };
    if (isCodeOperator(node.operator)) {
      return { kind: "code", nodeId: node.id, source, data: inputsOf(pipeline, node.id).find((i) => i.port === "data")?.name };
    }
    return { kind: "builtin", nodeId: node.id, call: callOf(pipeline, operators, node) };
  });
}

/** The name an output goes by where it is read: a code step's variable, or `<step>_<port>`. */
function outputName(pipeline: PipelineVersion, end: string): string {
  const node = pipeline.nodes.find((n) => n.id === stepOf(end));
  return node && isNotebookStep(node.operator) ? portOf(end) : `${stepOf(end)}_${portOf(end)}`;
}

/** Every name a non-notebook step's output goes by: `<step>_<port>`, and each name a code step
 * reads it as. */
function outputNames(pipeline: PipelineVersion, nodeId: string, port: string): string[] {
  const end = `${nodeId}.${port}`;
  const readers = pipeline.edges.filter((e) => e.from === end && isNotebookStep(nodeOf(pipeline, stepOf(e.to)).operator));
  return [...new Set([`${nodeId}_${port}`, ...readers.map((e) => portOf(e.to))])];
}

function outputPorts(pipeline: PipelineVersion, operators: Operators, node: Node): string[] {
  const operator = operators.get(node.operator);
  if (operator) return operator.outputs.map((o) => o.name);
  return [...new Set(pipeline.edges.filter((e) => stepOf(e.from) === node.id).map((e) => portOf(e.from)))];
}

const inputsOf = (pipeline: PipelineVersion, nodeId: string) =>
  pipeline.edges.filter((e) => stepOf(e.to) === nodeId).map((e) => ({ port: portOf(e.to), name: outputName(pipeline, e.from) }));

export function nodeOf(pipeline: PipelineVersion, id: string): Node {
  const node = pipeline.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`flow ${pipeline.id} has no step ${id}`);
  return node;
}

/** A JSON value spelled as Python. JSON's numbers and quoted text are valid Python already. */
function python(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(python).join(", ")}]`;
  if (typeof value === "object") return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${python(v)}`).join(", ")}}`;
  return JSON.stringify(value);
}

/** A built-in step as the Python that runs it: inputs and settings in by name, each output
 * out by name, as the worker calls it (ADR-0022). */
function callOf(pipeline: PipelineVersion, operators: Operators, node: Node): string {
  const operator = operators.get(node.operator);
  if (!operator) return `# operator ${node.operator} is not installed`;
  const fn = node.code?.function ?? node.id;
  const properties = (operator.params_schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const args = [
    ...inputsOf(pipeline, node.id).map((i) => `${i.port}=${i.name}`),
    ...Object.entries(node.params).map(([k, v]) => `${k}=${properties[k]?.["x-sprisk-local-path"] === true ? `Path(${python(v)})` : python(v)}`),
  ];
  const call = `${fn}(${args.join(", ")})`;
  const ports = outputPorts(pipeline, operators, node);
  const [only] = ports;
  if (ports.length === 0) return call;
  if (ports.length === 1 && only !== undefined) return `${outputNames(pipeline, node.id, only).join(" = ")} = ${call}`;
  const result = `${node.id}_out`;
  return [`${result} = ${call}`, ...ports.map((p) => `${outputNames(pipeline, node.id, p).join(" = ")} = ${result}[${python(p)}]`)].join("\n");
}

/** Where a cell is: its step in notebook order, and its place in that step. */
export type CellAt = { step: number; cell: number };

/** A cell's number in the whole notebook, from 0, as POST /code/split numbers the cells. */
export const cellNumber = (steps: NotebookStep[], at: CellAt) =>
  steps.slice(0, at.step).reduce((n, s) => n + (s.kind === "cells" ? s.cells.length : 1), 0) + at.cell;

const CELL_MARKER = /^# %%.*$/m;

const splitOnMarkers = (text: string) =>
  text
    .split(CELL_MARKER)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");

/** A code step's cells read again from its whole source, as the Code tab edits it. */
export const withSource = (steps: NotebookStep[], nodeId: string, source: string) =>
  steps.map((s) => (s.kind === "cells" && s.nodeId === nodeId ? { ...s, cells: splitOnMarkers(source) } : s));

/** Cells sent to POST /code/split, in notebook order, and where each came from. */
export type SplitRequest = { cells: string[]; origins: { nodeId: string | undefined; standIn: boolean }[] };

/** Every cell of the notebook, for Python to read the links. A step that is not notebook
 * cells goes as a stand-in line that reads and sets its names, so links to and from it are
 * found too; it is never run. */
export function splitRequest(pipeline: PipelineVersion, operators: Operators, steps: NotebookStep[]): SplitRequest {
  const request: SplitRequest = { cells: [], origins: [] };
  // Python links a name to the latest line that sets it, so a name two outputs share would
  // link a cell to the wrong one.
  const owner = new Map<string, string>();
  for (const step of steps) {
    if (step.kind === "cells") {
      for (const cell of step.cells) {
        request.cells.push(cell);
        request.origins.push({ nodeId: step.nodeId, standIn: false });
      }
      continue;
    }
    const node = nodeOf(pipeline, step.nodeId);
    const reads = [...new Set(inputsOf(pipeline, node.id).map((i) => i.name))];
    const sets = outputPorts(pipeline, operators, node).flatMap((p) => {
      const end = `${node.id}.${p}`;
      const names = outputNames(pipeline, node.id, p);
      for (const name of names) {
        const other = owner.get(name);
        if (other !== undefined && other !== end) throw new Error(`${name} names both ${other} and ${end}. Rename it in one of the cells that read it.`);
        owner.set(name, end);
      }
      return names;
    });
    const standIn = `object(${reads.join(", ")})`;
    request.cells.push(sets.length > 0 ? `${sets.join(" = ")} = ${standIn}` : standIn);
    request.origins.push({ nodeId: node.id, standIn: true });
  }
  return request;
}

/** The next version from what Python read in the edited cells: code steps' sources, ports and
 * links change; other steps are kept. A cell keeps its step's id, so history follows it. */
export function versionFromSplit(
  base: PipelineVersion,
  operators: Operators,
  request: SplitRequest,
  split: CodeSplit,
): { version: PipelineVersion; notes: string[]; cellNodes: (string | undefined)[] } {
  const originOf = (cell: number) => {
    const origin = request.origins[cell];
    if (!origin) throw new Error(`the split names cell ${cell}, which was not sent`);
    return origin;
  };
  const taken = new Set(base.nodes.map((n) => n.id));
  const claimed = new Set<string>();
  const ids = split.steps.map((step) => {
    const origins = step.cells.map(originOf);
    const standIn = origins.find((o) => o.standIn);
    if (standIn?.nodeId !== undefined) {
      if (step.cells.length === 1) return standIn.nodeId;
      const why = split.notes.find((n) => step.cells.includes(n.cell))?.message ?? "these cells must run together";
      throw new Error(`${why}, but built-in step ${standIn.nodeId} sits between them. Move those cells next to each other.`);
    }
    const id = origins.map((o) => o.nodeId).find((n) => n !== undefined && !claimed.has(n)) ?? freshCellId(taken);
    claimed.add(id);
    taken.add(id);
    return id;
  });
  const isStandIn = (k: number) => originOf(split.steps[k]?.cells[0] ?? -1).standIn;
  const idOf = (k: number) => {
    const id = ids[k];
    if (id === undefined) throw new Error(`the split links step ${k}, which it did not return`);
    return id;
  };

  const nodes = split.steps.map((step, k): Node => {
    const id = idOf(k);
    const old = base.nodes.find((n) => n.id === id);
    if (isStandIn(k) && old) return old;
    const { inputs: _inputs, outputs: _outputs, ...kept } = old?.params ?? {};
    return {
      ...old,
      id,
      operator: old?.operator ?? NOTEBOOK_OPERATOR,
      params: {
        ...kept,
        source: step.source,
        ...(step.inputs.length > 0 ? { inputs: step.inputs } : {}),
        ...(step.outputs.length > 0 ? { outputs: step.outputs } : {}),
      },
    };
  });

  const settingPort = (nodeId: string, name: string) => {
    const port = outputPorts(base, operators, nodeOf(base, nodeId)).find((p) => outputNames(base, nodeId, p).includes(name));
    if (port === undefined) throw new Error(`step ${nodeId} has no output named ${name}`);
    return port;
  };
  const readingPorts = (nodeId: string, name: string) => inputsOf(base, nodeId).filter((i) => i.name === name).map((i) => i.port);
  const edges = split.links.flatMap((link) => {
    const [from, to] = [idOf(link.from_step), idOf(link.to_step)];
    const fromEnd = `${from}.${isStandIn(link.from_step) ? settingPort(from, link.name) : link.name}`;
    const toPorts = isStandIn(link.to_step) ? readingPorts(to, link.name) : [link.name];
    return toPorts.map((port) => ({ from: fromEnd, to: `${to}.${port}` }));
  });
  // Rust would reject the version for the missing input; say which cell edit caused it.
  for (const [k, id] of ids.entries()) {
    if (!isStandIn(k)) continue;
    const lost = inputsOf(base, id).find((i) => !edges.some((e) => e.to === `${id}.${i.port}`));
    if (lost) throw new Error(`step ${id} reads ${lost.name}, which no cell sets now`);
  }

  const notes = split.notes.filter((n) => !originOf(n.cell).standIn).map((n) => n.message);
  // The step each sent cell ended up in; a blank or import-only cell is in none.
  const cellNodes = request.cells.map((_, cell) => ids[split.steps.findIndex((s) => s.cells.includes(cell))]);
  return { version: nextVersion(base, { nodes, edges }), notes, cellNodes };
}

function freshCellId(taken: Set<string>): string {
  let n = 1;
  while (taken.has(`cell_${n}`)) n += 1;
  return `cell_${n}`;
}

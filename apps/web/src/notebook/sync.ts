import type { CodeSplit, Edge, Node, NotebookCell, NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { ulid } from "ulid";

import { nextVersion, timestamp } from "../flow/edit.ts";
import { NOTEBOOK_OPERATOR } from "../flow/notebook.ts";
import { portOf, stepOf } from "../flow/ports.ts";
import { newCellId } from "./document.ts";
import { bindInputs } from "./node.ts";

const CELL_MARKER = /^# %%.*$/m;

type Synced = { version: PipelineVersion } | { unchanged: true } | { refused: string };

const ownedBy = (notebookId: string) => (n: Node) => n.from_notebook?.notebook_id === notebookId;

/** The flow with this notebook's steps rebuilt from its cells (ADR-0037). `split` is Python's
 * reading of the notebook's code cells, in order. Steps of other notebooks and built-in steps
 * stay; a step keeps its id while it keeps any of its cells, and keeps its exposed settings. */
export function stepsIntoFlow({ base, projectId, notebook, split }: { base: PipelineVersion | undefined; projectId: string; notebook: NotebookVersion; split: CodeSplit }): Synced {
  const code = notebook.cells.filter((c) => c.kind === "code");
  const owned = (base?.nodes ?? []).filter(ownedBy(notebook.notebook_id));
  const ownedIds = new Set(owned.map((n) => n.id));
  const kept = (base?.nodes ?? []).filter((n) => !ownedIds.has(n.id));
  const keptEdges = (base?.edges ?? []).filter((e) => !ownedIds.has(stepOf(e.from)) && !ownedIds.has(stepOf(e.to)));
  // Other steps reading this notebook's outputs: they must still find them.
  const outward = (base?.edges ?? []).filter((e) => ownedIds.has(stepOf(e.from)) && !ownedIds.has(stepOf(e.to)));

  const taken = new Set(kept.map((n) => n.id));
  const used = new Set<string>();
  const ids = split.steps.map((step) => {
    const cells = step.cells.map((i) => code[i]?.id);
    const before = owned.find((n) => !used.has(n.id) && n.from_notebook?.cells.some((c) => cells.includes(c)));
    const id = before?.id ?? freshId(slug(notebook.title), taken);
    used.add(id);
    taken.add(id);
    return { id, before };
  });

  const nodes: Node[] = split.steps.map((step, k) => {
    const { id, before } = ids[k]!;
    const passedOn = outward.filter((e) => stepOf(e.from) === before?.id).map((e) => portOf(e.from));
    const settings = before?.params["parameters"];
    const exposed = settings && typeof settings === "object" ? Object.entries(settings).filter(([name]) => step.parameters.some((p) => p.name === name)) : [];
    return {
      id,
      operator: NOTEBOOK_OPERATOR,
      params: {
        source: step.source,
        inputs: step.inputs,
        outputs: [...new Set([...step.outputs, ...passedOn])],
        ...(exposed.length > 0 ? { parameters: Object.fromEntries(exposed) } : {}),
      },
      from_notebook: { notebook_version_id: notebook.id, notebook_id: notebook.notebook_id, cells: step.cells.flatMap((i) => (code[i] ? [code[i].id] : [])) },
    };
  });

  const edges: Edge[] = split.links.map((l) => ({ from: `${ids[l.from_step]!.id}.${l.name}`, to: `${ids[l.to_step]!.id}.${l.name}` }));
  const others = base ? { ...base, nodes: kept } : undefined;
  for (const [k, step] of split.steps.entries()) {
    const linked = new Set(split.links.filter((l) => l.to_step === k).map((l) => l.name));
    const bound = bindInputs(others, step.inputs.filter((name) => !linked.has(name)));
    if ("refused" in bound) return bound;
    edges.push(...bound.links.map((l) => ({ from: l.from, to: `${ids[k]!.id}.${l.name}` })));
  }
  for (const e of outward) {
    const after = ids.find((i) => i.before?.id === stepOf(e.from));
    if (!after) return { refused: `Step ${stepOf(e.to)} reads ${portOf(e.from)} from cells this notebook no longer has.` };
    edges.push({ from: `${after.id}.${portOf(e.from)}`, to: e.to });
  }

  const next = { nodes: [...kept, ...nodes], edges: [...keptEdges, ...edges] };
  if (base && sameSteps(base, next)) return { unchanged: true };
  if (!base) {
    if (nodes.length === 0) return { unchanged: true };
    return { version: { schema_version: "sprisk.pipeline_version/v1", id: `plv_${ulid()}`, project_id: projectId, ...next, created_at: timestamp() } };
  }
  return { version: nextVersion(base, next) };
}

/** Equal but for which notebook version the steps cite: saving the same cells again is no change. */
function sameSteps(base: PipelineVersion, next: Pick<PipelineVersion, "nodes" | "edges">) {
  const plain = (nodes: Node[]) => nodes.map((n) => (n.from_notebook ? { ...n, from_notebook: { ...n.from_notebook, notebook_version_id: "" } } : n));
  const sorted = (edges: Edge[]) => edges.map((e) => `${e.from}>${e.to}`).sort();
  return JSON.stringify(plain(base.nodes)) === JSON.stringify(plain(next.nodes)) && JSON.stringify(sorted(base.edges)) === JSON.stringify(sorted(next.edges));
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(?![a-z])/, "nb_").slice(0, 40) || "notebook";

function freshId(prefix: string, taken: Set<string>) {
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n += 1;
  return `${prefix}_${n}`;
}

/** The notebook's cells with the code its steps hold in `flow`, when a step was edited on the
 * canvas (ADR-0037); undefined when every step's code is its cells. A step's code starts with
 * lines copied from earlier cells (imports, literals); those stay in their own cells. */
export function cellsFromFlow(flow: PipelineVersion, notebook: NotebookVersion): NotebookCell[] | undefined {
  let cells = [...notebook.cells];
  let changed = false;
  for (const node of flow.nodes.filter(ownedBy(notebook.notebook_id))) {
    const source = node.params["source"];
    const ids = (node.from_notebook?.cells ?? []).filter((id) => cells.some((c) => c.id === id));
    if (typeof source !== "string" || ids.length === 0) continue;
    const first = cells.findIndex((c) => c.id === ids[0]);
    const earlier = new Set(cells.slice(0, first).flatMap((c) => (c.kind === "code" ? c.source.split("\n").map((l) => l.trim()) : [])));
    const parts = source.split(CELL_MARKER).map((p) => p.trim());
    parts[0] = withoutCopied(parts[0] ?? "", earlier);
    const now = ids.map((id) => cells.find((c) => c.id === id)?.source.trim());
    if (parts.length === ids.length && parts.every((p, i) => p === now[i])) continue;
    changed = true;
    const replaced = new Map(ids.map((id, i) => [id, parts[i]]));
    const extra = parts.slice(ids.length).map((p): NotebookCell => ({ id: newCellId(), kind: "code", source: p }));
    const last = ids.at(-1);
    cells = cells.flatMap((c) => {
      if (!replaced.has(c.id)) return [c];
      const text = replaced.get(c.id);
      const kept = text === undefined ? [] : [{ ...c, source: text }];
      return c.id === last ? [...kept, ...extra] : kept;
    });
  }
  return changed ? cells : undefined;
}

function withoutCopied(part: string, earlier: Set<string>) {
  const lines = part.split("\n");
  let start = 0;
  while (start < lines.length && (lines[start]!.trim() === "" || earlier.has(lines[start]!.trim()))) start += 1;
  return lines.slice(start).join("\n").trim();
}

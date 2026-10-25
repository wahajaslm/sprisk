import type { NotebookCell, PipelineVersion } from "@sprisk/contracts";

import { isNotebookStep } from "../flow/notebook.ts";
import type { Ran } from "./outputs.ts";

/** An input and the port of the flow that will give it to a step. */
export type Link = { name: string; from: string };

/** Each input linked to the one notebook-made step of the flow that makes it. Never a built-in
 * step's port by a look-alike name (`split_test` could be a holdout), and never a guess
 * between two steps that make the same name. */
export function bindInputs(base: PipelineVersion | undefined, inputs: string[]): { links: Link[] } | { refused: string } {
  const links: Link[] = [];
  for (const name of inputs) {
    const makers = (base?.nodes ?? []).filter((n) => isNotebookStep(n.operator) && namesOf(n.params["outputs"]).includes(name));
    if (makers.length === 0) return { refused: `No step in this pipeline makes ${name}. Pick the cells that make it too, or create their node first.` };
    if (makers.length > 1) {
      const ids = makers.map((n) => n.id);
      return { refused: `Steps ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)} both make ${name}. Rename one, or pick the cells that make it too.` };
    }
    links.push({ name, from: `${makers[0]!.id}.${name}` });
  }
  return { links };
}

const namesOf = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** True when a cell lower down ran before one above it. */
export function ranOutOfOrder(cells: NotebookCell[], ran: Record<string, Ran>) {
  const counts = cells.flatMap((c) => {
    const n = ran[c.id]?.result.execution_count;
    return n === undefined ? [] : [n];
  });
  return counts.some((n, i) => i > 0 && n < counts[i - 1]!);
}

import type { Operator, PipelineVersion } from "@sprisk/contracts";

import { nodeOf } from "../flow/notebook.ts";
import { stageCells } from "./stageCells.ts";
import { stageNotebooks } from "./stageNotebooks.ts";

/** The whole pipeline as one Python script to copy (ADR-0055): each step's notebook cell in
 * notebook order, under a comment naming the step. `code` is each ready-made step's plain
 * Python; a step without any gets a comment saying so, never invented code. Only joined here,
 * never run (rule 3). */
export function pipelineScript(pipeline: PipelineVersion, byRef: Map<string, Operator>, code: Map<string, string>): string {
  const cells = stageNotebooks(pipeline, byRef).flatMap((section) => stageCells(section, code).filter((c) => c.kind === "code"));
  const parts = cells.map((cell) => {
    // Step ids and operator refs are contract patterns: no newline can end the comment.
    const heading = `# ${cell.id} · ${nodeOf(pipeline, cell.id).operator}`;
    return cell.source.trim() === "" ? `${heading}\n# No plain code for this step yet.` : `${heading}\n${cell.source.trimEnd()}`;
  });
  return `${parts.join("\n\n")}\n`;
}

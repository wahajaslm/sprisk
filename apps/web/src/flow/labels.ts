import type { PipelineVersion } from "@sprisk/contracts";

/** A human name for a flow: the file its source reads ("iris.csv"), else the version id tail. */
export function flowName(pipeline: PipelineVersion): string {
  for (const node of pipeline.nodes) {
    const path = node.params["path"];
    if (typeof path === "string") return path.split("/").at(-1) ?? path;
  }
  return pipeline.id.slice(-6);
}

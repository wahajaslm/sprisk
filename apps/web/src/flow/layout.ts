import type { PipelineVersion } from "@sprisk/contracts";
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** Where each step sits on the canvas: left to right by what it reads, with crossings kept low
 * (ELK's layered layout). View state only; never saved with the flow. */
export async function flowPositions(pipeline: PipelineVersion, size: Size): Promise<Map<string, Point>> {
  const graph = await elk.layout({
    id: "flow",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.nodeNode": "28",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: pipeline.nodes.map((n) => ({ id: n.id, ...size })),
    edges: pipeline.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from.split(".")[0] ?? e.from],
      targets: [e.to.split(".")[0] ?? e.to],
    })),
  });
  return new Map((graph.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}

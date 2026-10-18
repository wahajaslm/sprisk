import type { PipelineVersion } from "@sprisk/contracts";

/** `ids` runs from the head back to the oldest version in the list. */
export type Flow = { head: PipelineVersion; ids: string[] };

/** The flow a version belongs to; with none picked, the newest flow. */
export const flowOf = (list: Flow[], versionId: string | undefined): Flow | undefined =>
  list.find((f) => versionId !== undefined && f.ids.includes(versionId)) ?? list[0];

/** The user sees flows, not versions (ADR-0019 §8). A flow's head is a version no other
 * version edits; its size is the chain back through `parent_id`. Input is newest first. */
export function flows(versions: PipelineVersion[]): Flow[] {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const edited = new Set(versions.flatMap((v) => (v.parent_id ? [v.parent_id] : [])));
  return versions
    .filter((v) => !edited.has(v.id))
    .map((head) => {
      const ids = [head.id];
      for (let p = head.parent_id; p !== undefined && byId.has(p); p = byId.get(p)?.parent_id) ids.push(p);
      return { head, ids };
    });
}

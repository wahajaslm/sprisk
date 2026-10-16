import type { PipelineVersion } from "@sprisk/contracts";

export type SettingChange = { node: string; key: string; before: unknown; after: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Settings that differ between two versions of a flow, step by step. A step that exists in
 * only one version is one change with key "step". */
export function settingChanges(before: PipelineVersion, after: PipelineVersion): SettingChange[] {
  const changes: SettingChange[] = [];
  const ids = [...new Set([...before.nodes, ...after.nodes].map((n) => n.id))];
  for (const id of ids) {
    const a = before.nodes.find((n) => n.id === id);
    const b = after.nodes.find((n) => n.id === id);
    if (!a || !b) {
      changes.push({ node: id, key: "step", before: a ? "present" : undefined, after: b ? "present" : undefined });
      continue;
    }
    if (a.operator !== b.operator) changes.push({ node: id, key: "operator", before: a.operator, after: b.operator });
    for (const key of [...new Set([...Object.keys(a.params), ...Object.keys(b.params)])]) {
      if (!same(a.params[key], b.params[key])) changes.push({ node: id, key, before: a.params[key], after: b.params[key] });
    }
  }
  return changes;
}

/** A setting value for display: short, one line. */
export function showValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  const text = JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

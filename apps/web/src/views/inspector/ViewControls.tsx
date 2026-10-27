import type { Operator, PipelineVersion, TableColumn } from "@sprisk/contracts";

import { type Field, isViewSetting, settingsOf } from "./ParametersTab.tsx";
import { useRunEdit } from "./useRunEdit.ts";

type Props = {
  pipeline: PipelineVersion;
  nodeId: string;
  operator: Operator | undefined;
  columns: TableColumn[];
  /** The step to keep selected after a redraw (a chart's own step is never shown). */
  showNode?: string;
};

/** A dropdown drawn as the design's outlined field. */
const SELECT = { height: "28px", maxWidth: "220px", padding: "0 8px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.14)", background: "var(--bg-surface)", color: "var(--t-primary,#f2f2f2)", font: "inherit", fontSize: "12.5px", cursor: "pointer" } as const;

/** A step's view settings (kind, x, y) as dropdowns above its figures. A change runs the step
 * again as a new version, so the figure stays what Python drew (ADR-0024). */
export function ViewControls({ pipeline, nodeId, operator, columns, showNode }: Props) {
  const edit = useRunEdit(pipeline, nodeId, showNode);
  const params = pipeline.nodes.find((n) => n.id === nodeId)?.params ?? {};
  const fields = operator ? settingsOf(operator.params_schema).filter(isViewSetting) : [];
  if (fields.length === 0) return null;
  const set = (field: Field, value: string) => {
    const next: Record<string, unknown> = { ...params };
    if (value === "") delete next[field.name];
    else next[field.name] = value;
    edit.run(next);
  };
  return (
    <div role="group" aria-label="Figure settings" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
      {fields.map((field) => {
        const options = field["x-sprisk-column"] ? columns.map((c) => c.name) : (field.enum ?? []);
        const value = typeof params[field.name] === "string" ? (params[field.name] as string) : "";
        return (
          <label key={field.name} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--t-label,#959595)" }}>
            {field.name}
            <select aria-label={field.name} value={value} disabled={edit.pending} onChange={(e) => set(field, e.target.value)} style={SELECT}>
              {!field.required && <option value="">none</option>}
              {value !== "" && !options.includes(value) && <option>{value}</option>}
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        );
      })}
      {edit.pending && <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" }}>Drawing…</span>}
      {edit.error && <span role="alert" className="error">{edit.error}</span>}
    </div>
  );
}

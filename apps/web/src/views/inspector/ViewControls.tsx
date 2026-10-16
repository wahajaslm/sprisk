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
    <div className="view-controls" role="group" aria-label="Figure settings">
      {fields.map((field) => {
        const options = field["x-sprisk-column"] ? columns.map((c) => c.name) : (field.enum ?? []);
        const value = typeof params[field.name] === "string" ? (params[field.name] as string) : "";
        return (
          <label key={field.name}>
            {field.name}
            <select aria-label={field.name} value={value} disabled={edit.pending} onChange={(e) => set(field, e.target.value)}>
              {!field.required && <option value="">none</option>}
              {value !== "" && !options.includes(value) && <option>{value}</option>}
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        );
      })}
      {edit.pending && <span className="muted">Drawing…</span>}
      {edit.error && <span role="alert" className="error">{edit.error}</span>}
    </div>
  );
}

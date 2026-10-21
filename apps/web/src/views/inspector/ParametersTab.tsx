import type { CodeInterface, CodeParameter, MethodologyRule, Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import type { Read } from "../../api/code.ts";
import { useMethodologyRules } from "../../api/methodology.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { useRunEdit } from "./useRunEdit.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { SplitMethodology } from "./SplitMethodology.tsx";

type Props = {
  pipeline: PipelineVersion;
  nodeId: string;
  operator: Operator | undefined;
  found: Read<CodeInterface>;
};

/** The settings a step runs with. Built-in steps: a form from the operator's schema. Code
 * steps: literal settings found in the code, exposed on request (ADR-0021). Running with
 * changed settings saves a new version; the code itself is never edited. */
export function ParametersTab({ pipeline, nodeId, operator, found }: Props) {
  const rules = useMethodologyRules();
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  if (isCodeOperator(node.operator)) {
    if (found.status === "none") return <p className="muted">{found.reason}</p>;
    if (found.status === "loading") return <Loading />;
    if (found.status === "error") return <p role="alert" className="error">{found.message}</p>;
    return <Expose key={JSON.stringify(found.value.parameters)} pipeline={pipeline} nodeId={nodeId} params={node.params} found={found.value} />;
  }
  if (!operator) return <Loading />;
  // A step has one panel per active rule that decides its operator (ADR-0045, ADR-0053).
  const unversioned = node.operator.split("@")[0] ?? node.operator;
  const deciding = (rules.data ?? [])
    .filter((r) => r.status === "active" && r.applies_to?.includes(unversioned))
    .sort(inWorkflowOrder);

  return <>
    {rules.isError && <p role="alert" className="error">Methodology rules could not be read: {rules.error.message}</p>}
    {deciding.map((rule) => (
      <SplitMethodology key={`method/${pipeline.id}/${nodeId}/${rule.decides}`} pipeline={pipeline} nodeId={nodeId} rule={rule} />
    ))}
    <Settings key={`${pipeline.id}/${nodeId}`} pipeline={pipeline} nodeId={nodeId} params={node.params} schema={operator.params_schema} />
  </>;
}

/** The schema's stage order, so a step's rules read as the work goes: the model, then its threshold. */
const STAGE_ORDER: Record<MethodologyRule["stage"], number> = {
  question: 0, data: 1, cleaning: 2, split: 3, features: 4, models: 5, evaluation: 6, reporting: 7,
};

function inWorkflowOrder(a: MethodologyRule, b: MethodologyRule): number {
  return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.id.localeCompare(b.id);
}

/** Exposed values as typed in the form, by parameter name. */
type Exposed = Record<string, string | boolean>;

function startValue(p: CodeParameter, current: unknown): string | boolean {
  if (current !== undefined) return typeof current === "boolean" ? current : String(current);
  if (p.value_type === "boolean") return p.default_text === "True";
  if (p.value_type === "string") return p.default_text.replace(/^(['"])(.*)\1$/s, "$2");
  return p.default_text;
}

function typed(p: CodeParameter, value: string | boolean): unknown {
  if (p.value_type === "integer" || p.value_type === "number") return Number(value);
  return value;
}

function Expose({ pipeline, nodeId, params, found }: { pipeline: PipelineVersion; nodeId: string; params: Record<string, unknown>; found: CodeInterface }) {
  const saved = (params.parameters ?? {}) as Record<string, unknown>;
  const initial: Exposed = Object.fromEntries(found.parameters.filter((p) => p.name in saved).map((p) => [p.name, startValue(p, saved[p.name])]));
  const [exposed, setExposed] = useState<Exposed>(initial);
  const edit = useRunEdit(pipeline, nodeId);
  const changed = JSON.stringify(exposed) !== JSON.stringify(initial);

  const run = () => {
    const next: Record<string, unknown> = { ...params };
    const values = Object.fromEntries(found.parameters.filter((p) => p.name in exposed).map((p) => [p.name, typed(p, exposed[p.name] ?? "")]));
    if (Object.keys(values).length > 0) next.parameters = values;
    else delete next.parameters;
    edit.run(next);
  };

  return (
    <section className="found" aria-label="Settings in your code">

      <p className="found-label">Settings you can expose</p>
      {found.parameters.length === 0 ? (
        <p className="muted">No top-level literal settings, like <code>threshold = 0.15</code>.</p>
      ) : (
        <ul className="found-list">
          {found.parameters.map((p) => {
            const on = p.name in exposed;
            return (
              <li key={p.name} className={`found-param${on ? " on" : ""}`}>
                <label className="found-toggle">
                  <input
                    type="checkbox"
                    aria-label={`Expose ${p.name}`}
                    checked={on}
                    onChange={(e) => {
                      const next = { ...exposed };
                      if (e.target.checked) next[p.name] = startValue(p, undefined);
                      else delete next[p.name];
                      setExposed(next);
                    }}
                  />
                  <span className="mono">{p.name}</span>
                </label>
                <span className="found-meta">line {p.line} · {p.value_type} · in code {p.default_text}</span>
                {on && <ParamInput p={p} value={exposed[p.name] ?? ""} onChange={(v) => setExposed({ ...exposed, [p.name]: v })} />}
              </li>
            );
          })}
        </ul>
      )}

      <div className="settings-actions">
        {edit.error && <span role="alert" className="error">{edit.error}</span>}
        <span className="spacer" />
        <button type="button" className="run-code" disabled={!changed || edit.pending} onClick={run}>
          {edit.pending ? "Starting…" : "Run with these settings"}
        </button>
      </div>
    </section>
  );
}

function ParamInput({ p, value, onChange }: { p: CodeParameter; value: string | boolean; onChange: (v: string | boolean) => void }) {
  if (p.value_type === "boolean") {
    return <input aria-label={p.name} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  const numeric = p.value_type === "integer" || p.value_type === "number";
  return (
    <input
      aria-label={p.name}
      className="found-input"
      type={numeric ? "number" : "text"}
      step={p.value_type === "integer" ? 1 : "any"}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

type Field = {
  name: string;
  type: string;
  required: boolean;
  enum?: string[];
  items?: { type?: string };
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  default?: unknown;
  description?: string;
  /** Settings about what is shown live in Visualizations, next to the figure. */
  "x-sprisk-show-in"?: string;
  /** The value names a column of the input table. */
  "x-sprisk-column"?: boolean;
  /** A file the step reads: an input, shown under Inputs (ADR-0025). */
  "x-sprisk-local-path"?: boolean;
};

export type { Field };

/** A step's settings from its schema, split by where they are shown. */
export const settingsOf = (schema: Record<string, unknown>) => fieldsOf(schema, []);
export const isViewSetting = (f: Field) => f["x-sprisk-show-in"] === "visualizations";
export const isFileInput = (f: Field) => f["x-sprisk-local-path"] === true;

function fieldsOf(schema: Record<string, unknown>, skip: string[]): Field[] {
  const properties = (schema.properties ?? {}) as Record<string, Omit<Field, "name" | "required">>;
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  return Object.entries(properties)
    .filter(([name]) => !skip.includes(name))
    .map(([name, spec]) => ({ name, ...spec, required: required.includes(name) }));
}

/** One line under a setting: what it does, then its type, range, default and whether it is required. */
function fieldHelp(f: Field): string {
  const type = f.type === "array" ? `list of ${f.items?.type ?? "values"}` : f.type;
  const low = f.minimum !== undefined ? `at least ${f.minimum}` : f.exclusiveMinimum !== undefined ? `more than ${f.exclusiveMinimum}` : undefined;
  const high = f.maximum !== undefined ? `at most ${f.maximum}` : f.exclusiveMaximum !== undefined ? `less than ${f.exclusiveMaximum}` : undefined;
  const range =
    f.minimum !== undefined && f.maximum !== undefined ? `${f.minimum} to ${f.maximum}` : [low, high].filter(Boolean).join(", ") || undefined;
  const facts = [
    type,
    f.enum ? `one of ${f.enum.join(", ")}` : range,
    f.default !== undefined ? `default ${JSON.stringify(f.default)}` : undefined,
    f.required ? "required" : "optional",
  ].filter((x): x is string => x !== undefined);
  return [f.description, facts.join(" · ")].filter(Boolean).join(" ");
}

/** Form values as typed; turned back into params only when the user runs. */
type Draft = Record<string, string | boolean>;

function toDraft(value: unknown): string | boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function fromDraft(field: Field, value: string | boolean): unknown {
  if (typeof value === "boolean") return value;
  if (field.type === "integer" || field.type === "number") return value.trim() === "" ? undefined : Number(value);
  if (field.type === "array") return value.split(",").map((v) => v.trim()).filter((v) => v !== "");
  if (field.type === "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value; // the compiler reports what is wrong with it
  }
}

function Settings({ pipeline, nodeId, params, schema }: {
  pipeline: PipelineVersion;
  nodeId: string;
  params: Record<string, unknown>;
  schema: Record<string, unknown>;
}) {
  const all = fieldsOf(schema, []);
  // Parameters are tunable values only: files are Inputs, view choices sit by the figure.
  const fields = all.filter((f) => !isViewSetting(f) && !isFileInput(f));
  const elsewhere = all.filter(isViewSetting).map((f) => f.name);
  const initial: Draft = Object.fromEntries(fields.map((f) => [f.name, toDraft(params[f.name])]));
  const [draft, setDraft] = useState<Draft>(initial);
  const edit = useRunEdit(pipeline, nodeId);
  const changed = fields.some((f) => draft[f.name] !== initial[f.name]);
  const note = elsewhere.length > 0 && <p className="muted">{listed(elsewhere)} {elsewhere.length === 1 ? "is" : "are"} set in Visualizations, next to the figure.</p>;
  if (fields.length === 0) return note || <p className="muted">This step has no settings.</p>;

  const run = () => {
    const next: Record<string, unknown> = { ...params };
    for (const f of fields) {
      const value = fromDraft(f, draft[f.name] ?? "");
      if (value === undefined) delete next[f.name];
      else next[f.name] = value;
    }
    edit.run(next);
  };
  const set = (name: string, value: string | boolean) => setDraft({ ...draft, [name]: value });

  return (
    <section className="settings" aria-label="Settings">
      <p className="output-title">Settings</p>
      {note}
      <div className="settings-grid">
        {fields.map((f) => (
          <div key={f.name} className="setting">
            <label className="setting-name" htmlFor={`setting-${f.name}`}>
              {f.name.replaceAll("_", " ")}
            </label>
            <SettingInput field={f} value={draft[f.name] ?? ""} onChange={(v) => set(f.name, v)} />
            <p id={`setting-${f.name}-help`} className="setting-help">
              {fieldHelp(f)}
            </p>
          </div>
        ))}
      </div>
      <div className="settings-actions">
        {edit.error && <span role="alert" className="error">{edit.error}</span>}
        <span className="spacer" />
        {changed && (
          <button type="button" className="page-btn" onClick={() => setDraft(initial)}>
            Reset
          </button>
        )}
        <button type="button" className="run-code" disabled={!changed || edit.pending} onClick={run}>
          {edit.pending ? "Starting…" : "Run with these settings"}
        </button>
      </div>
    </section>
  );
}

/** "kind, x and y" */
function listed(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function SettingInput({ field, value, onChange }: { field: Field; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const label = field.name;
  const a11y = { id: `setting-${field.name}`, "aria-label": label, "aria-describedby": `setting-${field.name}-help` };
  if (field.type === "boolean") {
    return <input {...a11y} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.enum) {
    return (
      <select {...a11y} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {field.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return (
      <input
        {...a11y}
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        min={field.minimum}
        max={field.maximum}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      {...a11y}
      type="text"
      value={String(value)}
      placeholder={field.type === "array" ? "comma separated" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

import type { CodeInterface, CodeParameter, Operator, PipelineVersion } from "@sprisk/contracts";
import { useId, useState } from "react";

import type { Read } from "../../api/code.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { useRunEdit } from "./useRunEdit.ts";
import { Loading } from "../../components/ui/Loading.tsx";

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
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  if (isCodeOperator(node.operator)) {
    if (found.status === "none") return <p className="muted">{found.reason}</p>;
    if (found.status === "loading") return <Loading />;
    if (found.status === "error") return <p role="alert" className="error">{found.message}</p>;
    return <Expose key={JSON.stringify(found.value.parameters)} pipeline={pipeline} nodeId={nodeId} params={node.params} found={found.value} />;
  }
  if (!operator) return <Loading />;
  return <Settings key={`${pipeline.id}/${nodeId}`} pipeline={pipeline} nodeId={nodeId} params={node.params} schema={operator.params_schema} />;
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
    <section aria-label="Settings in your code" style={TABLE}>
      {found.parameters.length === 0 ? (
        <p className="muted">No top-level literal settings, like <code>threshold = 0.15</code>.</p>
      ) : (
        <>
          <div style={{ ...HEAD, gridTemplateColumns: EXPOSE_COLUMNS }}>
            <span>Parameter</span>
            <span>Value</span>
            <span>In code</span>
          </div>
          {found.parameters.map((p) => {
            const on = p.name in exposed;
            return (
              <div key={p.name} style={{ ...ROW, gridTemplateColumns: EXPOSE_COLUMNS }}>
                <div style={NAME_CELL}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
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
                    <span style={NAME}>{p.name}</span>
                  </label>
                  <span style={HELP}>line {p.line} · {p.value_type}</span>
                </div>
                <div style={VALUE_CELL}>
                  {on && <ParamInput p={p} value={exposed[p.name] ?? ""} onChange={(v) => setExposed({ ...exposed, [p.name]: v })} />}
                </div>
                <span style={DEFAULT}>{p.default_text}</span>
              </div>
            );
          })}
        </>
      )}

      <div style={FOOTER}>
        {edit.error ? <span role="alert" className="error">{edit.error}</span> : <span />}
        <button type="button" className="dx-btn" disabled={!changed || edit.pending} onClick={run} style={PRIMARY}>
          {edit.pending ? "Starting…" : "Run with these settings"}
        </button>
      </div>
    </section>
  );
}

function ParamInput({ p, value, onChange }: { p: CodeParameter; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const a11y = { "aria-label": p.name };
  if (p.value_type === "boolean") {
    return <input {...a11y} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (p.value_type === "integer" || p.value_type === "number") {
    return <NumberStepper a11y={a11y} integer={p.value_type === "integer"} value={String(value)} onChange={onChange} />;
  }
  return <TextBox a11y={a11y} value={String(value)} onChange={onChange} />;
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
  // Several steps' forms share a page in a stage notebook (ADR-0055).
  const uid = useId();
  const changed = fields.some((f) => draft[f.name] !== initial[f.name]);
  const note = elsewhere.length > 0 ? `${listed(elsewhere)} ${elsewhere.length === 1 ? "is" : "are"} set in Visualizations, next to the figure.` : "";
  if (fields.length === 0) return <p className="muted">{note || "This step has no settings."}</p>;

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
    <section aria-label="Settings" style={TABLE}>
      <div style={{ ...HEAD, gridTemplateColumns: SETTING_COLUMNS }}>
        <span>Parameter</span>
        <span>Value</span>
        <span>Default</span>
        <span />
      </div>
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const value = draft[f.name] ?? "";
        return (
          <div key={f.name} style={{ ...ROW, gridTemplateColumns: SETTING_COLUMNS }}>
            <div style={NAME_CELL}>
              <label htmlFor={id} style={NAME}>
                {f.name}
              </label>
              <span id={`${id}-help`} style={HELP}>
                {fieldHelp(f)}
              </span>
            </div>
            <div style={VALUE_CELL}>
              <SettingInput id={id} field={f} value={value} onChange={(v) => set(f.name, v)} />
            </div>
            <span style={DEFAULT}>{f.default === undefined ? "" : String(toDraft(f.default))}</span>
            {value === initial[f.name] ? (
              <span />
            ) : (
              <button
                type="button"
                className="dx-btn dx-h-text"
                aria-label={`Reset ${f.name}`}
                onClick={() => set(f.name, initial[f.name] ?? "")}
                style={{ justifySelf: "end", fontSize: "12.5px", color: "var(--t-muted,#ababab)", cursor: "pointer", textAlign: "right" }}
              >
                Reset
              </button>
            )}
          </div>
        );
      })}
      <div style={FOOTER}>
        <span style={{ fontSize: "12.5px", lineHeight: "1.5", color: "var(--t-faint,#8c8c8c)" }}>{note}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {edit.error && <span role="alert" className="error">{edit.error}</span>}
          {changed && (
            <button
              type="button"
              className="dx-btn"
              onClick={() => setDraft(initial)}
              style={{ height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", fontSize: "12.5px", color: "var(--t-secondary,#d4d4d4)", background: "rgba(var(--ink-rgb,255,255,255),0.06)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Reset all
            </button>
          )}
          <button type="button" className="dx-btn" disabled={!changed || edit.pending} onClick={run} style={PRIMARY}>
            {edit.pending ? "Starting…" : "Run with these settings"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** "kind, x and y" */
function listed(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

type A11y = { id?: string; "aria-label": string; "aria-describedby"?: string };

function SettingInput({ id, field, value, onChange }: { id: string; field: Field; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const a11y = { id, "aria-label": field.name, "aria-describedby": `${id}-help` };
  if (field.type === "boolean") {
    return <input {...a11y} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.enum) {
    // A native select, drawn as the design's 30px dropdown button.
    return (
      <label className="dx-field dx-h-08" style={{ height: "30px", padding: "0 8px 0 10px", borderRadius: "var(--r-sm,6px)", background: "rgba(var(--ink-rgb,255,255,255),0.06)", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", minWidth: "0", maxWidth: "280px" }}>
        <select {...a11y} className="dx-input" value={String(value)} onChange={(e) => onChange(e.target.value)} style={{ fontSize: "13px", color: "var(--t-primary,#f2f2f2)", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" style={{ color: "var(--t-faint,#8c8c8c)", flexShrink: "0" }}>
          <path d="M2.5 3.75L5 6.25l2.5-2.5" />
        </svg>
      </label>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return <NumberStepper a11y={a11y} integer={field.type === "integer"} min={field.minimum} max={field.maximum} value={String(value)} onChange={onChange} />;
  }
  return <TextBox a11y={a11y} value={String(value)} placeholder={field.type === "array" ? "comma separated" : undefined} onChange={onChange} />;
}

/** The design's number pill: − and + around the value. Only whole numbers step; a decimal is typed. */
function NumberStepper({ a11y, integer, min, max, value, onChange }: {
  a11y: A11y;
  integer: boolean;
  min?: number | undefined;
  max?: number | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const nudge = (by: number) => {
    const next = (value.trim() === "" ? (min ?? 0) : Number(value)) + by;
    onChange(String(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next))));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", height: "30px", padding: integer ? "0" : "0 10px", borderRadius: "var(--r-sm,6px)", background: "rgba(var(--ink-rgb,255,255,255),0.06)" }}>
      {integer && (
        <button type="button" className="dx-btn dx-h-text" tabIndex={-1} aria-label={`Lower ${a11y["aria-label"]}`} onClick={() => nudge(-1)} style={STEP}>
          −
        </button>
      )}
      <input
        {...a11y}
        className="dx-input"
        type="number"
        step={integer ? 1 : "any"}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: "none", width: "64px", minWidth: "52px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--t-primary,#f2f2f2)", appearance: "textfield" }}
      />
      {integer && (
        <button type="button" className="dx-btn dx-h-text" tabIndex={-1} aria-label={`Raise ${a11y["aria-label"]}`} onClick={() => nudge(1)} style={STEP}>
          +
        </button>
      )}
    </div>
  );
}

/** A text setting in the design's hairline field box (as SearchField draws it). */
function TextBox({ a11y, value, placeholder, onChange }: { a11y: A11y; value: string; placeholder?: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="dx-field" style={{ flex: "1", minWidth: "0", height: "32px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.1)", display: "flex", alignItems: "center", gap: "8px", padding: "0 10px", color: "var(--t-faint,#8c8c8c)", fontSize: "13px" }}>
      <input {...a11y} type="text" className="dx-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** The design's Parameters table (main screen): a 32px header of 12px labels over rows of at
 * least 44px, split by hairlines. */
const TABLE = { display: "flex", flexDirection: "column", minWidth: "640px" } as const;
const HEAD = { display: "grid", columnGap: "16px", height: "32px", alignItems: "center", fontSize: "12px", color: "var(--t-label,#959595)", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.09)" } as const;
const ROW = { display: "grid", columnGap: "16px", minHeight: "44px", alignItems: "center", fontSize: "13px", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.05)" } as const;
const SETTING_COLUMNS = "minmax(0,1fr) minmax(0,1.8fr) 100px 48px";
const EXPOSE_COLUMNS = "minmax(0,1fr) minmax(0,1.8fr) 100px";
const NAME_CELL = { display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0", minWidth: "0" } as const;
const NAME = { fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px", color: "var(--t-primary,#f2f2f2)" } as const;
const HELP = { fontSize: "12px", lineHeight: "1.5", color: "var(--t-faint,#8c8c8c)", textWrap: "pretty" } as const;
const VALUE_CELL = { display: "flex", alignItems: "center", minWidth: "0" } as const;
const DEFAULT = { fontVariantNumeric: "tabular-nums", color: "var(--t-faint,#8c8c8c)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const STEP = { width: "28px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--t-muted,#ababab)" } as const;
const FOOTER = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", minHeight: "44px" } as const;
/** MethodologyTab's button, filled as the primary action. */
const PRIMARY = { height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid transparent", display: "flex", alignItems: "center", fontSize: "12.5px", fontWeight: "550", background: "var(--t-primary,#f2f2f2)", color: "var(--bg-app,#0a0a0a)", cursor: "pointer", whiteSpace: "nowrap" } as const;

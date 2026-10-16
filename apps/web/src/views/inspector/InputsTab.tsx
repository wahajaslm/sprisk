import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useOutputs, useSaveAndRun, useTablePage } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { isCodeOperator, setParams } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { useSelection } from "../../workbench/selection.ts";
import { CodeFound } from "./CodeFound.tsx";

type Props = { pipeline: PipelineVersion; nodeId: string; operator: Operator | undefined; attempts: Attempt[] };

/** What a step reads and the settings it runs with. Changing a setting runs a new version. */
export function InputsTab({ pipeline, nodeId, operator, attempts }: Props) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  const incoming = pipeline.edges.filter((e) => e.to.split(".")[0] === nodeId);
  const latest = latestByNode(attempts);
  return (
    <div className="inputs-tab">
      <section className="input-tables" aria-label="Input tables">
        <p className="output-title">Input tables</p>
        {incoming.length === 0 ? (
          <p className="muted">This step reads no other step. It starts the flow.</p>
        ) : (
          <ul className="input-list">
            {incoming.map((e) => {
              const [from = "", port = ""] = e.from.split(".");
              const producer = latest.get(from);
              return (
                <InputRow
                  key={e.to}
                  port={e.to.split(".")[1] ?? ""}
                  from={from}
                  fromPort={port}
                  attempt={hasOutputs(producer) ? producer : undefined}
                />
              );
            })}
          </ul>
        )}
      </section>
      {node && isCodeOperator(node.operator) && (
        <CodeFound pipeline={pipeline} nodeId={nodeId} params={node.params} attempt={hasOutputs(latest.get(nodeId)) ? latest.get(nodeId) : undefined} />
      )}
      {node && operator && (
        <Settings
          key={`${pipeline.id}/${nodeId}`}
          pipeline={pipeline}
          nodeId={nodeId}
          params={node.params}
          schema={operator.params_schema}
          skip={isCodeOperator(operator.id) ? ["source", "parameters", "output"] : []}
        />
      )}
    </div>
  );
}

function InputRow({ port, from, fromPort, attempt }: { port: string; from: string; fromPort: string; attempt: Attempt | undefined }) {
  const select = useSelection((s) => s.selectNode);
  const outputs = useOutputs(attempt?.id);
  const artifact = outputs.data?.find((o) => o.port === fromPort)?.artifact;
  const page = useTablePage(artifact?.media_type === PARQUET ? artifact.id : undefined, 0, 1);
  const size = artifact?.media_type !== PARQUET ? undefined : page.data;
  return (
    <li className="input-row">
      <span className="input-port">{port}</span>
      <span className="input-arrow" aria-hidden="true">←</span>
      <button type="button" className="input-source" onClick={() => select(from)}>
        {from}.{fromPort}
      </button>
      <span className="input-size">
        {!attempt ? "not run yet" : size ? `${size.total_rows} rows × ${size.total_columns} cols` : artifact ? "" : "…"}
      </span>
    </li>
  );
}

type Field = { name: string; type: string; enum?: string[]; items?: { type?: string }; minimum?: number; maximum?: number };

function fieldsOf(schema: Record<string, unknown>, skip: string[]): Field[] {
  const properties = (schema.properties ?? {}) as Record<string, Omit<Field, "name">>;
  return Object.entries(properties)
    .filter(([name]) => !skip.includes(name))
    .map(([name, spec]) => ({ name, ...spec }));
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

function Settings({ pipeline, nodeId, params, schema, skip }: {
  pipeline: PipelineVersion;
  nodeId: string;
  params: Record<string, unknown>;
  schema: Record<string, unknown>;
  skip: string[];
}) {
  const fields = fieldsOf(schema, skip);
  const initial: Draft = Object.fromEntries(fields.map((f) => [f.name, toDraft(params[f.name])]));
  const [draft, setDraft] = useState<Draft>(initial);
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);
  const changed = fields.some((f) => draft[f.name] !== initial[f.name]);
  if (fields.length === 0) return null;

  const run = () => {
    const next: Record<string, unknown> = { ...params };
    for (const f of fields) {
      const value = fromDraft(f, draft[f.name] ?? "");
      if (value === undefined) delete next[f.name];
      else next[f.name] = value;
    }
    const version = setParams(pipeline, nodeId, next);
    // Rust compiles and checks the new version; its errors are shown below (rule 3).
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };
  const set = (name: string, value: string | boolean) => setDraft({ ...draft, [name]: value });

  return (
    <section className="settings" aria-label="Settings">
      <p className="output-title">Settings</p>
      <div className="settings-grid">
        {fields.map((f) => (
          <label key={f.name} className="setting">
            <span className="setting-name">{f.name.replaceAll("_", " ")}</span>
            <SettingInput field={f} value={draft[f.name] ?? ""} onChange={(v) => set(f.name, v)} />
          </label>
        ))}
      </div>
      <div className="settings-actions">
        {saveAndRun.isError && <span role="alert" className="error">{saveAndRun.error.message}</span>}
        <span className="spacer" />
        {changed && (
          <button type="button" className="page-btn" onClick={() => setDraft(initial)}>
            Reset
          </button>
        )}
        <button type="button" className="run-code" disabled={!changed || saveAndRun.isPending} onClick={run}>
          {saveAndRun.isPending ? "Starting…" : "Run with these settings"}
        </button>
      </div>
    </section>
  );
}

function SettingInput({ field, value, onChange }: { field: Field; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const label = field.name;
  if (field.type === "boolean") {
    return <input aria-label={label} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.enum) {
    return (
      <select aria-label={label} value={String(value)} onChange={(e) => onChange(e.target.value)}>
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
        aria-label={label}
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
      aria-label={label}
      type="text"
      value={String(value)}
      placeholder={field.type === "array" ? "comma separated" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

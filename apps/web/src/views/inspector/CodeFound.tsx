import type { Attempt, CodeInterface, CodeParameter, PipelineVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { useState } from "react";

import { useArtifactText, useOutputs, useSaveAndRun } from "../../api/hooks.ts";
import { setParams } from "../../flow/edit.ts";
import { useSelection } from "../../workbench/selection.ts";

type Props = { pipeline: PipelineVersion; nodeId: string; params: Record<string, unknown>; attempt: Attempt | undefined };

/** What the last run found in the code: names it reads, settings it could expose, tables it
 * could pass on. Suggestions the user confirms; the code itself is never changed (ADR-0021). */
export function CodeFound({ pipeline, nodeId, params, attempt }: Props) {
  const outputs = useOutputs(attempt?.id);
  const text = useArtifactText(outputs.data?.find((o) => o.port === "interface")?.artifact.id);
  if (!attempt) return <p className="muted">Run the step to see what sprisk finds in your code.</p>;
  if (outputs.isError) return <p role="alert" className="error">{outputs.error.message}</p>;
  if (text.isError) return <p role="alert" className="error">{text.error.message}</p>;
  if (outputs.data && !outputs.data.some((o) => o.port === "interface")) {
    return <p className="muted">This step's version does not report its interface. Edit and run it to upgrade.</p>;
  }
  if (text.data === undefined) return <p className="muted">Loading…</p>;
  let found: CodeInterface;
  try {
    found = parse("CodeInterface", JSON.parse(text.data));
  } catch (e) {
    return <p role="alert" className="error">Unreadable interface report: {e instanceof Error ? e.message : String(e)}</p>;
  }
  return <FoundForm key={attempt.id} pipeline={pipeline} nodeId={nodeId} params={params} found={found} />;
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

function FoundForm({ pipeline, nodeId, params, found }: { pipeline: PipelineVersion; nodeId: string; params: Record<string, unknown>; found: CodeInterface }) {
  const saved = (params.parameters ?? {}) as Record<string, unknown>;
  const initial: Exposed = Object.fromEntries(found.parameters.filter((p) => p.name in saved).map((p) => [p.name, startValue(p, saved[p.name])]));
  const savedOutput = typeof params.output === "string" ? params.output : "";
  const [exposed, setExposed] = useState<Exposed>(initial);
  const [output, setOutput] = useState(savedOutput);
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);
  const changed = JSON.stringify(exposed) !== JSON.stringify(initial) || output !== savedOutput;
  const tables = found.outputs.filter((o) => o.rows !== undefined);
  const unbound = found.inputs.filter((i) => !i.bound);

  const run = () => {
    const next: Record<string, unknown> = { source: params.source };
    const values = Object.fromEntries(found.parameters.filter((p) => p.name in exposed).map((p) => [p.name, typed(p, exposed[p.name] ?? "")]));
    if (Object.keys(values).length > 0) next.parameters = values;
    if (output !== "") next.output = output;
    const version = setParams(pipeline, nodeId, next);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };

  return (
    <section className="found" aria-label="Found in your code">
      <p className="output-title">Found in your code</p>

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

      <p className="found-label">Pass on to the next step</p>
      <div role="radiogroup" aria-label="Output" className="found-list">
        <label className="found-radio">
          <input type="radio" name={`out-${nodeId}`} checked={output === ""} onChange={() => setOutput("")} />
          <span className="muted">what <code>sprisk.output()</code> gives, or the input unchanged</span>
        </label>
        {tables.map((o) => (
          <label key={o.name} className="found-radio">
            <input
              type="radio"
              name={`out-${nodeId}`}
              aria-label={`${o.name} · ${o.rows} rows × ${o.columns} cols`}
              checked={output === o.name}
              onChange={() => setOutput(o.name)}
            />
            <span className="mono">{o.name}</span>
            <span className="found-meta">{o.rows} rows × {o.columns} cols</span>
          </label>
        ))}
      </div>

      {unbound.length > 0 && (
        <>
          <p className="found-label">Names read but never defined</p>
          <ul className="found-list">
            {unbound.map((i) => (
              <li key={i.name} className="found-unbound">
                <span className="mono">{i.name}</span> <span className="error">nothing defines it; the code fails if it reaches it</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="settings-actions">
        {saveAndRun.isError && <span role="alert" className="error">{saveAndRun.error.message}</span>}
        <span className="spacer" />
        <button type="button" className="run-code" disabled={!changed || saveAndRun.isPending} onClick={run}>
          {saveAndRun.isPending ? "Starting…" : "Run with these settings"}
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

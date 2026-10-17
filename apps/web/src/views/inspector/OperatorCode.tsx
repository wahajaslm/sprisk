import type { Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useOperatorSource, useSaveAndRun } from "../../api/hooks.ts";
import { setNodeCode } from "../../flow/edit.ts";
import { useViewSelection } from "../../workbench/instance.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { CodeInput } from "../CodeInput.tsx";
import { PlayIcon } from "../Icons.tsx";
import { Loading } from "../../components/ui/Loading.tsx";

const ignore = () => undefined;

/** Why a step may not carry its own code, mirroring the compiler (ADR-0028); undefined: it may. */
export function notEditable(operator: Operator): string | undefined {
  const properties = (operator.params_schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  if (Object.values(properties).some((p) => p["x-sprisk-local-path"] === true)) {
    return "This step reads files, so its code stays the checked built-in one.";
  }
  if (operator.effects !== "pure") return "This step has side effects, so its code stays the built-in one.";
  return undefined;
}

type Props = { pipeline: PipelineVersion; nodeId: string; operator: Operator };

/** A step's real code. Edit turns it into this step's own code in a new version; Revert goes
 * back to the built-in (ADR-0028). */
export function OperatorCode({ pipeline, nodeId, operator }: Props) {
  const builtin = useOperatorSource(operator.id);
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  const own = node?.code;
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const saveAndRun = useSaveAndRun(useViewSelection().runId);
  const showRun = useSelection((s) => s.showRun);
  if (builtin.isPending) return <Loading text="Loading code…" />;
  if (builtin.isError) return <p role="alert" className="error">{builtin.error.message}</p>;

  const shown = own?.source ?? builtin.data.text;
  const fn = own?.function ?? operator.entrypoint.split(":")[1] ?? "";
  const blocked = notEditable(operator);
  const save = (code: Parameters<typeof setNodeCode>[2]) => {
    const version = setNodeCode(pipeline, nodeId, code);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };
  const run = (source: string) => {
    if (source.trim() !== "" && !saveAndRun.isPending) save({ source, function: fn });
  };
  const editing = draft !== undefined;
  return (
    <div className="code-editor">
      <div className="code-actions">
        <span className="muted">
          <span className="tech">{builtin.data.path}</span>
          {own ? " · edited in this flow" : " · built-in"}
        </span>
        <span className="spacer" />
        {saveAndRun.isError && <span role="alert" className="error">{saveAndRun.error.message}</span>}
        {blocked ? (
          <span className="muted">{blocked}</span>
        ) : editing ? (
          <button type="button" className="run-code" disabled={saveAndRun.isPending} onClick={() => run(draft)}>
            <PlayIcon />
            {saveAndRun.isPending ? "Starting…" : "Run code"}
          </button>
        ) : (
          <button type="button" className="page-btn" onClick={() => setDraft(shown)}>
            Edit
          </button>
        )}
        {own && !editing && (
          <button type="button" className="page-btn" disabled={saveAndRun.isPending} onClick={() => save(undefined)}>
            Revert to built-in
          </button>
        )}
      </div>
      <CodeInput
        value={editing ? draft : shown}
        label={`Code of ${builtin.data.path}`}
        onChange={editing ? setDraft : ignore}
        onRun={editing ? run : ignore}
        readOnly={!editing}
      />
    </div>
  );
}

import type { PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useSaveAndRun } from "../api/hooks.ts";
import { setCodeSource } from "../flow/edit.ts";
import { useSelection } from "../workbench/selection.ts";
import { CodeInput } from "./CodeInput.tsx";

/** Edit a code step. Running saves a new pipeline version and starts a run of it; the
 * code itself only ever runs in a worker (ADR-0020). */
export function CodeEditor({ pipeline, nodeId, source }: { pipeline: PipelineVersion; nodeId: string; source: string }) {
  const [draft, setDraft] = useState(source);
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);

  const run = (source: string) => {
    if (source === "" || saveAndRun.isPending) return;
    const version = setCodeSource(pipeline, nodeId, source);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };

  const overrides = Object.entries((pipeline.nodes.find((n) => n.id === nodeId)?.params.parameters ?? {}) as Record<string, unknown>);
  return (
    <div className="code-editor">
      {overrides.length > 0 && (
        <p className="overrides">
          Runs with {overrides.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")} (set in Inputs). The code below is unchanged.
        </p>
      )}
      <CodeInput label={`Code for ${nodeId}`} value={draft} onChange={setDraft} onRun={run} />
      <div className="code-actions">
        <span className="muted">Shift+Enter runs. Each run is saved as a new version.</span>
        <span className="spacer" />
        {saveAndRun.isError && <span role="alert" className="error">{saveAndRun.error.message}</span>}
        <button type="button" className="run-code" disabled={saveAndRun.isPending || draft === ""} onClick={() => run(draft)}>
          {saveAndRun.isPending ? "Starting…" : "Run code"}
        </button>
      </div>
    </div>
  );
}

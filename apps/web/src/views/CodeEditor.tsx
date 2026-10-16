import type { PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useSaveAndRun } from "../api/hooks.ts";
import { setCodeSource } from "../flow/edit.ts";
import { useSelection } from "../workbench/selection.ts";

/** Edit a code step. Running saves a new pipeline version and starts a run of it; the
 * code itself only ever runs in a worker (ADR-0020). */
export function CodeEditor({ pipeline, nodeId, source }: { pipeline: PipelineVersion; nodeId: string; source: string }) {
  const [draft, setDraft] = useState(source);
  const saveAndRun = useSaveAndRun();
  const showRun = useSelection((s) => s.showRun);

  const run = () => {
    const version = setCodeSource(pipeline, nodeId, draft);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };

  return (
    <div className="code-editor">
      <textarea
        aria-label={`Code for ${nodeId}`}
        className="code-input"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            run();
          }
        }}
      />
      <div className="code-actions">
        <span className="muted">Shift+Enter runs. Each run is saved as a new version.</span>
        <span className="spacer" />
        {saveAndRun.isError && <span role="alert" className="error">{saveAndRun.error.message}</span>}
        <button type="button" className="run-code" disabled={saveAndRun.isPending || draft === ""} onClick={run}>
          {saveAndRun.isPending ? "Starting…" : "Run code"}
        </button>
      </div>
    </div>
  );
}

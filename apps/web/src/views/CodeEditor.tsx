import type { Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";
import { useViewSelection } from "../workbench/instance.tsx";

import { useOperatorsByRef, useSaveAndRun } from "../api/hooks.ts";
import { setCodeSource } from "../flow/edit.ts";
import { cellNumber, isNotebookStep, notebookSteps, withSource } from "../flow/notebook.ts";
import { useSelection } from "../workbench/selection.ts";
import { CodeInput } from "./CodeInput.tsx";
import { PlayIcon } from "./Icons.tsx";
import { useSaveCells } from "./useSaveCells.ts";

/** Edit a code step. Running saves a new pipeline version and starts a run of it; the
 * code itself only ever runs in a worker (ADR-0020). A notebook step's links are read again
 * from its new code, as in the notebook view (ADR-0033). */
export function CodeEditor({ pipeline, nodeId, source }: { pipeline: PipelineVersion; nodeId: string; source: string }) {
  const [draft, setDraft] = useState(source);
  const { saveAndRun, runSource } = useRunSource(pipeline, nodeId);
  const operators = useOperatorsByRef();
  const byRef = operators.data ?? new Map<string, Operator>();
  const cells = useSaveCells(pipeline, byRef);
  const isNotebookCode = isNotebookStep(pipeline.nodes.find((n) => n.id === nodeId)?.operator ?? "");
  const pending = saveAndRun.isPending || cells.pending || (isNotebookCode && operators.isPending);

  const run = (source: string) => {
    if (source === "" || pending) return;
    if (isNotebookCode) {
      const steps = notebookSteps(pipeline, byRef);
      void cells.save(withSource(steps, nodeId, source), cellNumber(steps, { step: steps.findIndex((s) => s.nodeId === nodeId), cell: 0 }));
      return;
    }
    runSource(source);
  };
  const problem = cells.problem ?? operators.error?.message ?? (saveAndRun.isError ? saveAndRun.error.message : undefined);

  return (
    <div className="code-editor">
      <Overrides pipeline={pipeline} nodeId={nodeId} />
      {/* Like VS Code's editor title bar: what this is on the left, Run on the right. */}
      <div className="code-actions">
        <span className="muted">Python · Shift+Enter runs · each run is saved as a new version</span>
        <span className="spacer" />
        {problem && <span role="alert" className="error">{problem}</span>}
        <button type="button" className="run-code" disabled={pending || draft === ""} onClick={() => run(draft)}>
          <PlayIcon />
          {pending ? "Starting…" : "Run code"}
        </button>
      </div>
      {cells.notes.map((note, i) => (
        <p key={i} className="import-note">
          {note}
        </p>
      ))}
      <CodeInput label={`Code for ${nodeId}`} value={draft} onChange={setDraft} onRun={run} />
    </div>
  );
}

/** Save a v1 code step with new source as a new version, run it, and show it (ADR-0020). */
export function useRunSource(pipeline: PipelineVersion, nodeId: string) {
  const saveAndRun = useSaveAndRun(useViewSelection().runId);
  const showRun = useSelection((s) => s.showRun);
  const runSource = (source: string) => {
    const version = setCodeSource(pipeline, nodeId, source);
    saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
  };
  return { saveAndRun, runSource };
}

/** Exposed settings replace literals in a copy of the code; say so above the code. */
export function Overrides({ pipeline, nodeId }: { pipeline: PipelineVersion; nodeId: string }) {
  const overrides = Object.entries((pipeline.nodes.find((n) => n.id === nodeId)?.params.parameters ?? {}) as Record<string, unknown>);
  if (overrides.length === 0) return null;
  return (
    <p className="overrides">
      Runs with {overrides.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")} (set in Inputs). The code below is unchanged.
    </p>
  );
}

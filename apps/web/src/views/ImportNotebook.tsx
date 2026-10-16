import type { CodeSplit } from "@sprisk/contracts";
import { useState } from "react";

import { useSplitCells } from "../api/code.ts";
import { usePipelineVersions, useSavePipelineVersion } from "../api/hooks.ts";
import { cellsFromFile, flowFromSplit } from "../flow/notebook.ts";
import { useEscape } from "../hooks/useEscape.ts";
import { useSelection } from "../workbench/selection.ts";

/** Local mode's one project (the CLI's LOCAL_PROJECT), for the very first flow. */
const LOCAL_PROJECT = "prj_00000000000000000000000000";

type Picked = { name: string; text: string };

/** A notebook or pasted cells become a new flow (ADR-0031): Python reads the cells, the person
 * sees the steps, links and code it suggests, and only then is the flow made. It is not run:
 * the notebook may come from someone else, so the person reads it and presses Run graph. */
export function ImportNotebook({ onClose }: { onClose: () => void }) {
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<Picked | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const split = useSplitCells();
  const versions = usePipelineVersions();
  const save = useSavePipelineVersion();
  const selectPipelineVersion = useSelection((s) => s.selectPipelineVersion);
  useEscape(onClose);

  const read = () => {
    setProblem(undefined);
    try {
      const cells = file ? cellsFromFile(file.name, file.text) : cellsFromFile("pasted cells", pasted);
      if (cells.length === 0) setProblem("There are no code cells to read.");
      else split.mutate(cells);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const create = (found: CodeSplit) => {
    const version = flowFromSplit(found, versions.data?.[0]?.project_id ?? LOCAL_PROJECT);
    save.mutate(version, {
      onSuccess: () => {
        selectPipelineVersion(version.id);
        onClose();
      },
    });
  };
  const error = problem ?? split.error?.message ?? save.error?.message;

  return (
    <div className="lightbox" onClick={onClose}>
      <section className="import-panel" role="dialog" aria-modal="true" aria-label="Import notebook" onClick={(e) => e.stopPropagation()}>
        <p className="found-label">Import notebook</p>
        <label className="muted">
          Open a .ipynb, or a .py with # %% cells{" "}
          <input
            type="file"
            accept=".ipynb,.py"
            aria-label="Notebook file"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (!picked) return;
              picked.text().then(
                (text) => setFile({ name: picked.name, text }),
                (e: unknown) => setProblem(`Could not read ${picked.name}: ${e instanceof Error ? e.message : String(e)}`),
              );
            }}
          />
        </label>
        <textarea
          aria-label="Cells"
          placeholder={"Or paste cells, separated by # %% lines"}
          value={pasted}
          disabled={file !== undefined}
          onChange={(e) => setPasted(e.target.value)}
        />
        {error && <p role="alert" className="error">{error}</p>}
        {split.data && <Preview split={split.data} />}
        <div className="settings-actions">
          <button type="button" className="page-btn" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="button" className="page-btn" disabled={split.isPending} onClick={read}>
            {split.isPending ? "Reading…" : "Read cells"}
          </button>
          {split.data && split.data.steps.length > 0 && (
            <button type="button" className="run-code" disabled={save.isPending} onClick={() => create(split.data)}>
              {save.isPending ? "Creating…" : "Create flow"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** The steps Python suggests: which cells each holds, what it reads and what it passes on. */
function Preview({ split }: { split: CodeSplit }) {
  if (split.steps.length === 0) return <p className="muted">No code to make steps from.</p>;
  return (
    <>
      <ol className="import-steps" aria-label="Steps">
        {split.steps.map((step, k) => {
          const reads = split.links.filter((l) => l.to_step === k).map((l) => `${l.name} from step ${l.from_step + 1}`);
          const cells = step.cells.map((c) => c + 1).join(", ");
          return (
            <li key={k} className="import-step">
              <span>
                Step {k + 1} · {step.cells.length === 1 ? "cell" : "cells"} {cells}
              </span>
              {reads.length > 0 && <span className="menu-meta">reads {reads.join(", ")}</span>}
              {step.outputs.length > 0 && <span className="menu-meta">passes on {step.outputs.join(", ")}</span>}
              <details>
                <summary className="menu-meta">Code</summary>
                <pre className="code">{step.source}</pre>
              </details>
            </li>
          );
        })}
      </ol>
      <p className="muted">Creating the flow does not run it. Read each step's code, then press Run graph.</p>
      {split.notes.map((note, i) => (
        <p key={i} className="import-note">
          {note.message}
        </p>
      ))}
    </>
  );
}

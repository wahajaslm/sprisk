import type { NotebookCell } from "@sprisk/contracts";
import { useState } from "react";

import { usePipelineVersions } from "../api/hooks.ts";
import { useSaveNotebook } from "../api/notebooks.ts";
import { cellsFromFile, firstVersion, LOCAL_PROJECT } from "../notebook/document.ts";
import { useEscape } from "../hooks/useEscape.ts";
import { useSelection } from "../workbench/selection.ts";

type Picked = { name: string; text: string };

/** A .ipynb, a `# %%` script or pasted cells become a new notebook (ADR-0036). Nothing runs:
 * the notebook may come from someone else, so the person reads it and runs its cells. */
export function ImportNotebook({ onClose }: { onClose: () => void }) {
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<Picked | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const versions = usePipelineVersions();
  const save = useSaveNotebook();
  const openNotebook = useSelection((s) => s.openNotebook);
  useEscape(onClose);

  let cells: NotebookCell[] = [];
  let unreadable: string | undefined;
  try {
    cells = file ? cellsFromFile(file.name, file.text) : cellsFromFile("pasted cells", pasted);
  } catch (e) {
    unreadable = e instanceof Error ? e.message : String(e);
  }
  const create = () => {
    setProblem(undefined);
    const title = file ? file.name.replace(/\.(ipynb|py)$/, "") : "Imported notebook";
    const version = firstVersion(versions.data?.[0]?.project_id ?? LOCAL_PROJECT, title, cells);
    save.mutate(version, {
      onSuccess: (saved) => {
        openNotebook(saved.notebook_id);
        onClose();
      },
      onError: (e) => setProblem(e.message),
    });
  };
  const code = cells.filter((c) => c.kind === "code").length;
  const error = unreadable ?? problem;

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
        {cells.length > 0 && (
          <p className="muted">
            {cells.length} {cells.length === 1 ? "cell" : "cells"}: {code} code, {cells.length - code} Markdown.
          </p>
        )}
        <p className="muted">Importing does not run anything. Read the cells, then run them in the notebook.</p>
        <div className="settings-actions">
          <button type="button" className="page-btn" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="button" className="run-code" disabled={cells.length === 0 || save.isPending} onClick={create}>
            {save.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </section>
    </div>
  );
}

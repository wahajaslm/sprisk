import type { NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useSavePipelineVersion } from "../../api/hooks.ts";
import { useSaveNotebook } from "../../api/notebooks.ts";
import { nextNotebookVersion } from "../../notebook/document.ts";
import { stepsOutOfFlow } from "../../notebook/sync.ts";
import { useSelection } from "../../workbench/selection.ts";
import { RenameIcon, TrashIcon } from "../Icons.tsx";

type Mode = { kind: "idle" } | { kind: "renaming" } | { kind: "confirming"; steps: number } | { kind: "refused"; readers: string[] };

/** Notebooks to open, each with Rename and Delete shown on hover or focus, as in VS Code's
 * explorer. `flow` is the flow version a deleted notebook's steps leave (ADR-0041). */
export function NotebookList({ label, notebooks, open, flow, onOpen }: { label: string; notebooks: NotebookVersion[]; open: string | undefined; flow: PipelineVersion | undefined; onOpen: (id: string) => void }) {
  return (
    <ul aria-label={label}>
      {notebooks.map((v) => (
        <NotebookItem key={v.notebook_id} notebook={v} allNotebooks={notebooks} current={v.notebook_id === open} flow={flow} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function NotebookItem({ notebook, allNotebooks, current, flow, onOpen }: { notebook: NotebookVersion; allNotebooks: NotebookVersion[]; current: boolean; flow: PipelineVersion | undefined; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const openButton = useRef<HTMLButtonElement>(null);
  const save = useSaveNotebook();
  const savePipeline = useSavePipelineVersion();
  const selectPipelineVersion = useSelection((s) => s.selectPipelineVersion);
  const busy = save.isPending || savePipeline.isPending;
  const error = savePipeline.error ?? save.error;
  const { title } = notebook;

  // Keyboard focus goes back to the row, not to the page, when an inline edit closes.
  const close = () => {
    flushSync(() => setMode({ kind: "idle" }));
    openButton.current?.focus();
  };
  // Only the title changes: the cells, the flow and the steps' node ids stay.
  const rename = (text: string) => {
    close();
    const next = text.trim();
    if (next !== "" && next !== title) save.mutate(nextNotebookVersion(notebook, { title: next }));
  };
  const plan = () => (flow ? stepsOutOfFlow(flow, notebook.notebook_id) : ({ unchanged: true } as const));
  const askToDelete = () => {
    const out = plan();
    if ("refused" in out) return setMode({ kind: "refused", readers: out.refused });
    setMode({ kind: "confirming", steps: (flow?.nodes ?? []).filter((n) => n.from_notebook?.notebook_id === notebook.notebook_id).length });
  };
  // The flow is saved first: if the notebook's save then fails, deleting again finishes it.
  const remove = () => {
    const out = plan();
    if ("refused" in out) return setMode({ kind: "refused", readers: out.refused });
    close();
    const removed = nextNotebookVersion(notebook, { removed: true });
    const afterDelete = () => {
      if (current) {
        const remaining = allNotebooks.filter((v) => v.notebook_id !== notebook.notebook_id);
        onOpen(remaining[0]?.notebook_id ?? "");
      }
    };
    if ("version" in out) {
      savePipeline.mutate(out.version, {
        onSuccess: () => {
          selectPipelineVersion(out.version.id);
          save.mutate(removed, { onSuccess: afterDelete });
        },
      });
    } else {
      save.mutate(removed, { onSuccess: afterDelete });
    }
  };

  return (
    <li className="nb-item">
      <div className="nb-item-row">
        {mode.kind === "renaming" ? (
          <input
            className="nb-item-title"
            aria-label={`Title of ${title}`}
            defaultValue={title}
            maxLength={200}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(e.currentTarget.value);
              if (e.key === "Escape") close();
            }}
            onBlur={() => setMode({ kind: "idle" })}
          />
        ) : (
          <button ref={openButton} type="button" className="nb-item-open" aria-current={current} onClick={() => onOpen(notebook.notebook_id)}>
            {title}
          </button>
        )}
        <span className="nb-item-actions">
          <button type="button" className="nb-icon" aria-label={`Rename ${title}`} title="Rename" disabled={busy} onClick={() => setMode({ kind: "renaming" })}>
            <RenameIcon />
          </button>
          <button type="button" className="nb-icon" aria-label={`Delete ${title}`} title="Delete" disabled={busy} onClick={askToDelete}>
            <TrashIcon />
          </button>
        </span>
      </div>
      {mode.kind === "confirming" && (
        <div className="nb-item-confirm" role="group" aria-label={`Delete ${title}?`}>
          <span>
            Delete {title}?{mode.steps > 0 && ` Its ${mode.steps} ${mode.steps === 1 ? "step leaves" : "steps leave"} the flow.`}
          </span>
          <button type="button" className="nb-action alert" onClick={remove}>
            Delete
          </button>
          <button type="button" className="nb-action" autoFocus onClick={close}>
            Cancel
          </button>
        </div>
      )}
      {mode.kind === "refused" && (
        <div className="nb-item-confirm">
          <p role="alert" className="error">
            {title} cannot be deleted: {mode.readers.join(", ")} {mode.readers.length === 1 ? "reads" : "read"} its steps' outputs. Remove or relink {mode.readers.length === 1 ? "it" : "them"} first.
          </p>
          <button type="button" className="nb-action" autoFocus onClick={close}>
            Close
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error.message}
        </p>
      )}
    </li>
  );
}

import type { DisplayItem, NotebookCell, NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { useEffect, useRef, useState } from "react";

import { useOperators, useSavePipelineVersion } from "../../api/hooks.ts";
import { executeCell, interruptKernel, restartKernel, splitNotebook, useSaveNotebook } from "../../api/notebooks.ts";
import { useCollapsed } from "../../notebook/collapsed.ts";
import { nextNotebookVersion, toIpynb } from "../../notebook/document.ts";
import { ranOutOfOrder } from "../../notebook/node.ts";
import { type Ran, useOutputs } from "../../notebook/outputs.ts";
import { cellsFromFlow, stepsIntoFlow, stepsOutOfFlow } from "../../notebook/sync.ts";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon, ExportIcon, RedoIcon, RunAllIcon, TrashIcon, UndoIcon } from "../Icons.tsx";
import { codeCellIds, NotebookCells, notebookKeys } from "./NotebookCells.tsx";
import { useCellEditing } from "./useCellEditing.ts";

type Queued = { id: string; code: string };

const EMPTY: Record<string, Ran> = {};

/** A notebook on a live kernel, laid out as VS Code's notebook editor (ADR-0035, ADR-0036).
 * Cells share the kernel's state and run in the order the person chooses. Save and Run All
 * rebuild its steps in `flow`; code edited on the flow comes back into its cells (ADR-0037). */
export function SessionNotebook({ saved, flow }: { saved: NotebookVersion; flow: PipelineVersion | undefined }) {
  const notebookId = saved.notebook_id;
  const edit = useCellEditing(saved.cells, saved.title);
  const { cells, title, active } = edit;
  const [running, setRunning] = useState<string | undefined>();
  const [queued, setQueued] = useState<string[]>([]);
  // What the running cell has shown so far (ADR-0041); its result replaces it when it ends.
  const [live, setLive] = useState<{ cellId: string; outputs: DisplayItem[] }>();
  const [problem, setProblem] = useState<string | undefined>();
  const [news, setNews] = useState<string | undefined>();
  // Cells as the flow's code has them, waiting for the person's choice over their unsaved edits.
  const [incoming, setIncoming] = useState<NotebookCell[] | undefined>();
  const savePipeline = useSavePipelineVersion();
  const selectPipelineVersion = useSelection((s) => s.selectPipelineVersion);  const results = useOutputs((s) => s.byNotebook[notebookId]) ?? EMPTY;
  const setResult = useOutputs((s) => s.set);
  const clearResults = useOutputs((s) => s.clear);
  const toggleFold = useCollapsed((s) => s.toggle);
  const foldOutputs = useCollapsed((s) => s.setOutputsCollapsed);
  const save = useSaveNotebook();
  const pending = useRef<Queued[]>([]);
  const looping = useRef(false);

  const edited = title !== saved.title || JSON.stringify(cells) !== JSON.stringify(saved.cells);

  const remove = (index: number) => {
    const nextCells = edit.removeAt(index);
    if (flow) {
      const version = nextNotebookVersion(saved, { cells: nextCells, title, ...inFlow() });
      save.mutate(version, {
        onSuccess: (savedVer) => {
          void syncFlow(savedVer);
        },
      });
    }
  };
  /** Cells run one at a time, in the order asked, as Jupyter queues them. An error stops the
   * rest of the queue. */
  const enqueue = (items: Queued[]) => {
    pending.current.push(...items);
    setQueued(pending.current.map((q) => q.id));
    if (!looping.current) void drain();
  };
  const drain = async () => {
    looping.current = true;
    setProblem(undefined);
    for (let next = pending.current.shift(); next; next = pending.current.shift()) {
      setQueued(pending.current.map((q) => q.id));
      setRunning(next.id);
      try {
        const cellId = next.id;
        const result = await executeCell(notebookId, cellId, next.code, (outputs) => setLive({ cellId, outputs }));
        setResult(notebookId, next.id, { code: next.code, result });
        if (result.status !== "ok") pending.current = [];
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
        pending.current = [];
      }
    }
    setRunning(undefined);
    setLive(undefined);
    setQueued([]);
    looping.current = false;
  };
  const codeOf = (from: number, to: number) =>
    cells.slice(from, to).flatMap((c) => (c.kind === "code" && c.source.trim() !== "" ? [{ id: c.id, code: c.source }] : []));
  const runCell = (index: number, code: string, advance: boolean) => {
    const cell = cells[index];
    if (!cell) return;
    edit.setSource(index, code);
    if (cell.kind === "markdown") edit.stopEditing(cell.id);
    else if (code.trim() !== "") enqueue([{ id: cell.id, code }]);
    if (!advance) return;
    if (index === cells.length - 1) edit.insert(cells.length, "code");
    else edit.select(index + 1, { focus: true });
  };
  const kernel = (action: () => Promise<void>) => action().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  const interrupt = () => {
    pending.current = [];
    setQueued([]);
    void kernel(() => interruptKernel(notebookId));
  };
  const restart = () => {
    pending.current = [];
    setQueued([]);
    void kernel(async () => {
      await restartKernel(notebookId);
      clearResults(notebookId);
    });
  };
  const operators = useOperators();
  const current = (): NotebookVersion => ({ ...saved, title, cells });
  const failed = (e: unknown) => setProblem(e instanceof Error ? e.message : String(e));
  // The flow this notebook belongs to: the one it names, or the one on screen.
  const inFlow = () => {
    const id = saved.pipeline_version_id ?? flow?.id;
    return id ? { pipeline_version_id: id } : {};
  };

  /** This notebook's steps rebuilt in its flow from `version`'s cells (ADR-0037). */
  const syncFlow = async (version: NotebookVersion) => {
    const split = await splitNotebook(version.cells.filter((c) => c.kind === "code").map((c) => c.source));
    const byRef = new Map((operators.data ?? []).map((o) => [o.id, o]));
    const done = stepsIntoFlow({ base: flow, projectId: version.project_id, notebook: version, split, previous: saved, operators: byRef });
    if ("refused" in done) return setProblem(done.refused);
    if ("unchanged" in done) return;
    const made = await savePipeline.mutateAsync(done.version);
    selectPipelineVersion(made.id);
    const steps = made.nodes.filter((n) => n.from_notebook?.notebook_id === version.notebook_id).length;
    setNews(`Flow updated: ${steps} ${steps === 1 ? "step" : "steps"} from this notebook.`);
    // A notebook's first flow: it belongs to it from now on.
    if (!version.pipeline_version_id) await save.mutateAsync(nextNotebookVersion(version, { pipeline_version_id: made.id }));
  };
  const saveNow = async () => {
    setProblem(undefined);
    setIncoming(undefined);
    try {
      const version = edited ? await save.mutateAsync(nextNotebookVersion(saved, { cells, title, ...inFlow() })) : saved;
      await syncFlow(version);
    } catch (e) {
      failed(e);
    }
  };
  const runAll = () => {
    enqueue(codeOf(0, cells.length));
    void saveNow();
  };

  // Code edited on the flow comes back into the cells; unsaved edits are never overwritten.
  useEffect(() => {
    if (!flow) return;
    const fromFlow = cellsFromFlow(flow, saved);
    if (!fromFlow) return;
    if (edited) {
      setIncoming(fromFlow);
      return;
    }
    takeFromFlow(fromFlow);
    // Only when the flow or the saved notebook changes, not on each keystroke.
  }, [flow?.id, saved.id]);

  const takeFromFlow = (fromFlow: NotebookCell[]) => {
    setIncoming(undefined);
    edit.reshape(() => fromFlow, active);
    setNews("Cells updated from code edited on the flow.");
    save.mutate(nextNotebookVersion(saved, { cells: fromFlow, ...inFlow() }), { onError: failed });
  };

  const onKeyDown = notebookKeys(edit, { onRun: runCell, onRemove: remove, onSave: () => void saveNow(), foldKey: notebookId, toggleFold });

  const openNotebook = useSelection((s) => s.openNotebook);
  const handleDeleteNotebook = () => {
    const confirmed = window.confirm(
      `Delete notebook "${title}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    const out = flow ? stepsOutOfFlow(flow, notebookId, saved.cells) : ({ unchanged: true } as const);
    if ("refused" in out) {
      alert(
        `"${title}" cannot be deleted because the following steps read its outputs: ${out.refused.join(", ")}. Remove or relink them first.`
      );
      return;
    }

    const removed = nextNotebookVersion(saved, { removed: true });
    const finish = () => {
      openNotebook("");
    };

    if ("version" in out) {
      savePipeline.mutate(out.version, {
        onSuccess: () => {
          selectPipelineVersion(out.version.id);
          save.mutate(removed, { onSuccess: finish });
        },
        onError: failed,
      });
    } else {
      save.mutate(removed, { onSuccess: finish, onError: failed });
    }
  };

  const outOfOrder = ranOutOfOrder(cells, results);
  return (
    <div className="notebook" aria-label="Notebook">
      <div className="nb-toolbar" role="toolbar" aria-label="Notebook actions">
        <button type="button" className="nb-action" onClick={() => edit.insert(active + 1, "code")}>
          <AddIcon /> Code
        </button>
        <button type="button" className="nb-action" onClick={() => edit.insert(active + 1, "markdown")}>
          <AddIcon /> Markdown
        </button>
        <button
          type="button"
          className="nb-action"
          disabled={cells.length === 0}
          onClick={() => remove(active)}
          aria-label="Delete Cell"
          title="Delete selected cell (Delete / Backspace / dd)"
        >
          <TrashIcon />
        </button>
        <span className="nb-divider" />
        <button
          type="button"
          className="nb-action"
          disabled={!edit.canUndo}
          onClick={edit.undo}
          aria-label="Undo"
          title="Undo cell action (Z / ⌘Z)"
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="nb-action"
          disabled={!edit.canRedo}
          onClick={edit.redo}
          aria-label="Redo"
          title="Redo cell action (⇧Z / ⌘⇧Z / ⌘Y)"
        >
          <RedoIcon />
        </button>
        <span className="nb-divider" />
        <button type="button" className="nb-action" onClick={runAll}>
          <RunAllIcon /> Run All
        </button>
        <button type="button" className="nb-action" onClick={interrupt}>
          Interrupt
        </button>
        <button type="button" className="nb-action" onClick={restart}>
          Restart
        </button>
        <button type="button" className="nb-action" aria-label="Clear All Outputs" title="Clear All Outputs" onClick={() => clearResults(notebookId)}>
          Clear
        </button>
        <button type="button" className="nb-action" aria-label="Collapse All Outputs" title="Collapse All Outputs" onClick={() => foldOutputs(notebookId, codeCellIds(cells), true)}>
          Collapse
        </button>
        <button type="button" className="nb-action" aria-label="Expand All Outputs" title="Expand All Outputs" onClick={() => foldOutputs(notebookId, codeCellIds(cells), false)}>
          Expand
        </button>
        <span className="spacer" />
        <button type="button" className="nb-action" disabled={save.isPending || savePipeline.isPending} onClick={() => void saveNow()} title="Save, and rebuild this notebook's steps in the flow">
          {edited ? "Save" : "Saved"}
        </button>
        <button type="button" className="nb-action" onClick={() => download(current(), results)}>
          <ExportIcon /> Export
        </button>
        <button
          type="button"
          className="nb-action alert"
          disabled={save.isPending || savePipeline.isPending}
          onClick={handleDeleteNotebook}
          aria-label="Delete Notebook"
          title="Delete this notebook (requires confirmation)"
        >
          <TrashIcon /> Delete
        </button>
      </div>
      <div className="nb-scroll" onKeyDown={onKeyDown}>
        <div className="nb-title-row">
          <input className="nb-title" aria-label="Notebook title" value={title} onChange={(e) => edit.setTitle(e.target.value)} />
          <span className="nb-kernel" title="One live Python kernel for this notebook. Its results are scratch; the flow runs the saved cells in its own workers.">
          <span className={`nb-kernel-dot${running ? " busy" : ""}`} /> Python 3 · {running ? "busy" : "idle"}
          </span>
        </div>
        {(problem ?? save.error?.message) && <p role="alert" className="error nb-message">{problem ?? save.error?.message}</p>}
        {news && <p className="nb-message nb-note">{news}</p>}
        {incoming && (
          <div role="alert" className="nb-message nb-incoming">
            <span>The flow's code for this notebook changed while you have unsaved edits.</span>
            <button type="button" className="page-btn" onClick={() => takeFromFlow(incoming)}>
              Use the flow's code
            </button>
            <button type="button" className="page-btn" onClick={() => setIncoming(undefined)}>
              Keep mine
            </button>
          </div>
        )}
        {outOfOrder && (
          <p className="nb-message nb-note">Cells ran out of order: the kernel's state may not match reading the notebook from the top.</p>
        )}
        <NotebookCells
          edit={edit}
          runs={{ results, running, queued, live }}
          foldKey={notebookId}
          onRun={runCell}
          onRunAbove={(index) => enqueue(codeOf(0, index))}
          onRemove={remove}
        />
      </div>
    </div>
  );
}

/** The notebook as .ipynb. Only outputs of the code as it reads now go with it: a result of
 * code edited since would pair the cell with what other code did. */
function download(version: NotebookVersion, results: Record<string, Ran>) {
  const fresh = version.cells.flatMap((c) => {
    const ran = results[c.id];
    return ran && ran.code === c.source ? [[c.id, ran.result] as const] : [];
  });
  const notebook = toIpynb(version, new Map(fresh));
  const url = URL.createObjectURL(new Blob([JSON.stringify(notebook, null, 1)], { type: "application/x-ipynb+json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${version.title.replace(/[^\w.-]+/g, "_") || "notebook"}.ipynb`;
  link.click();
  URL.revokeObjectURL(url);
}

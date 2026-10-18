import type { NotebookCell, NotebookExecution, NotebookVersion } from "@sprisk/contracts";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";

import { executeCell, interruptKernel, restartKernel, useSaveNotebook } from "../../api/notebooks.ts";
import { newCellId, nextNotebookVersion, toIpynb } from "../../notebook/document.ts";
import { useOutputs } from "../../notebook/outputs.ts";
import { CodeInput } from "../CodeInput.tsx";
import { AddIcon, CheckIcon, CrossIcon, ExportIcon, PlayIcon, RunAllIcon, TrashIcon } from "../Icons.tsx";
import { CellOutputs } from "./CellOutputs.tsx";
import { CreateNode } from "./CreateNode.tsx";

type Queued = { id: string; code: string };
type Range = { first: number; last: number };

const EMPTY: Record<string, NotebookExecution> = {};

/** A notebook on a live kernel, laid out as VS Code's notebook editor (ADR-0035, ADR-0036).
 * Cells share the kernel's state and run in the order the person chooses. Running changes no
 * flow; Create node does, from the cells the person picks. */
export function SessionNotebook({ saved }: { saved: NotebookVersion }) {
  const notebookId = saved.notebook_id;
  const [cells, setCells] = useState(saved.cells);
  const [title, setTitle] = useState(saved.title);
  // Cell editors keep their own text while typing (CodeInput fit); adding, deleting or moving
  // cells remounts them so each shows its own cell's text.
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState<string | undefined>();
  const [queued, setQueued] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | undefined>();
  const [creating, setCreating] = useState<Range | undefined>();
  const results = useOutputs((s) => s.byNotebook[notebookId]) ?? EMPTY;
  const setResult = useOutputs((s) => s.set);
  const clearResults = useOutputs((s) => s.clear);
  const save = useSaveNotebook();
  const pending = useRef<Queued[]>([]);
  const looping = useRef(false);
  const cellNodes = useRef(new Map<number, HTMLDivElement>());
  const pendingD = useRef(false);
  const focusAfterRender = useRef(false);

  const edited = title !== saved.title || JSON.stringify(cells) !== JSON.stringify(saved.cells);
  const picked: Range = { first: Math.min(anchor, active), last: Math.max(anchor, active) };
  const pickedHasCode = cells.slice(picked.first, picked.last + 1).some((c) => c.kind === "code");

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    cellNodes.current.get(active)?.focus();
  });

  const reshape = (next: NotebookCell[], nextActive: number) => {
    setCells(next);
    setGeneration((g) => g + 1);
    setActive(nextActive);
    setAnchor(nextActive);
    focusAfterRender.current = true;
  };
  const select = (index: number, { extend = false, focus = false } = {}) => {
    if (index < 0 || index >= cells.length) return;
    pendingD.current = false;
    setActive(index);
    if (!extend) setAnchor(index);
    if (focus) cellNodes.current.get(index)?.focus();
  };
  const setSource = (index: number, source: string) => setCells((now) => now.map((c, i) => (i === index ? { ...c, source } : c)));
  const insert = (at: number, kind: NotebookCell["kind"]) => {
    const cell = { id: newCellId(), kind, source: "" };
    if (kind === "markdown") setEditing((now) => new Set(now).add(cell.id));
    reshape([...cells.slice(0, at), cell, ...cells.slice(at)], at);
  };
  const remove = (index: number) => reshape(cells.filter((_, i) => i !== index), Math.max(0, Math.min(index, cells.length - 2)));
  const setKind = (index: number, kind: NotebookCell["kind"]) => reshape(cells.map((c, i) => (i === index ? { ...c, kind } : c)), index);

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
        const result = await executeCell(notebookId, next.id, next.code);
        setResult(notebookId, next.id, result);
        if (result.status !== "ok") pending.current = [];
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
        pending.current = [];
      }
    }
    setRunning(undefined);
    setQueued([]);
    looping.current = false;
  };
  const codeOf = (from: number, to: number) =>
    cells.slice(from, to).flatMap((c) => (c.kind === "code" && c.source.trim() !== "" ? [{ id: c.id, code: c.source }] : []));
  const runCell = (index: number, code: string, advance: boolean) => {
    const cell = cells[index];
    if (!cell) return;
    setSource(index, code);
    if (cell.kind === "markdown") setEditing((now) => new Set([...now].filter((id) => id !== cell.id)));
    else if (code.trim() !== "") enqueue([{ id: cell.id, code }]);
    if (!advance) return;
    if (index === cells.length - 1) insert(cells.length, "code");
    else select(index + 1, { focus: true });
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
  const current = (): NotebookVersion => ({ ...saved, title, cells });
  const saveNow = async () => (edited ? save.mutateAsync(nextNotebookVersion(saved, { cells, title })) : saved);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (edited) void saveNow();
      return;
    }
    if (!(e.target instanceof HTMLElement) || e.target.dataset["cell"] === undefined) return;
    if (e.altKey || ((e.ctrlKey || e.metaKey) && e.key !== "Enter")) return;
    const cell = cells[active];
    if (!cell) return;
    const deleting = pendingD.current;
    pendingD.current = false;
    const key = e.key;
    if (key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (cell.kind === "markdown") setEditing((now) => new Set(now).add(cell.id));
      requestAnimationFrame(() => cellNodes.current.get(active)?.querySelector("textarea")?.focus());
    } else if (key === "Enter") {
      e.preventDefault();
      runCell(active, cell.source, e.shiftKey);
    } else if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      select(active - 1, { extend: e.shiftKey, focus: true });
    } else if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      select(active + 1, { extend: e.shiftKey, focus: true });
    } else if (key === "a") insert(active, "code");
    else if (key === "b") insert(active + 1, "code");
    else if (key === "m") setKind(active, "markdown");
    else if (key === "y") setKind(active, "code");
    else if (key === "d") {
      // D twice deletes, as in VS Code; one D alone does nothing.
      if (deleting) remove(active);
      else pendingD.current = true;
    }
  };

  const outOfOrder = ranOutOfOrder(cells, results);
  return (
    <div className="notebook" aria-label="Notebook">
      <div className="nb-toolbar" role="toolbar" aria-label="Notebook actions">
        <button type="button" className="nb-action" onClick={() => insert(active + 1, "code")}>
          <AddIcon /> Code
        </button>
        <button type="button" className="nb-action" onClick={() => insert(active + 1, "markdown")}>
          <AddIcon /> Markdown
        </button>
        <span className="nb-divider" />
        <button type="button" className="nb-action" onClick={() => enqueue(codeOf(0, cells.length))}>
          <RunAllIcon /> Run All
        </button>
        <button type="button" className="nb-action" onClick={interrupt}>
          Interrupt
        </button>
        <button type="button" className="nb-action" onClick={restart}>
          Restart
        </button>
        <button type="button" className="nb-action" onClick={() => clearResults(notebookId)}>
          Clear All Outputs
        </button>
        <span className="nb-divider" />
        <button type="button" className="nb-action" disabled={!pickedHasCode} onClick={() => setCreating(picked)}>
          Create node from cells
        </button>
        <span className="spacer" />
        <button type="button" className="nb-action" disabled={!edited || save.isPending} onClick={() => void saveNow()}>
          {edited ? "Save" : "Saved"}
        </button>
        <button type="button" className="nb-action" onClick={() => download(current(), results)}>
          <ExportIcon /> Export
        </button>
        <span className="nb-kernel" title="One live Python kernel for this notebook. Its results are scratch until a node is made from the cells.">
          <span className={`nb-kernel-dot${running ? " busy" : ""}`} /> Python 3 · {running ? "busy" : "idle"}
        </span>
      </div>
      <div className="nb-scroll" onKeyDown={onKeyDown}>
        <input className="nb-title" aria-label="Notebook title" value={title} onChange={(e) => setTitle(e.target.value)} />
        {(problem ?? save.error?.message) && <p role="alert" className="error nb-message">{problem ?? save.error?.message}</p>}
        {outOfOrder && (
          <p className="nb-message nb-note">Cells ran out of order: the kernel's state may not match reading the notebook from the top.</p>
        )}
        <AddCells onAdd={(kind) => insert(0, kind)} />
        {cells.map((cell, index) => {
          const n = index + 1;
          const result = results[cell.id];
          const state = running === cell.id ? "running" : queued.includes(cell.id) ? "queued" : undefined;
          const inPick = index >= picked.first && index <= picked.last && picked.first !== picked.last;
          const onMouseDown = (e: MouseEvent) => select(index, { extend: e.shiftKey });
          return (
            <div key={`${generation}/${cell.id}`}>
              <div
                className={`nb-cell${index === active ? " active" : ""}${inPick ? " picked" : ""}`}
                role="group"
                aria-label={`Cell ${n}`}
                tabIndex={-1}
                data-cell={n}
                ref={(el) => void (el ? cellNodes.current.set(index, el) : cellNodes.current.delete(index))}
                onMouseDown={onMouseDown}
              >
                <div className="nb-gutter">
                  {cell.kind === "code" && (
                    <button type="button" className="nb-run" aria-label={`Run cell ${n}`} title="Execute Cell (Shift+Enter)" onClick={() => runCell(index, cell.source, false)}>
                      {state === "running" ? <span className="nb-spinner" /> : <PlayIcon />}
                    </button>
                  )}
                  <span className="nb-count">{cell.kind === "code" ? count(state, result) : ""}</span>
                </div>
                <div className="nb-main">
                  <div className="nb-cell-toolbar">
                    {cell.kind === "code" && (
                      <button type="button" className="nb-icon" title="Execute Above Cells" aria-label={`Run cells above ${n}`} onClick={() => enqueue(codeOf(0, index))}>
                        <RunAllIcon />
                      </button>
                    )}
                    {cell.kind === "code" && (
                      <button type="button" className="nb-icon" title="Create node from this cell" aria-label={`Create node from cell ${n}`} onClick={() => setCreating({ first: index, last: index })}>
                        <AddIcon />
                      </button>
                    )}
                    <button type="button" className="nb-icon" title="Delete Cell" aria-label={`Delete cell ${n}`} onClick={() => remove(index)}>
                      <TrashIcon />
                    </button>
                  </div>
                  {cell.kind === "markdown" && !editing.has(cell.id) ? (
                    <div className="nb-markdown" onDoubleClick={() => setEditing((now) => new Set(now).add(cell.id))}>
                      {cell.source.trim() === "" ? <p className="muted">Empty Markdown cell. Double-click to edit.</p> : <Markdown>{cell.source}</Markdown>}
                    </div>
                  ) : (
                    <div className="nb-editor">
                      <CodeInput
                        fit
                        label={`Cell ${n}`}
                        value={cell.source}
                        onChange={(v) => setSource(index, v)}
                        onRun={(v) => runCell(index, v, true)}
                        onRunStay={(v) => runCell(index, v, false)}
                        onEscape={() => select(index, { focus: true })}
                      />
                    </div>
                  )}
                  <div className="nb-status">
                    {cell.kind === "code" && <Status state={state} result={result} />}
                    <span className="spacer" />
                    <span>{cell.kind === "code" ? "Python" : "Markdown"}</span>
                  </div>
                  {cell.kind === "code" && result && <CellOutputs result={result} />}
                </div>
              </div>
              <AddCells onAdd={(kind) => insert(index + 1, kind)} />
            </div>
          );
        })}
      </div>
      {creating && <CreateNode notebookId={notebookId} cells={cells} range={creating} results={results} saveNotebook={saveNow} onClose={() => setCreating(undefined)} />}
    </div>
  );
}

function count(state: "running" | "queued" | undefined, result: NotebookExecution | undefined) {
  if (state === "running") return "[*]";
  if (state === "queued") return "[ ]";
  return result?.execution_count === undefined ? "" : `[${result.execution_count}]`;
}

function Status({ state, result }: { state: "running" | "queued" | undefined; result: NotebookExecution | undefined }) {
  if (state) return <span className="nb-live">{state === "running" ? "Running" : "Queued"}</span>;
  if (!result) return null;
  if (result.status === "ok") return <span className="nb-ok"><CheckIcon /> Done</span>;
  const text = { error: "Failed", interrupted: "Interrupted", timed_out: "Timed out" }[result.status];
  return <span className="nb-bad"><CrossIcon /> {text}</span>;
}

/** True when a cell lower down ran before one above it: state may come from a later cell. */
function ranOutOfOrder(cells: NotebookCell[], results: Record<string, NotebookExecution>) {
  const counts = cells.flatMap((c) => (results[c.id]?.execution_count === undefined ? [] : [results[c.id]?.execution_count ?? 0]));
  return counts.some((n, i) => i > 0 && n < (counts[i - 1] ?? 0));
}

/** Between two cells; hover to add a code or Markdown cell there, as in VS Code. */
function AddCells({ onAdd }: { onAdd: (kind: NotebookCell["kind"]) => void }) {
  return (
    <div className="nb-insert">
      <button type="button" tabIndex={-1} aria-label="Add a code cell here" onClick={() => onAdd("code")}>
        <AddIcon /> Code
      </button>
      <button type="button" tabIndex={-1} aria-label="Add a Markdown cell here" onClick={() => onAdd("markdown")}>
        <AddIcon /> Markdown
      </button>
    </div>
  );
}

function download(version: NotebookVersion, results: Record<string, NotebookExecution>) {
  const notebook = toIpynb(version, new Map(Object.entries(results)));
  const url = URL.createObjectURL(new Blob([JSON.stringify(notebook, null, 1)], { type: "application/x-ipynb+json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${version.title.replace(/[^\w.-]+/g, "_") || "notebook"}.ipynb`;
  link.click();
  URL.revokeObjectURL(url);
}

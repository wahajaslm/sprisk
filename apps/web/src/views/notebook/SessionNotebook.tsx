import type { NotebookCell, NotebookExecution, NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";

import { useSavePipelineVersion } from "../../api/hooks.ts";
import { executeCell, interruptKernel, restartKernel, splitNotebook, useSaveNotebook } from "../../api/notebooks.ts";
import { type CellPart, type Folded, useCollapsed } from "../../notebook/collapsed.ts";
import { newCellId, nextNotebookVersion, toIpynb } from "../../notebook/document.ts";
import { ranOutOfOrder } from "../../notebook/node.ts";
import { type Ran, useOutputs } from "../../notebook/outputs.ts";
import { cellsFromFlow, stepsIntoFlow } from "../../notebook/sync.ts";
import { useSelection } from "../../workbench/selection.ts";
import { CodeInput } from "../CodeInput.tsx";
import { AddIcon, CheckIcon, Chevron, CrossIcon, ExportIcon, PlayIcon, RunAllIcon, TrashIcon } from "../Icons.tsx";
import { CellOutputs, hasOutputs } from "./CellOutputs.tsx";

type Queued = { id: string; code: string };

const EMPTY: Record<string, Ran> = {};
const NOTHING_FOLDED: Record<string, Folded> = {};

/** A notebook on a live kernel, laid out as VS Code's notebook editor (ADR-0035, ADR-0036).
 * Cells share the kernel's state and run in the order the person chooses. Save and Run All
 * rebuild its steps in `flow`; code edited on the flow comes back into its cells (ADR-0037). */
export function SessionNotebook({ saved, flow }: { saved: NotebookVersion; flow: PipelineVersion | undefined }) {
  const notebookId = saved.notebook_id;
  const [cells, setCells] = useState(saved.cells);
  const [title, setTitle] = useState(saved.title);
  // Cell editors keep their own text while typing (CodeInput fit); adding, deleting or moving
  // cells remounts them so each shows its own cell's text.
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState<string | undefined>();
  const [queued, setQueued] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | undefined>();
  const [news, setNews] = useState<string | undefined>();
  // Cells as the flow's code has them, waiting for the person's choice over their unsaved edits.
  const [incoming, setIncoming] = useState<NotebookCell[] | undefined>();
  const savePipeline = useSavePipelineVersion();
  const selectPipelineVersion = useSelection((s) => s.selectPipelineVersion);  const results = useOutputs((s) => s.byNotebook[notebookId]) ?? EMPTY;
  const setResult = useOutputs((s) => s.set);
  const clearResults = useOutputs((s) => s.clear);
  const folds = useCollapsed((s) => s.byNotebook[notebookId]) ?? NOTHING_FOLDED;
  const toggleFold = useCollapsed((s) => s.toggle);
  const foldOutputs = useCollapsed((s) => s.setOutputsCollapsed);
  const save = useSaveNotebook();
  const pending = useRef<Queued[]>([]);
  const looping = useRef(false);
  const cellNodes = useRef(new Map<number, HTMLDivElement>());
  const pendingD = useRef(false);
  const focusAfterRender = useRef(false);

  const edited = title !== saved.title || JSON.stringify(cells) !== JSON.stringify(saved.cells);

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    cellNodes.current.get(active)?.focus();
  });

  // Built from the cells as they are now, not as this render saw them: the editor can call in
  // before its last keystrokes have re-rendered, and a stale list would drop them.
  const reshape = (change: (now: NotebookCell[]) => NotebookCell[], nextActive: number) => {
    setCells(change);
    setGeneration((g) => g + 1);
    setActive(nextActive);
    focusAfterRender.current = true;
  };
  const select = (index: number, { focus = false } = {}) => {
    if (index < 0 || index >= cells.length) return;
    pendingD.current = false;
    setActive(index);
    if (focus) cellNodes.current.get(index)?.focus();
  };
  const setSource = (index: number, source: string) => setCells((now) => now.map((c, i) => (i === index ? { ...c, source } : c)));
  const insert = (at: number, kind: NotebookCell["kind"]) => {
    const cell = { id: newCellId(), kind, source: "" };
    if (kind === "markdown") setEditing((now) => new Set(now).add(cell.id));
    reshape((now) => [...now.slice(0, at), cell, ...now.slice(at)], at);
  };
  const remove = (index: number) =>
    reshape((now) => now.filter((_, i) => i !== index), Math.max(0, Math.min(index, cells.length - 2)));
  const setKind = (index: number, kind: NotebookCell["kind"]) => reshape((now) => now.map((c, i) => (i === index ? { ...c, kind } : c)), index);

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
        setResult(notebookId, next.id, { code: next.code, result });
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
  const failed = (e: unknown) => setProblem(e instanceof Error ? e.message : String(e));
  // The flow this notebook belongs to: the one it names, or the one on screen.
  const inFlow = () => {
    const id = saved.pipeline_version_id ?? flow?.id;
    return id ? { pipeline_version_id: id } : {};
  };

  /** This notebook's steps rebuilt in its flow from `version`'s cells (ADR-0037). */
  const syncFlow = async (version: NotebookVersion) => {
    const split = await splitNotebook(version.cells.filter((c) => c.kind === "code").map((c) => c.source));
    const done = stepsIntoFlow({ base: flow, projectId: version.project_id, notebook: version, split });
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
    reshape(() => fromFlow, active);
    setNews("Cells updated from code edited on the flow.");
    save.mutate(nextNotebookVersion(saved, { cells: fromFlow, ...inFlow() }), { onError: failed });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void saveNow();
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
      select(active - 1, { focus: true });
    } else if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      select(active + 1, { focus: true });
    } else if (key === "a") insert(active, "code");
    else if (key === "b") insert(active + 1, "code");
    else if (key === "m") setKind(active, "markdown");
    else if (key === "y") setKind(active, "code");
    else if (key === "o" && cell.kind === "code") toggleFold(notebookId, cell.id, "output");
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
        <button type="button" className="nb-action" onClick={runAll}>
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
        <button type="button" className="nb-action" onClick={() => foldOutputs(notebookId, codeCellIds(cells), true)}>
          Collapse All Outputs
        </button>
        <button type="button" className="nb-action" onClick={() => foldOutputs(notebookId, codeCellIds(cells), false)}>
          Expand All Outputs
        </button>
        <span className="spacer" />
        <button type="button" className="nb-action" disabled={save.isPending || savePipeline.isPending} onClick={() => void saveNow()} title="Save, and rebuild this notebook's steps in the flow">
          {edited ? "Save" : "Saved"}
        </button>
        <button type="button" className="nb-action" onClick={() => download(current(), results)}>
          <ExportIcon /> Export
        </button>
        <span className="nb-kernel" title="One live Python kernel for this notebook. Its results are scratch; the flow runs the saved cells in its own workers.">
          <span className={`nb-kernel-dot${running ? " busy" : ""}`} /> Python 3 · {running ? "busy" : "idle"}
        </span>
      </div>
      <div className="nb-scroll" onKeyDown={onKeyDown}>
        <input className="nb-title" aria-label="Notebook title" value={title} onChange={(e) => setTitle(e.target.value)} />
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
        <AddCells onAdd={(kind) => insert(0, kind)} />
        {cells.map((cell, index) => {
          const n = index + 1;
          const ran = results[cell.id];
          const result = ran?.result;
          const stale = ran !== undefined && ran.code !== cell.source;
          const state = running === cell.id ? "running" : queued.includes(cell.id) ? "queued" : undefined;
          const folded = folds[cell.id] ?? {};
          const fold = (part: CellPart) => ({ part, n, collapsed: folded[part] === true, onToggle: () => toggleFold(notebookId, cell.id, part) });
          return (
            <div key={`${generation}/${cell.id}`}>
              <div
                className={`nb-cell${index === active ? " active" : ""}`}
                role="group"
                aria-label={`Cell ${n}`}
                tabIndex={-1}
                data-cell={n}
                ref={(el) => void (el ? cellNodes.current.set(index, el) : cellNodes.current.delete(index))}
                onMouseDown={() => select(index)}
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
                    <Fold look="chevron" {...fold("input")} />
                    {cell.kind === "code" && (
                      <button type="button" className="nb-icon" title="Execute Above Cells" aria-label={`Run cells above ${n}`} onClick={() => enqueue(codeOf(0, index))}>
                        <RunAllIcon />
                      </button>
                    )}
                    <button type="button" className="nb-icon" title="Delete Cell" aria-label={`Delete cell ${n}`} onClick={() => remove(index)}>
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="nb-part">
                    <Fold look="bar" {...fold("input")} />
                    {folded.input ? (
                      <p className="nb-folded">
                        <span className="nb-folded-text">{firstLine(cell.source)}</span>
                        <span aria-hidden="true">…</span>
                      </p>
                    ) : cell.kind === "markdown" && !editing.has(cell.id) ? (
                      <div className="nb-markdown" onDoubleClick={() => setEditing((now) => new Set(now).add(cell.id))}>
                        {cell.source.trim() === "" ? <p className="muted">Empty Markdown cell. Double-click to edit.</p> : <Markdown urlTransform={markdownUrl}>{cell.source}</Markdown>}
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
                  </div>
                  <div className="nb-status">
                    {cell.kind === "code" && <Status state={state} result={result} />}
                    {cell.kind === "code" && stale && !state && <span className="nb-live">Changed since it ran</span>}
                    <span className="spacer" />
                    <span>{cell.kind === "code" ? "Python" : "Markdown"}</span>
                  </div>
                  {cell.kind === "code" && result && hasOutputs(result) && (
                    <div className="nb-part">
                      <Fold look="bar" {...fold("output")} />
                      <Fold look="chevron" {...fold("output")} />
                      {folded.output ? (
                        <p className="nb-folded nb-output-folded">
                          <span>Outputs are collapsed</span>
                          <span aria-hidden="true">…</span>
                        </p>
                      ) : (
                        <CellOutputs result={result} />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <AddCells onAdd={(kind) => insert(index + 1, kind)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const codeCellIds = (cells: NotebookCell[]) => cells.flatMap((c) => (c.kind === "code" ? [c.id] : []));

const firstLine = (source: string) => source.split("\n").find((line) => line.trim() !== "") ?? "";

/** Folds one part of a cell, as VS Code does: the bar in the gutter for the mouse, the chevron
 * for the keyboard and screen readers too. The bar is a mouse target only, so each part is
 * announced and tabbed to once. */
function Fold({ look, part, n, collapsed, onToggle }: { look: "bar" | "chevron"; part: CellPart; n: number; collapsed: boolean; onToggle: () => void }) {
  const label = `${collapsed ? "Expand" : "Collapse"} ${part} of cell ${n}`;
  return (
    <button
      type="button"
      className={look === "bar" ? "nb-fold-bar" : `nb-icon nb-fold nb-fold-${part}`}
      tabIndex={look === "bar" ? -1 : undefined}
      aria-hidden={look === "bar" ? true : undefined}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {look === "chevron" && <Chevron />}
    </button>
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

/** A notebook may come from anyone: its images load only from the notebook itself (data:),
 * never from the network, where an image is a beacon that reports who opened it. */
function markdownUrl(url: string, key: string) {
  if (key === "src") return url.startsWith("data:image/") ? url : "";
  return defaultUrlTransform(url);
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

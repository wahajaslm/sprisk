import type { DisplayItem, NotebookCell, NotebookExecution } from "@sprisk/contracts";
import type { KeyboardEvent, ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";

import { type CellPart, type Folded, useCollapsed } from "../../notebook/collapsed.ts";
import type { Ran } from "../../notebook/outputs.ts";
import { CodeInput } from "../CodeInput.tsx";
import { AddIcon, CheckIcon, Chevron, CrossIcon, PlayIcon, RunAllIcon, TrashIcon } from "../Icons.tsx";
import { CellOutputs, hasOutputs, OutputItems } from "./CellOutputs.tsx";
import type { CellEditing } from "./useCellEditing.ts";

const NOTHING_FOLDED: Record<string, Folded> = {};

export type CellRuns = {
  results: Record<string, Ran>;
  running: string | undefined;
  queued: string[];
  /** What the running cell has shown so far (ADR-0041); its result replaces it when it ends. */
  live: { cellId: string; outputs: DisplayItem[] } | undefined;
};

type Props = {
  edit: CellEditing;
  runs: CellRuns;
  /** Where folds are kept: one notebook's cells. */
  foldKey: string;
  onRun: (index: number, code: string, advance: boolean) => void;
  onRunAbove: (index: number) => void;
  onRemove: (index: number) => void;
  /** A cell that is a ready-made step shows this in place of code (ADR-0055). */
  stepOf?: (cell: NotebookCell) => ReactNode | undefined;
  /** What a cell shows under it when its result is not a kernel's: a step's in a run. */
  outputOf?: (cell: NotebookCell) => ReactNode | undefined;
};

/** The cells of a notebook laid out as VS Code's notebook editor (ADR-0035). */
export function NotebookCells({ edit, runs, foldKey, onRun, onRunAbove, onRemove, stepOf, outputOf }: Props) {
  const folds = useCollapsed((s) => s.byNotebook[foldKey]) ?? NOTHING_FOLDED;
  const toggleFold = useCollapsed((s) => s.toggle);
  const { cells, active, editing, generation, cellNodes, select } = edit;
  return (
    <>
      <AddCells onAdd={(kind) => edit.insert(0, kind)} />
      {cells.map((cell, index) => {
        const n = index + 1;
        const ran = runs.results[cell.id];
        const result = ran?.result;
        const step = stepOf?.(cell);
        const stale = ran !== undefined && step === undefined && ran.code !== cell.source;
        const state = runs.running === cell.id ? "running" : runs.queued.includes(cell.id) ? "queued" : undefined;
        const folded = folds[cell.id] ?? {};
        const fold = (part: CellPart) => ({ part, n, collapsed: folded[part] === true, onToggle: () => toggleFold(foldKey, cell.id, part) });
        const live = state === "running" && runs.live?.cellId === cell.id ? runs.live : undefined;
        const stepOutput = outputOf?.(cell);
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
                  <button type="button" className="nb-run" aria-label={`Run cell ${n}`} title="Execute Cell (Shift+Enter)" onClick={() => onRun(index, cell.source, false)}>
                    {state === "running" ? <span className="nb-spinner" /> : <PlayIcon />}
                  </button>
                )}
                <span className="nb-count">{cell.kind === "code" ? count(state, result) : ""}</span>
              </div>
              <div className="nb-main">
                <div className="nb-cell-toolbar">
                  <Fold look="chevron" {...fold("input")} />
                  {cell.kind === "code" && (
                    <button type="button" className="nb-icon" title="Execute Above Cells" aria-label={`Run cells above ${n}`} onClick={() => onRunAbove(index)}>
                      <RunAllIcon />
                    </button>
                  )}
                  <button type="button" className="nb-icon" title="Delete Cell" aria-label={`Delete cell ${n}`} onClick={() => onRemove(index)}>
                    <TrashIcon />
                  </button>
                </div>
                <div className="nb-part">
                  <Fold look="bar" {...fold("input")} />
                  {folded.input ? (
                    <p className="nb-folded">
                      <span className="nb-folded-text">{step !== undefined ? "Ready-made step" : firstLine(cell.source)}</span>
                      <span aria-hidden="true">…</span>
                    </p>
                  ) : step !== undefined ? (
                    <div className="nb-step">{step}</div>
                  ) : cell.kind === "markdown" && !editing.has(cell.id) ? (
                    <div className="nb-markdown" onDoubleClick={() => edit.startEditing(cell.id)}>
                      {cell.source.trim() === "" ? <p className="muted">Empty Markdown cell. Double-click to edit.</p> : <Markdown urlTransform={markdownUrl}>{cell.source}</Markdown>}
                    </div>
                  ) : (
                    <div className="nb-editor">
                      <CodeInput
                        fit
                        label={`Cell ${n}`}
                        value={cell.source}
                        onChange={(v) => edit.setSource(index, v)}
                        onRun={(v) => onRun(index, v, true)}
                        onRunStay={(v) => onRun(index, v, false)}
                        onEscape={() => select(index, { focus: true })}
                      />
                    </div>
                  )}
                </div>
                <div className="nb-status">
                  {cell.kind === "code" && <Status state={state} result={result} />}
                  {cell.kind === "code" && stale && !state && <span className="nb-live">Changed since it ran</span>}
                  <span className="spacer" />
                  <span>{step !== undefined ? "Step" : cell.kind === "code" ? "Python" : "Markdown"}</span>
                </div>
                {cell.kind === "code" && (live || stepOutput || (result && hasOutputs(result))) && (
                  <div className="nb-part">
                    <Fold look="bar" {...fold("output")} />
                    <Fold look="chevron" {...fold("output")} />
                    {folded.output ? (
                      <p className="nb-folded nb-output-folded">
                        <span>Outputs are collapsed</span>
                        <span aria-hidden="true">…</span>
                      </p>
                    ) : live ? (
                      <div className="nb-output">
                        <OutputItems items={live.outputs} />
                      </div>
                    ) : stepOutput ? (
                      <div className="nb-output">{stepOutput}</div>
                    ) : (
                      result && <CellOutputs result={result} />
                    )}
                  </div>
                )}
              </div>
            </div>
            <AddCells onAdd={(kind) => edit.insert(index + 1, kind)} />
          </div>
        );
      })}
    </>
  );
}

/** Jupyter's command-mode keys on the cells, as VS Code's notebook has them. */
export function notebookKeys(
  edit: CellEditing,
  { onRun, onRemove, onSave, foldKey, toggleFold }: { onRun: Props["onRun"]; onRemove: Props["onRemove"]; onSave: () => void; foldKey: string; toggleFold: (key: string, cellId: string, part: CellPart) => void },
) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) edit.redo();
      else edit.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      edit.redo();
      return;
    }
    if (!(e.target instanceof HTMLElement) || e.target.dataset["cell"] === undefined) return;
    if (e.altKey || ((e.ctrlKey || e.metaKey) && e.key !== "Enter")) return;
    const { active, cells, cellNodes, pendingD, select } = edit;
    const cell = cells[active];
    if (!cell) return;
    const deleting = pendingD.current;
    pendingD.current = false;
    const key = e.key;
    if (key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (cell.kind === "markdown") edit.startEditing(cell.id);
      requestAnimationFrame(() => cellNodes.current.get(active)?.querySelector("textarea")?.focus());
    } else if (key === "Enter") {
      e.preventDefault();
      onRun(active, cell.source, e.shiftKey);
    } else if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      select(active - 1, { focus: true });
    } else if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      select(active + 1, { focus: true });
    } else if (key === "a") edit.insert(active, "code");
    else if (key === "b") edit.insert(active + 1, "code");
    else if (key === "m") edit.setKind(active, "markdown");
    else if (key === "y") edit.setKind(active, "code");
    else if (key === "z") {
      e.preventDefault();
      edit.undo();
    } else if (key === "Z") {
      e.preventDefault();
      edit.redo();
    } else if (key === "o" && cell.kind === "code") toggleFold(foldKey, cell.id, "output");
    else if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      onRemove(active);
    } else if (key === "d") {
      // D twice deletes, as in VS Code; one D alone does nothing.
      if (deleting) onRemove(active);
      else pendingD.current = true;
    }
  };
}

export const codeCellIds = (cells: NotebookCell[]) => cells.flatMap((c) => (c.kind === "code" ? [c.id] : []));

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
export function markdownUrl(url: string, key: string) {
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

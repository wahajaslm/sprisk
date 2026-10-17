import type { Attempt, DisplayItem, Operator, PipelineVersion } from "@sprisk/contracts";
import { type KeyboardEvent, type MutableRefObject, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useCodeDisplay, useConsole } from "../api/code.ts";
import { useOperators, useOperatorSources, useOutputs, usePipelineVersions, useRunAttempts, useStartRun, useTablePage } from "../api/hooks.ts";
import { PARQUET } from "../api/media.ts";
import { isCodeOperator } from "../flow/edit.ts";
import { hasOutputs, latestByNode, statusOf } from "../flow/latest.ts";
import { type CellAt, cellNumber, nodeOf, type NotebookStep, notebookSteps, toIpynb, withCell, withNewCell, withoutCell } from "../flow/notebook.ts";
import { roleOf } from "../flow/stages.ts";
import { useSelection } from "../workbench/selection.ts";
import { Loading } from "../components/ui/Loading.tsx";
import { Overrides, useRunSource } from "./CodeEditor.tsx";
import { CodeInput } from "./CodeInput.tsx";
import { AddIcon, CheckIcon, CodeIcon, CrossIcon, ExportIcon, PlayIcon, RunAllIcon, TrashIcon } from "./Icons.tsx";
import { FigurePort, FigureView } from "./inspector/FiguresTab.tsx";
import { OperatorCode } from "./inspector/OperatorCode.tsx";
import { ShownTable } from "./inspector/VisualsTab.tsx";
import { RowsTable } from "./RowsTable.tsx";
import { useSaveCells } from "./useSaveCells.ts";

/** Rows of a table a step made, shown under its cell, as a notebook shows `df.head()`. */
const PREVIEW_ROWS = 5;

/** Where the person was, kept across the rebuild a run's new version causes. */
type Place = { scrollTop: number; active: number };

/** The selected flow as a notebook laid out as VS Code's notebook editor (ADR-0035). It is the
 * same saved version the canvas shows: running a cell saves the next version and runs it in
 * sprisk's workers, and the canvas follows (ADR-0033). */
export function NotebookView() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const place = useRef<Place>({ scrollTop: 0, active: 0 });
  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <Loading text="Loading notebook…" pad />;
  const pipeline = versions.data.find((v) => v.id === pipelineVersionId);
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;
  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  // A new version is a new notebook: edits not yet run belonged to the old one.
  return <Notebook key={pipeline.id} pipeline={pipeline} operators={byRef} latest={latestByNode(attempts.data ?? [])} selected={nodeId} place={place} />;
}

type NotebookProps = {
  pipeline: PipelineVersion;
  operators: Map<string, Operator>;
  latest: Map<string, Attempt>;
  selected: string | undefined;
  place: MutableRefObject<Place>;
};

/** One row of the notebook: a cell, where it is, and its number counted down the notebook. */
type Row = { at: CellAt; n: number; step: NotebookStep };

function Notebook({ pipeline, operators, latest, selected, place }: NotebookProps) {
  const [draft, setDraft] = useState<NotebookStep[] | undefined>(undefined);
  // Cell editors keep their own text (CodeInput fit). Adding, deleting or discarding cells
  // moves text between positions, so those remount every editor; typing does not.
  const [generation, setGeneration] = useState(0);
  const saved = notebookSteps(pipeline, operators);
  const steps = draft ?? saved;
  // Adding a cell and deleting it again leaves nothing to save.
  const edited = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const rows: Row[] = steps.flatMap((step, i) =>
    (step.kind === "cells" ? step.cells : [""]).map((_, j) => ({ at: { step: i, cell: j }, step, n: cellNumber(steps, { step: i, cell: j }) + 1 })),
  );
  const [active, setActive] = useState(() => Math.max(0, Math.min(place.current.active, rows.length - 1)));
  const scroller = useRef<HTMLDivElement>(null);
  const cellNodes = useRef(new Map<number, HTMLDivElement>());
  const pendingD = useRef(false);
  const cells = useSaveCells(pipeline, operators);
  const startRun = useStartRun();
  const showRun = useSelection((s) => s.showRun);
  const selectNode = useSelection((s) => s.selectNode);

  const reshape = (next: NotebookStep[] | undefined, nextActive = active) => {
    setDraft(next);
    setGeneration((g) => g + 1);
    setActive(nextActive);
  };
  const select = (index: number, focus = false) => {
    const row = rows[index];
    if (!row) return;
    setActive(index);
    if (row.step.nodeId !== undefined) selectNode(row.step.nodeId);
    if (focus) cellNodes.current.get(index)?.focus();
  };
  const run = (next: NotebookStep[], at: CellAt) => {
    if (cells.pending) return;
    // Shift+Enter moves on to the next cell, as in VS Code; the notebook is rebuilt for the new
    // version, so remember where to come back.
    place.current = { scrollTop: scroller.current?.scrollTop ?? 0, active: cellNumber(next, at) + 1 };
    void cells.save(next, cellNumber(next, at));
  };
  const runAll = () => {
    if (edited) return run(steps, { step: 0, cell: 0 });
    startRun.mutate(pipeline.id, { onSuccess: (r) => showRun(pipeline.id, r.id) });
  };

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = place.current.scrollTop;
  }, [place]);

  // A step picked elsewhere (the canvas) selects its first cell.
  useEffect(() => {
    if (selected === undefined || rows[active]?.step.nodeId === selected) return;
    const index = rows.findIndex((r) => r.step.nodeId === selected);
    if (index >= 0) setActive(index);
    // Only a new selection moves the active cell; the rows follow from it.
  }, [selected]);

  // VS Code's keys for a selected cell whose editor is not focused.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLElement) || e.target.dataset["cell"] === undefined) return;
    const row = rows[active];
    if (!row) return;
    const key = e.key;
    const deleting = pendingD.current;
    pendingD.current = false;
    if (key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.target.querySelector("textarea")?.focus();
    } else if (key === "Enter") {
      e.preventDefault();
      if (row.step.kind === "cells") run(steps, row.at);
    } else if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      select(Math.max(0, active - 1), true);
    } else if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      select(Math.min(rows.length - 1, active + 1), true);
    } else if (key === "a") {
      reshape(withNewCell(steps, row.at.step - 1), active - row.at.cell);
    } else if (key === "b") {
      reshape(withNewCell(steps, row.at.step), rows.findLastIndex((r) => r.at.step === row.at.step) + 1);
    } else if (key === "d" && row.step.kind === "cells") {
      // D twice deletes, as in VS Code; one D alone does nothing.
      if (deleting) reshape(withoutCell(steps, row.at), Math.max(0, active - 1));
      else pendingD.current = true;
    }
  };

  return (
    <div className="notebook" aria-label="Notebook">
      <div className="nb-toolbar" role="toolbar" aria-label="Notebook actions">
        <button type="button" className="nb-action" onClick={() => reshape(withNewCell(steps, steps.length - 1), rows.length)}>
          <AddIcon /> Code
        </button>
        <span className="nb-divider" />
        <button type="button" className="nb-action" disabled={cells.pending || startRun.isPending} onClick={runAll}>
          <RunAllIcon /> Run All
        </button>
        <Download pipeline={pipeline} operators={operators} />
        <span className="spacer" />
        {edited && (
          <button type="button" className="nb-action" onClick={() => reshape(undefined)}>
            Discard edits
          </button>
        )}
        <span className="nb-kernel" title="Each cell runs as a step of the flow, in sprisk's workers.">
          <span className="nb-kernel-dot" /> Python · sprisk
        </span>
      </div>
      <div className="nb-scroll" ref={scroller} onKeyDown={onKeyDown}>
        {(cells.problem ?? startRun.error?.message) && <p role="alert" className="error nb-message">{cells.problem ?? startRun.error?.message}</p>}
        {cells.notes.map((note, i) => (
          <p key={i} className="nb-message nb-note">
            {note}
          </p>
        ))}
        <AddCell label="Add a cell at the top" onAdd={() => reshape(withNewCell(steps, -1), 0)} />
        {steps.map((step, i) => {
          const attempt = step.nodeId === undefined ? undefined : latest.get(step.nodeId);
          const mine = rows.filter((r) => r.at.step === i);
          const after = rows.indexOf(mine.at(-1) ?? mine[0]!) + 1;
          return (
            <div key={`${generation}/${step.nodeId ?? `new-${i}`}`} className="nb-step" aria-label={step.nodeId ?? "new step"} role="group">
              {mine.map((row, j) => {
                const index = rows.indexOf(row);
                const shared = {
                  row,
                  attempt,
                  active: index === active,
                  pending: cells.pending,
                  cellRef: (el: HTMLDivElement | null) => void (el ? cellNodes.current.set(index, el) : cellNodes.current.delete(index)),
                  onSelect: () => select(index),
                  onEscape: () => select(index, true),
                  outputs: j === mine.length - 1 ? <Outputs step={step} attempt={attempt} pipeline={pipeline} operators={operators} /> : null,
                };
                if (step.kind !== "cells") return <OtherCell key={j} {...shared} pipeline={pipeline} operators={operators} />;
                return (
                  <Cell
                    key={j}
                    {...shared}
                    label={`${step.nodeId ?? "new"} · ${mine.length > 1 ? `cell ${j + 1} of ${mine.length} · Python` : "Python"}`}
                    onRun={() => run(steps, row.at)}
                    tools={
                      <button type="button" className="nb-icon" aria-label={`Delete cell ${row.n}`} title="Delete Cell" onClick={() => reshape(withoutCell(steps, row.at), Math.max(0, index - 1))}>
                        <TrashIcon />
                      </button>
                    }
                  >
                    <CodeInput
                      fit
                      label={`Cell ${row.n}`}
                      value={step.cells[row.at.cell] ?? ""}
                      onChange={(v) => setDraft(withCell(steps, row.at, v))}
                      onRun={(v) => run(withCell(steps, row.at, v), row.at)}
                      onEscape={() => select(index, true)}
                    />
                  </Cell>
                );
              })}
              <AddCell label={`Add a cell after ${step.nodeId ?? "the new cell"}`} onAdd={() => reshape(withNewCell(steps, i), after)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CellShared = {
  row: Row;
  attempt: Attempt | undefined;
  active: boolean;
  pending: boolean;
  cellRef: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onEscape: () => void;
  outputs: ReactNode;
};

type CellProps = CellShared & { label: string; onRun?: () => void; tools?: ReactNode; below?: ReactNode; children: ReactNode };

/** A cell as VS Code draws it: run button and [n] in the gutter, the editor, a status line
 * under it, its tools on the top edge, its outputs below. A built-in step has no run button:
 * it runs with the flow (Run All). */
function Cell({ row, attempt, active, pending, cellRef, onSelect, label, onRun, tools, below, outputs, children }: CellProps) {
  const done = hasOutputs(attempt);
  const tone = attempt ? statusOf(attempt.state).tone : undefined;
  return (
    <div className={`nb-cell${active ? " active" : ""}`} ref={cellRef} tabIndex={-1} data-cell={row.n} onMouseDown={onSelect} onFocus={onSelect}>
      <div className="nb-gutter">
        {onRun && (
          <button type="button" className="nb-run" aria-label={`Run cell ${row.n}`} title="Execute Cell (Shift+Enter)" disabled={pending} onClick={onRun}>
            {tone === "live" ? <span className="nb-spinner" /> : <PlayIcon />}
          </button>
        )}
        <span className="nb-count">{done ? `[${row.n}]` : tone === "live" ? "[*]" : ""}</span>
      </div>
      <div className="nb-main">
        <div className="nb-cell-toolbar">{tools}</div>
        <div className="nb-editor">{children}</div>
        <div className="nb-status">
          <Status attempt={attempt} />
          <span className="spacer" />
          <span>{label}</span>
        </div>
        {below}
        {outputs}
      </div>
    </div>
  );
}

/** VS Code's run status under a cell: a check, a cross or a spinner, and the state. */
function Status({ attempt }: { attempt: Attempt | undefined }) {
  if (!attempt) return null;
  const { text, tone } = statusOf(attempt.state);
  if (tone === "done") return <span className="nb-ok"><CheckIcon /> {text}</span>;
  if (tone === "bad") return <span className="nb-bad"><CrossIcon /> {text}</span>;
  return <span className="nb-live">{text}</span>;
}

const ignore = () => undefined;

/** A built-in step: its call, read-only, with its code behind the toolbar's code button
 * (editable there, ADR-0028). A v1 code step: its code, with the table it gets as `data`. */
function OtherCell({ pipeline, operators, ...shared }: CellShared & { pipeline: PipelineVersion; operators: Map<string, Operator> }) {
  const { step } = shared.row;
  const [showCode, setShowCode] = useState(false);
  const { saveAndRun, runSource } = useRunSource(pipeline, step.nodeId ?? "");
  const [source, setSource] = useState(step.kind === "code" ? step.source : "");
  if (step.kind === "cells") return null;
  const node = nodeOf(pipeline, step.nodeId);
  const operator = operators.get(node.operator);
  if (step.kind === "code") {
    const run = (code: string) => {
      if (code !== "" && !saveAndRun.isPending) runSource(code);
    };
    return (
      <Cell {...shared} label={`${node.id} · data = ${step.data ?? "None"} · Python`} pending={saveAndRun.isPending} onRun={() => run(source)}>
        <Overrides pipeline={pipeline} nodeId={node.id} />
        {saveAndRun.isError && <p role="alert" className="error nb-message">{saveAndRun.error.message}</p>}
        <CodeInput fit label={`Cell ${shared.row.n}`} value={source} onChange={setSource} onRun={run} onEscape={shared.onEscape} />
      </Cell>
    );
  }
  const label = [node.id, operator ? roleOf(operator) : "missing", node.code ? "edited" : "built-in"].join(" · ");
  const toggle = (
    <button type="button" className={`nb-icon${showCode ? " on" : ""}`} aria-pressed={showCode} aria-label={`Code of ${node.id}`} title="Show its code" onClick={() => setShowCode(!showCode)}>
      <CodeIcon />
    </button>
  );
  return (
    <Cell
      {...shared}
      label={label}
      tools={toggle}
      below={
        showCode &&
        operator && (
          <div className="nb-function">
            <OperatorCode pipeline={pipeline} nodeId={node.id} operator={operator} />
          </div>
        )
      }
    >
      <CodeInput fit readOnly label={`Cell ${shared.row.n}`} value={step.call} onChange={ignore} onRun={ignore} onEscape={shared.onEscape} />
    </Cell>
  );
}

/** What the step printed, showed and drew, under its last cell. */
function Outputs({ step, attempt, pipeline, operators }: { step: NotebookStep; attempt: Attempt | undefined; pipeline: PipelineVersion; operators: Map<string, Operator> }) {
  if (!attempt || step.nodeId === undefined) return null;
  if (attempt.error) {
    return (
      <div className="nb-output">
        <pre className="code nb-error">{`${attempt.error.code}: ${attempt.error.message}`}</pre>
      </div>
    );
  }
  if (!hasOutputs(attempt)) return null;
  if (step.kind !== "builtin") return <CodeOutputs attempt={attempt} />;
  return <BuiltinOutputs attempt={attempt} nodeId={step.nodeId} operator={operators.get(nodeOf(pipeline, step.nodeId).operator)} />;
}

function CodeOutputs({ attempt }: { attempt: Attempt }) {
  const display = useCodeDisplay(attempt);
  if (display.status === "error") {
    return (
      <div className="nb-output">
        <p role="alert" className="error">{display.message}</p>
      </div>
    );
  }
  if (display.status !== "ready" || display.value.items.length === 0) return null;
  let figure = 0;
  return (
    <div className="nb-output">
      {display.value.items.map((item, i) => {
        if (item.kind === "figure" && item.figure) return <FigureView key={i} figure={item.figure} index={figure++} />;
        if (item.kind === "image" && item.png_base64) return <img key={i} className="figure" alt={`Figure ${++figure}`} src={`data:image/png;base64,${item.png_base64}`} />;
        if (item.kind === "table") return <ShownTable key={i} item={item} index={i} />;
        if (item.kind === "text") return <Printed key={i} item={item} />;
        return <p key={i} role="alert" className="error">Output item {i + 1} ({item.kind}) has no content.</p>;
      })}
    </div>
  );
}

function Printed({ item }: { item: DisplayItem }) {
  return <pre className={`code nb-text${item.channel === "stderr" ? " stderr" : ""}`}>{item.text ?? ""}</pre>;
}

/** A built-in step's prints, figures, and the first rows of each table it made. */
function BuiltinOutputs({ attempt, nodeId, operator }: { attempt: Attempt; nodeId: string; operator: Operator | undefined }) {
  const printed = useConsole(attempt);
  const outputs = useOutputs(attempt.id);
  if (printed.status === "error") {
    return (
      <div className="nb-output">
        <p role="alert" className="error">{printed.message}</p>
      </div>
    );
  }
  if (outputs.isError) {
    return (
      <div className="nb-output">
        <p role="alert" className="error">{outputs.error.message}</p>
      </div>
    );
  }
  const tables = (outputs.data ?? []).filter((o) => o.artifact.media_type === PARQUET);
  const figurePorts = (operator?.outputs ?? []).filter((o) => o.kind === "figure").map((o) => o.name);
  const texts = printed.status === "ready" ? printed.value.items.filter((i) => i.kind === "text") : [];
  if (tables.length === 0 && figurePorts.length === 0 && texts.length === 0) return null;
  return (
    <div className="nb-output">
      {texts.map((item, i) => (
        <Printed key={i} item={item} />
      ))}
      {tables.map((o) => (
        <TablePreview key={o.port} name={`${nodeId}_${o.port}`} artifactId={o.artifact.id} />
      ))}
      {figurePorts.map((port) => (
        <FigurePort key={port} attempt={attempt} port={port} />
      ))}
    </div>
  );
}

/** The first rows of a table, as `df.head()` shows them, with its size. Never the whole table
 * (rule 9). */
function TablePreview({ name, artifactId }: { name: string; artifactId: string }) {
  const page = useTablePage(artifactId, 0, PREVIEW_ROWS);
  if (page.isError) return <p role="alert" className="error">{page.error.message}</p>;
  if (!page.data) return null;
  return (
    <figure className="nb-table">
      <figcaption>
        <span className="mono">{name}</span> · {page.data.total_rows} rows × {page.data.total_columns} columns
      </figcaption>
      <RowsTable page={page.data} label={name} />
    </figure>
  );
}

/** Between two cells; hover to add a code cell there, as in VS Code. */
function AddCell({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="nb-insert">
      <button type="button" aria-label={label} onClick={onAdd}>
        <AddIcon /> Code
      </button>
    </div>
  );
}

/** The flow as a .ipynb file. Built-in steps need their operators' code, loaded first. */
function Download({ pipeline, operators }: { pipeline: PipelineVersion; operators: Map<string, Operator> }) {
  const refs = [...new Set(pipeline.nodes.filter((n) => !n.code && !isCodeOperator(n.operator)).map((n) => n.operator))];
  const sources = useOperatorSources(refs);
  const [problem, setProblem] = useState<string | undefined>();
  const failed = sources.find((s) => s.isError)?.error;
  const download = () => {
    setProblem(undefined);
    try {
      const loaded = new Map(refs.flatMap((ref, i) => (sources[i]?.data ? [[ref, sources[i].data.text] as const] : [])));
      const url = URL.createObjectURL(new Blob([JSON.stringify(toIpynb(pipeline, operators, loaded), null, 1)], { type: "application/x-ipynb+json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${pipeline.id}.ipynb`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <button type="button" className="nb-action" disabled={sources.some((s) => s.isPending)} onClick={download}>
        <ExportIcon /> Export
      </button>
      {(failed ?? problem) && <span role="alert" className="error">{failed?.message ?? problem}</span>}
    </>
  );
}

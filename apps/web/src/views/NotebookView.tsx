import type { Attempt, DisplayItem, Operator, PipelineVersion } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import { useCodeDisplay, useConsole } from "../api/code.ts";
import { useOperators, useOperatorSources, useOutputs, usePipelineVersions, useRunAttempts, useTablePage } from "../api/hooks.ts";
import { PARQUET } from "../api/media.ts";
import { isCodeOperator } from "../flow/edit.ts";
import { hasOutputs, latestByNode, statusOf } from "../flow/latest.ts";
import {
  type CellAt,
  cellNumber,
  nodeOf,
  type NotebookStep,
  notebookSteps,
  toIpynb,
  withCell,
  withNewCell,
  withoutCell,
} from "../flow/notebook.ts";
import { roleOf } from "../flow/stages.ts";
import { useSelection } from "../workbench/selection.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { Loading } from "../components/ui/Loading.tsx";
import { Overrides, useRunSource } from "./CodeEditor.tsx";
import { CodeInput } from "./CodeInput.tsx";
import { CodeIcon, PlayIcon, TrashIcon } from "./Icons.tsx";
import { FigurePort, FigureView } from "./inspector/FiguresTab.tsx";
import { OperatorCode } from "./inspector/OperatorCode.tsx";
import { ShownTable } from "./inspector/VisualsTab.tsx";
import { useSaveCells } from "./useSaveCells.ts";

/** The selected flow as a notebook (ADR-0033): cells with their outputs, as in Jupyter. It is
 * the same saved version the canvas shows: every edit here saves the next version, and the
 * canvas follows. */
export function NotebookView() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <Loading text="Loading notebook…" pad />;
  const pipeline = versions.data.find((v) => v.id === pipelineVersionId);
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;
  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  // A new version is a new notebook: edits not yet run belonged to the old one.
  return <Notebook key={pipeline.id} pipeline={pipeline} operators={byRef} latest={latestByNode(attempts.data ?? [])} selected={nodeId} />;
}

type NotebookProps = { pipeline: PipelineVersion; operators: Map<string, Operator>; latest: Map<string, Attempt>; selected: string | undefined };

function Notebook({ pipeline, operators, latest, selected }: NotebookProps) {
  const [draft, setDraft] = useState<NotebookStep[] | undefined>(undefined);
  // Cell editors keep their own text (CodeInput fit). Adding, deleting or discarding cells
  // moves text between positions, so those remount every editor; typing does not.
  const [generation, setGeneration] = useState(0);
  const reshape = (next: NotebookStep[] | undefined) => {
    setDraft(next);
    setGeneration((g) => g + 1);
  };
  const steps = draft ?? notebookSteps(pipeline, operators);
  const cells = useSaveCells(pipeline, operators);
  const run = (next: NotebookStep[], at?: CellAt) => {
    if (!cells.pending) void cells.save(next, at && cellNumber(next, at));
  };
  return (
    <div className="notebook" aria-label="Notebook">
      <div className="nb-toolbar">
        <button type="button" className="nb-tool" onClick={() => reshape(withNewCell(steps, steps.length - 1))}>
          + Code
        </button>
        <span className="muted">Each cell is a step of the flow · Shift+Enter runs it</span>
        <span className="spacer" />
        {draft && (
          <>
            <span className="muted">Edits not run yet</span>
            <button type="button" className="page-btn" onClick={() => reshape(undefined)}>
              Discard edits
            </button>
            <button type="button" className="run-code" disabled={cells.pending} onClick={() => run(draft)}>
              <PlayIcon />
              {cells.pending ? "Starting…" : "Run changes"}
            </button>
          </>
        )}
        <Download pipeline={pipeline} operators={operators} />
      </div>
      {cells.problem && <p role="alert" className="error nb-message">{cells.problem}</p>}
      {cells.notes.map((note, i) => (
        <p key={i} className="import-note nb-message">
          {note}
        </p>
      ))}
      <AddCell label="Add a cell at the top" onAdd={() => reshape(withNewCell(steps, -1))} />
      {steps.map((step, i) => {
        const attempt = step.nodeId === undefined ? undefined : latest.get(step.nodeId);
        const shared = { step, index: i, steps, pipeline, operators, attempt };
        return (
          <div key={`${generation}/${step.nodeId ?? `new-${i}`}`}>
            <StepBlock {...shared} selected={step.nodeId !== undefined && step.nodeId === selected}>
              {step.kind === "cells" ? (
                step.cells.map((cell, j) => {
                  const at = { step: i, cell: j };
                  const n = cellNumber(steps, at) + 1;
                  return (
                    <Cell
                      key={j}
                      n={n}
                      attempt={attempt}
                      tag={j === 0 ? cellsTag(step) : undefined}
                      pending={cells.pending}
                      onRun={() => run(steps, at)}
                      tools={
                        <button type="button" className="nb-icon" aria-label={`Delete cell ${n}`} title="Delete cell" onClick={() => reshape(withoutCell(steps, at))}>
                          <TrashIcon />
                        </button>
                      }
                    >
                      <CodeInput fit label={`Cell ${n}`} value={cell} onChange={(v) => setDraft(withCell(steps, at, v))} onRun={(v) => run(withCell(steps, at, v), at)} />
                    </Cell>
                  );
                })
              ) : (
                <OtherCell {...shared} n={cellNumber(steps, { step: i, cell: 0 }) + 1} />
              )}
            </StepBlock>
            <AddCell label={`Add a cell after ${step.nodeId ?? "the new cell"}`} onAdd={() => reshape(withNewCell(steps, i))} />
          </div>
        );
      })}
    </div>
  );
}

const cellsTag = (step: Extract<NotebookStep, { kind: "cells" }>) =>
  [step.nodeId ?? "new step", "Python", ...(step.cells.length > 1 ? [`${step.cells.length} cells, one step`] : [])].join(" · ");

type StepProps = {
  step: NotebookStep;
  index: number;
  steps: NotebookStep[];
  pipeline: PipelineVersion;
  operators: Map<string, Operator>;
  attempt: Attempt | undefined;
};

/** One step: its cells, then what it printed, showed and drew. Clicking it selects the step,
 * so the Inspector shows it too. Cells that run as one step share a bracket. */
function StepBlock({ step, attempt, operators, pipeline, selected, children }: StepProps & { selected: boolean; children: ReactNode }) {
  const selectNode = useSelection((s) => s.selectNode);
  const grouped = step.kind === "cells" && step.cells.length > 1;
  return (
    <section
      className={`nb-step${selected ? " selected" : ""}${grouped ? " grouped" : ""}`}
      aria-label={step.nodeId ?? "new step"}
      // Focus too: a cell reached by keyboard selects its step, as a click does.
      onClick={() => step.nodeId !== undefined && selectNode(step.nodeId)}
      onFocus={() => step.nodeId !== undefined && selectNode(step.nodeId)}
    >
      {children}
      <Outputs step={step} attempt={attempt} pipeline={pipeline} operators={operators} />
    </section>
  );
}

/** Jupyter's In [n]: blank before the step runs, * while it runs, ! when it failed. */
function countLabel(attempt: Attempt | undefined, n: number): string {
  if (!attempt) return " ";
  const tone = statusOf(attempt.state).tone;
  if (tone === "live" || tone === "idle") return "*";
  return tone === "bad" ? "!" : String(n);
}

type CellProps = { n: number; attempt: Attempt | undefined; tag: string | undefined; pending: boolean; onRun?: () => void; tools?: ReactNode; children: ReactNode };

/** A cell: run button and [n] in the gutter, the code, and its tools on hover. A built-in
 * step has no run button: it runs with the flow (Run graph). */
function Cell({ n, attempt, tag, pending, onRun, tools, children }: CellProps) {
  const label = countLabel(attempt, n);
  return (
    <div className="nb-cell">
      <div className={`nb-gutter${label === "!" ? " bad" : ""}`}>
        {onRun && (
          <button type="button" className="nb-run" aria-label={`Run cell ${n}`} title="Run cell (Shift+Enter)" disabled={pending} onClick={onRun}>
            <PlayIcon />
          </button>
        )}
        <span className="nb-count">[{label}]</span>
      </div>
      <div className="nb-body">
        <div className="nb-tools">
          {tag && <span className="nb-tag">{tag}</span>}
          {tools}
        </div>
        {children}
      </div>
    </div>
  );
}

const ignore = () => undefined;

/** A built-in step: its call, read-only, with its code behind a toggle (editable there,
 * ADR-0028). A v1 code step: its code, with the table it gets as `data`. */
function OtherCell({ step, pipeline, operators, attempt, n }: StepProps & { n: number }) {
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
      <Cell n={n} attempt={attempt} tag={`${node.id} · Python · data = ${step.data ?? "None"}`} pending={saveAndRun.isPending} onRun={() => run(source)}>
        <Overrides pipeline={pipeline} nodeId={node.id} />
        {saveAndRun.isError && <p role="alert" className="error nb-message">{saveAndRun.error.message}</p>}
        <CodeInput fit label={`Cell ${n}`} value={source} onChange={setSource} onRun={run} />
      </Cell>
    );
  }
  const tag = [node.id, operator ? roleOf(operator) : "missing", node.code ? "edited" : "built-in"].join(" · ");
  const toggle = (
    <button type="button" className={`nb-icon${showCode ? " on" : ""}`} aria-pressed={showCode} aria-label={`Code of ${node.id}`} title="Show its code" onClick={() => setShowCode(!showCode)}>
      <CodeIcon />
    </button>
  );
  return (
    <Cell n={n} attempt={attempt} tag={tag} pending={false} tools={toggle}>
      <CodeInput fit readOnly label={`Cell ${n}`} value={step.call} onChange={ignore} onRun={ignore} />
      {showCode && operator && (
        <div className="nb-function">
          <OperatorCode pipeline={pipeline} nodeId={node.id} operator={operator} />
        </div>
      )}
    </Cell>
  );
}

/** What the step printed, showed and drew, under its cells as in a notebook. */
function Outputs({ step, attempt, pipeline, operators }: Omit<StepProps, "index" | "steps">) {
  if (!attempt || step.nodeId === undefined) return null;
  if (attempt.error) {
    return (
      <Out>
        <pre className="code nb-error">{`${attempt.error.code}: ${attempt.error.message}`}</pre>
      </Out>
    );
  }
  if (!hasOutputs(attempt)) return null;
  if (step.kind !== "builtin") return <CodeOutputs attempt={attempt} />;
  const operator = operators.get(nodeOf(pipeline, step.nodeId).operator);
  return <BuiltinOutputs attempt={attempt} nodeId={step.nodeId} operator={operator} />;
}

const Out = ({ children }: { children: ReactNode }) => (
  <div className="nb-out-row">
    <span />
    <div className="nb-output">{children}</div>
  </div>
);

function CodeOutputs({ attempt }: { attempt: Attempt }) {
  const display = useCodeDisplay(attempt);
  if (display.status === "error") {
    return (
      <Out>
        <p role="alert" className="error">{display.message}</p>
      </Out>
    );
  }
  if (display.status !== "ready" || display.value.items.length === 0) return null;
  let figure = 0;
  return (
    <Out>
      {display.value.items.map((item, i) => {
        if (item.kind === "figure" && item.figure) return <FigureView key={i} figure={item.figure} index={figure++} />;
        if (item.kind === "image" && item.png_base64) return <img key={i} className="figure" alt={`Figure ${++figure}`} src={`data:image/png;base64,${item.png_base64}`} />;
        if (item.kind === "table") return <ShownTable key={i} item={item} index={i} />;
        if (item.kind === "text") return <Printed key={i} item={item} />;
        return <p key={i} role="alert" className="error">Output item {i + 1} ({item.kind}) has no content.</p>;
      })}
    </Out>
  );
}

function Printed({ item }: { item: DisplayItem }) {
  return <pre className={`code nb-text${item.channel === "stderr" ? " stderr" : ""}`}>{item.text ?? ""}</pre>;
}

/** A built-in step's prints, figures, and the size of each table it made. */
function BuiltinOutputs({ attempt, nodeId, operator }: { attempt: Attempt; nodeId: string; operator: Operator | undefined }) {
  const printed = useConsole(attempt);
  const outputs = useOutputs(attempt.id);
  const tables = (outputs.data ?? []).filter((o) => o.artifact.media_type === PARQUET);
  const figurePorts = (operator?.outputs ?? []).filter((o) => o.kind === "figure").map((o) => o.name);
  if (printed.status === "error") return <Out><p role="alert" className="error">{printed.message}</p></Out>;
  if (outputs.isError) return <Out><p role="alert" className="error">{outputs.error.message}</p></Out>;
  const texts = printed.status === "ready" ? printed.value.items.filter((i) => i.kind === "text") : [];
  if (tables.length === 0 && figurePorts.length === 0 && texts.length === 0) return null;
  return (
    <Out>
      {texts.map((item, i) => (
        <Printed key={i} item={item} />
      ))}
      {tables.map((o) => (
        <TableSize key={o.port} nodeId={nodeId} port={o.port} artifactId={o.artifact.id} />
      ))}
      {figurePorts.map((port) => (
        <FigurePort key={port} attempt={attempt} port={port} />
      ))}
    </Out>
  );
}

/** "load_data · 344 rows × 17 columns", from one row of the table. Opens it in Data. */
function TableSize({ nodeId, port, artifactId }: { nodeId: string; port: string; artifactId: string }) {
  const page = useTablePage(artifactId, 0, 1);
  const selectNode = useSelection((s) => s.selectNode);
  const dock = useWorkbench((s) => s.dock);
  const size = page.data ? `${page.data.total_rows} rows × ${page.data.total_columns} columns` : page.isError ? page.error.message : "…";
  return (
    <button
      type="button"
      className="nb-table"
      onClick={(e) => {
        e.stopPropagation();
        selectNode(nodeId);
        dock?.showTab("data");
      }}
    >
      <span className="mono">{`${nodeId}_${port}`}</span> · {size}
    </button>
  );
}

/** A thin line between cells; hover it to add a code cell there. */
function AddCell({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="nb-insert">
      <button type="button" aria-label={label} onClick={onAdd}>
        + Code
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
      const notebook = toIpynb(pipeline, operators, loaded);
      const url = URL.createObjectURL(new Blob([JSON.stringify(notebook, null, 1)], { type: "application/x-ipynb+json" }));
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
      {(failed ?? problem) && <span role="alert" className="error">{failed?.message ?? problem}</span>}
      <button type="button" className="page-btn" disabled={sources.some((s) => s.isPending)} onClick={download}>
        Download .ipynb
      </button>
    </>
  );
}

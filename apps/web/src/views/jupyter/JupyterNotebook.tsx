import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import type * as nbformat from "@jupyterlab/nbformat";
import type { ICodeCellModel } from "@jupyterlab/cells";
import type { Notebook } from "@jupyterlab/notebook";
import { Widget } from "@lumino/widgets";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";

import { useCodeDisplay, useConsole } from "../../api/code.ts";
import { useFigureSet } from "../../api/figures.ts";
import { useOperators, useOperatorSources, useOutputs, usePipelineVersions, useRunAttempts, useTablePage } from "../../api/hooks.ts";
import { PARQUET } from "../../api/media.ts";
import { isCodeOperator } from "../../flow/edit.ts";
import { hasOutputs, latestByNode, statusOf } from "../../flow/latest.ts";
import { type NotebookStep, notebookSteps, toIpynb } from "../../flow/notebook.ts";
import { useSelection } from "../../workbench/selection.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { notEditable } from "../inspector/OperatorCode.tsx";
import { useSaveCells } from "../useSaveCells.ts";
import { type CellTag, fromCells, type FunctionCode, type ReadCell, toCells, withCellCode } from "./cells.ts";
import { displayOutputs, errorOutput, tableSizeOutput } from "./outputs.ts";
import { NotebookToolbar } from "./Toolbar.tsx";
import { createNotebook, type JupyterNotebook as Created, type NotebookHandlers } from "./widget.ts";

/** Where the person was in the notebook, kept across the rebuild a run's new version causes. */
type Place = { scrollTop: number; activeCell: number };

/** The selected flow in JupyterLab's own notebook (ADR-0034). It is the same saved version the
 * canvas shows: Run saves the next version and runs it in sprisk's workers. */
export default function JupyterNotebookView() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const refs = [...new Set((pipeline?.nodes ?? []).filter((n) => !isCodeOperator(n.operator)).map((n) => n.operator))];
  const sources = useOperatorSources(refs);
  const place = useRef<Place>({ scrollTop: 0, activeCell: 0 });
  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending || sources.some((s) => s.isPending)) return <Loading text="Loading notebook…" pad />;
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;
  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  const code = new Map(refs.flatMap((ref, i) => (sources[i]?.data ? [[ref, sources[i].data.text] as const] : [])));
  const failed = sources.find((s) => s.isError)?.error;
  return (
    <>
      {failed && <p role="alert" className="error jp-banner">{failed.message}</p>}
      <Jupyter key={pipeline.id} pipeline={pipeline} operators={byRef} sources={code} latest={latestByNode(attempts.data ?? [])} selected={nodeId} place={place} />
    </>
  );
}

type Props = {
  pipeline: PipelineVersion;
  operators: Map<string, Operator>;
  /** Each built-in operator's code. */
  sources: Map<string, string>;
  latest: Map<string, Attempt>;
  selected: string | undefined;
  place: MutableRefObject<Place>;
};

function Jupyter({ pipeline, operators, sources, latest, selected, place }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [created, setCreated] = useState<Created | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const saved = useMemo(() => notebookSteps(pipeline, operators), [pipeline, operators]);
  const cells = useSaveCells(pipeline, operators);
  const selectNode = useSelection((s) => s.selectNode);
  const builtin = (node: PipelineVersion["nodes"][number]) => {
    const operator = operators.get(node.operator);
    const source = sources.get(node.operator);
    return operator && source !== undefined ? { source, function: operator.entrypoint.split(":")[1] ?? "" } : undefined;
  };

  // The notebook is a Lumino widget made once per version; its commands call the latest code.
  const handlers = useRef<NotebookHandlers>({ run: () => undefined, download: () => undefined });
  handlers.current = {
    run: () => {
      if (!created || cells.pending) return;
      setProblem(undefined);
      const read = readCells(created.notebook);
      const active = created.notebook.activeCellIndex;
      try {
        const { steps, functions } = fromCells(read, saved);
        place.current = { scrollTop: created.notebook.node.scrollTop, activeCell: active + 1 };
        void cells.save(steps, requestIndex(read, active), withCellCode(pipeline, steps, functions, builtin));
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
      }
    },
    download: () => {
      try {
        const url = URL.createObjectURL(new Blob([JSON.stringify(toIpynb(pipeline, operators, sources), null, 1)], { type: "application/x-ipynb+json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${pipeline.id}.ipynb`;
        link.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
      }
    },
  };

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    // The notebook lives in a box sprisk owns, so it can outlive React's host by one tick (see
    // the cleanup below).
    const box = document.createElement("div");
    box.className = "jp-box";
    node.append(box);
    const functions = new Map<string, FunctionCode>();
    for (const n of pipeline.nodes) {
      const operator = operators.get(n.operator);
      const code = n.code?.source ?? sources.get(n.operator);
      if (operator && code !== undefined && !isCodeOperator(n.operator)) functions.set(n.id, { source: code, editable: notEditable(operator) === undefined });
    }
    const made = createNotebook(toCells(saved, functions), { run: () => handlers.current.run(), download: () => handlers.current.download() });
    Widget.attach(made.notebook, box);
    // Capture, as JupyterLab does, so Shift+Enter reaches the command before the editor.
    const onKey = (e: KeyboardEvent) => made.commands.processKeydownEvent(e);
    node.addEventListener("keydown", onKey, true);
    made.notebook.activeCellIndex = Math.min(place.current.activeCell, made.notebook.widgets.length - 1);
    made.notebook.node.scrollTop = place.current.scrollTop;
    made.notebook.activeCellChanged.connect((_, cell) => {
      const tag = cell ? tagOf(cell.model.getMetadata("sprisk")) : undefined;
      if (tag) selectNode(tag.node);
    });
    setCreated(made);
    return () => {
      node.removeEventListener("keydown", onKey, true);
      // Lumino detaches only a widget that is in the page, and detaching unmounts the
      // notebook's own React parts, which React forbids during its commit. So park the box in
      // the page, out of sight, and detach after this render.
      box.hidden = true;
      document.body.append(box);
      setTimeout(() => {
        made.notebook.dispose();
        box.remove();
      });
    };
    // Made once: the component is keyed by version, and a new version makes a new notebook.
  }, []);

  // A step picked elsewhere (the canvas) becomes the active cell.
  useEffect(() => {
    if (!created || selected === undefined) return;
    const { notebook } = created;
    const active = notebook.activeCell ? tagOf(notebook.activeCell.model.getMetadata("sprisk")) : undefined;
    if (active?.node === selected) return;
    const index = notebook.widgets.findIndex((w) => {
      const tag = tagOf(w.model.getMetadata("sprisk"));
      return tag?.node === selected && tag.role !== "function";
    });
    if (index >= 0) notebook.activeCellIndex = index;
  }, [created, selected]);

  const shown = problem ?? cells.problem;
  return (
    <div className="jp-shell">
      {shown && <p role="alert" className="error jp-banner">{shown}</p>}
      {cells.notes.map((note, i) => (
        <p key={i} className="import-note jp-banner">
          {note}
        </p>
      ))}
      {created && <NotebookToolbar commands={created.commands} />}
      <div ref={host} className="jp-host jp-NotebookPanel" />
      {created &&
        saved.map((step) =>
          step.nodeId === undefined ? null : <StepOutputs key={step.nodeId} notebook={created.notebook} step={step} attempt={latest.get(step.nodeId)} operators={operators} pipeline={pipeline} />,
        )}
    </div>
  );
}

const readCells = (notebook: Notebook): ReadCell[] => (notebook.model?.sharedModel.cells ?? []).map((c) => ({ source: c.getSource(), metadata: c.getMetadata() }));

/** The cell's number in what POST /code/split receives: a built-in's code cell is not sent. */
function requestIndex(cells: ReadCell[], active: number): number {
  return cells.slice(0, active).filter((c) => tagOf(c.metadata["sprisk"])?.role !== "function").length;
}

function tagOf(value: unknown): CellTag | undefined {
  if (typeof value !== "object" || value === null || !("node" in value) || !("role" in value)) return undefined;
  return value as CellTag;
}

type StepProps = { notebook: Notebook; step: NotebookStep; attempt: Attempt | undefined; operators: Map<string, Operator>; pipeline: PipelineVersion };

/** Puts one step's run into its cells, as a kernel would: [n] or [*], and its outputs under its
 * last cell. Draws nothing itself. */
function StepOutputs({ notebook, step, attempt, operators, pipeline }: StepProps) {
  const done = hasOutputs(attempt) ? attempt : undefined;
  const isBuiltin = step.kind === "builtin";
  const display = useCodeDisplay(isBuiltin ? undefined : done);
  const printed = useConsole(isBuiltin ? done : undefined);
  const outputs = useOutputs(isBuiltin ? done?.id : undefined);
  const tables = (outputs.data ?? []).filter((o) => o.artifact.media_type === PARQUET);
  const figurePorts = isBuiltin ? (operators.get(pipeline.nodes.find((n) => n.id === step.nodeId)?.operator ?? "")?.outputs ?? []).filter((o) => o.kind === "figure").map((o) => o.name) : [];
  const [parts, setParts] = useState<Record<string, nbformat.IOutput[]>>({});
  const report = (key: string, out: nbformat.IOutput[]) =>
    setParts((p) => (JSON.stringify(p[key]) === JSON.stringify(out) ? p : { ...p, [key]: out }));

  let result: nbformat.IOutput[] = [];
  if (attempt?.error) result = [errorOutput(attempt.error)];
  else if (!isBuiltin) result = display.status === "ready" ? displayOutputs(display.value.items) : display.status === "error" ? [stderr(display.message)] : [];
  else {
    const texts = printed.status === "ready" ? displayOutputs(printed.value.items.filter((i) => i.kind === "text")) : printed.status === "error" ? [stderr(printed.message)] : [];
    const sizes = tables.flatMap((t) => parts[`table:${t.port}`] ?? []);
    const figures = figurePorts.flatMap((p) => parts[`figure:${p}`] ?? []);
    result = [...texts, ...(outputs.isError ? [stderr(outputs.error.message)] : []), ...sizes, ...figures];
  }
  const key = JSON.stringify(result);
  const live = attempt !== undefined && statusOf(attempt.state).tone === "live";

  useEffect(() => {
    const own = ownCells(notebook, step.nodeId ?? "");
    const last = own.at(-1);
    if (!last) return;
    for (const { model, number } of own) {
      model.executionCount = done ? number : null;
      model.executionState = live ? "running" : "idle";
    }
    last.model.outputs.clear();
    for (const output of result) last.model.outputs.add(output);
    // `key` holds every change to the outputs.
  }, [notebook, key, done?.id, live]);

  return (
    <>
      {tables.map((t) => (
        <TableSize key={t.port} name={`${step.nodeId}_${t.port}`} artifactId={t.artifact.id} report={(out) => report(`table:${t.port}`, out)} />
      ))}
      {figurePorts.map((port) => (
        <FigurePort key={port} attempt={done} port={port} report={(out) => report(`figure:${port}`, out)} />
      ))}
    </>
  );
}

const stderr = (text: string): nbformat.IStream => ({ output_type: "stream", name: "stderr", text: `${text}\n` });

/** A step's cells in the notebook now, with each one's number as Jupyter counts them. */
function ownCells(notebook: Notebook, nodeId: string): { model: ICodeCellModel; number: number }[] {
  const found: { model: ICodeCellModel; number: number }[] = [];
  let number = 0;
  for (const widget of notebook.widgets) {
    const tag = tagOf(widget.model.getMetadata("sprisk"));
    if (tag?.role === "function") continue;
    number += 1;
    if (tag?.node === nodeId && widget.model.type === "code") found.push({ model: widget.model as ICodeCellModel, number });
  }
  return found;
}

function TableSize({ name, artifactId, report }: { name: string; artifactId: string; report: (out: nbformat.IOutput[]) => void }) {
  const page = useTablePage(artifactId, 0, 1);
  const out = page.data ? [tableSizeOutput(name, page.data.total_rows, page.data.total_columns)] : page.isError ? [stderr(page.error.message)] : [];
  const key = JSON.stringify(out);
  useEffect(() => report(out), [key]);
  return null;
}

function FigurePort({ attempt, port, report }: { attempt: Attempt | undefined; port: string; report: (out: nbformat.IOutput[]) => void }) {
  const set = useFigureSet(attempt, port);
  const out =
    set.status === "ready"
      ? displayOutputs(set.value.items.map((figure) => ({ kind: "figure" as const, figure })))
      : set.status === "error"
        ? [stderr(set.message)]
        : set.status === "none" && attempt
          ? [stderr(set.reason)]
          : [];
  const key = JSON.stringify(out);
  useEffect(() => report(out), [key]);
  return null;
}

import type { Attempt, NotebookCell, NotebookCodeRequest, Operator, PipelineVersion } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";

import { plainCodeQuery, useCodeDisplay, useSplitCells } from "../../api/code.ts";
import { useOperators, useRunAgain, useRunAttempts, useSaveAndRun } from "../../api/hooks.ts";
import { readersOf, removeStep } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { nodeOf, outputName, splitRequest, versionFromSplit } from "../../flow/notebook.ts";
import { portOf, stepOf } from "../../flow/ports.ts";
import { type Stage, stepTitle } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useCollapsed } from "../../notebook/collapsed.ts";
import type { Ran } from "../../notebook/outputs.ts";
import { isReadyMade, newStepsIn, stageCells, stageEdits, stageNodes } from "../../notebook/stageCells.ts";
import { stepNames } from "../../notebook/stageNotebooks.ts";
import { ViewInstance } from "../../workbench/instance.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { AddIcon, RedoIcon, RunAllIcon, TrashIcon, UndoIcon } from "../Icons.tsx";
import { TabBody, useStep } from "../inspector/step.tsx";
import { OutputItems } from "./CellOutputs.tsx";
import { codeCellIds, NotebookCells, notebookKeys } from "./NotebookCells.tsx";
import { useCellEditing } from "./useCellEditing.ts";

const LIVE = new Set<Attempt["state"]>(["created", "validated", "queued", "leased", "running", "uploading"]);

/** One stage of the flow in the notebook editor (ADR-0055). The cells are the flow's steps,
 * read from the flow itself: a code step is its code, a ready-made step its settings form.
 * Running a cell saves the flow if its cells changed and runs it, reusing unchanged steps
 * (ADR-0026), so a cell's result is its step's result. There is no kernel. Mounted per flow
 * version: a save shows the new version's cells. */
export function StageNotebook({ pipeline, stage }: { pipeline: PipelineVersion; stage: Stage }) {
  const operators = useOperators();
  const byRef = new Map((operators.data ?? []).map((o) => [o.id, o]));
  const readyMade = operators.data ? stageNodes(pipeline, byRef, stage).filter((n) => isReadyMade(pipeline, n.id)) : [];
  const plain = useQueries({ queries: readyMade.map((n) => plainCodeQuery(n.operator, codeRequest(pipeline, byRef, n.id))) });
  if (operators.isError) return <p role="alert" className="error pad">Steps could not be read: {operators.error.message}</p>;
  const failed = plain.find((q) => q.isError)?.error;
  if (failed) return <p role="alert" className="error pad">A step's code could not be written: {failed.message}</p>;
  if (!operators.data || plain.some((q) => q.isPending)) return <Loading text="Loading the stage…" pad />;
  const code = new Map(readyMade.flatMap((n, i) => (plain[i]?.data ? [[n.id, plain[i].data] as const] : [])));
  return <StageEditor pipeline={pipeline} stage={stage} byRef={byRef} code={code} />;
}

/** What a ready-made step's plain Python is written from: its settings and the variables its
 * ports go by, as cells read and set them. */
function codeRequest(pipeline: PipelineVersion, byRef: Map<string, Operator>, nodeId: string): NotebookCodeRequest {
  const node = nodeOf(pipeline, nodeId);
  const inputs = Object.fromEntries(pipeline.edges.filter((e) => stepOf(e.to) === nodeId).map((e) => [portOf(e.to), outputName(pipeline, e.from)]));
  const ports = byRef.get(node.operator)?.outputs.map((o) => String(o.name)) ?? [];
  const outputs = Object.fromEntries(ports.map((p) => [p, outputName(pipeline, `${nodeId}.${p}`)]));
  return { settings: node.params, inputs, outputs };
}

/** The editor, made once the operators and the steps' code are known: its cells are read from
 * the flow once. */
function StageEditor({ pipeline, stage, byRef, code }: { pipeline: PipelineVersion; stage: Stage; byRef: Map<string, Operator>; code: Map<string, string> }) {
  const runId = useSelection((s) => s.runId);
  const showRun = useSelection((s) => s.showRun);
  const attempts = useRunAttempts(pipeline.id, runId);
  const edit = useCellEditing(stageCells(pipeline, byRef, stage, code), stage);
  const { cells, active } = edit;
  const foldKey = `stage:${stage}`;
  const toggleFold = useCollapsed((s) => s.toggle);
  const foldOutputs = useCollapsed((s) => s.setOutputsCollapsed);
  const split = useSplitCells();
  const saveAndRun = useSaveAndRun(runId);
  const runAgain = useRunAgain(runId);
  const [problem, setProblem] = useState<string>();
  const [notes, setNotes] = useState<string[]>([]);
  const [starting, setStarting] = useState<string>();
  const busy = split.isPending || saveAndRun.isPending || runAgain.isPending;

  /** Saves the cells as the next flow version when they changed, then runs it. */
  const save = async (now: NotebookCell[], show: string | undefined) => {
    setProblem(undefined);
    setStarting(show);
    try {
      // Cells as the flow has them: run it again, no new version.
      if (sameCells(now, stageCells(pipeline, byRef, stage, code))) {
        const run = await runAgain.mutateAsync(pipeline.id);
        return showRun(pipeline.id, run.id, show);
      }
      const edits = stageEdits(pipeline, byRef, stage, now, code);
      if ("refused" in edits) return setProblem(edits.refused);
      const request = splitRequest(edits.base, byRef, edits.steps);
      const found = await split.mutateAsync(request.cells);
      const made = versionFromSplit(edits.base, byRef, request, found);
      setNotes(made.notes);
      const version = newStepsIn(made.version, pipeline, stage);
      const run = await saveAndRun.mutateAsync(version);
      showRun(version.id, run.id, show);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(undefined);
    }
  };

  const runCell = (index: number, code: string, advance: boolean) => {
    const cell = cells[index];
    if (!cell) return;
    edit.setSource(index, code);
    if (cell.kind === "markdown") edit.stopEditing(cell.id);
    else if (!busy) void save(cells.map((c, i) => (i === index ? { ...c, source: code } : c)), cell.id);
    if (!advance) return;
    if (index === cells.length - 1) edit.insert(cells.length, "code");
    else edit.select(index + 1, { focus: true });
  };

  const remove = (index: number) => {
    const cell = cells[index];
    if (!cell) return;
    if (!pipeline.nodes.some((n) => n.id === cell.id)) {
      edit.removeAt(index);
      return;
    }
    const readers = readersOf(pipeline, cell.id);
    if (readers.length > 0) return setProblem(`Cannot delete ${cell.id}: ${[...new Set(readers)].join(", ")} read${readers.length === 1 ? "s" : ""} its output.`);
    const version = removeStep(pipeline, cell.id);
    saveAndRun.mutate(version, { onSuccess: (run) => showRun(version.id, run.id, undefined), onError: (e) => setProblem(e.message) });
  };

  const runAll = () => void save(cells, undefined);
  const onKeyDown = notebookKeys(edit, { onRun: runCell, onRemove: remove, onSave: runAll, foldKey, toggleFold });

  const latest = latestByNode(attempts.data ?? []);
  const runs = cellRuns(cells, latest, pipeline, code, starting);
  const cellPin = (nodeId: string) => ({ pipelineVersionId: pipeline.id, runId, nodeId });

  return (
    <div className="notebook" aria-label="Notebook">
      <div className="nb-toolbar" role="toolbar" aria-label="Notebook actions">
        <button type="button" className="nb-action" onClick={() => edit.insert(active + 1, "code")}>
          <AddIcon /> Code
        </button>
        <button type="button" className="nb-action" onClick={() => edit.insert(active + 1, "markdown")}>
          <AddIcon /> Markdown
        </button>
        <button type="button" className="nb-action" disabled={cells.length === 0} onClick={() => remove(active)} aria-label="Delete Cell" title="Delete selected cell (Delete / Backspace / dd)">
          <TrashIcon />
        </button>
        <span className="nb-divider" />
        <button type="button" className="nb-action" disabled={!edit.canUndo} onClick={edit.undo} aria-label="Undo" title="Undo cell action (Z / ⌘Z)">
          <UndoIcon />
        </button>
        <button type="button" className="nb-action" disabled={!edit.canRedo} onClick={edit.redo} aria-label="Redo" title="Redo cell action (⇧Z / ⌘⇧Z / ⌘Y)">
          <RedoIcon />
        </button>
        <span className="nb-divider" />
        <button type="button" className="nb-action" disabled={busy} onClick={runAll}>
          <RunAllIcon /> Run All
        </button>
        <button type="button" className="nb-action" aria-label="Collapse All Outputs" title="Collapse All Outputs" onClick={() => foldOutputs(foldKey, codeCellIds(cells), true)}>
          Collapse
        </button>
        <button type="button" className="nb-action" aria-label="Expand All Outputs" title="Expand All Outputs" onClick={() => foldOutputs(foldKey, codeCellIds(cells), false)}>
          Expand
        </button>
      </div>
      <div className="nb-scroll" onKeyDown={onKeyDown}>
        <div className="nb-title-row">
          <h2 className="nb-title">{stage}</h2>
          <span className="nb-kernel" title="Each cell is a step of the flow. Running a cell runs the flow, reusing the steps that did not change.">
            <span className={`nb-kernel-dot${busy || runs.running ? " busy" : ""}`} /> Flow · {busy || runs.running ? "running" : "idle"}
          </span>
        </div>
        {(problem ?? attempts.error?.message) && <p role="alert" className="error nb-message">{problem ?? attempts.error?.message}</p>}
        {notes.map((note, i) => (
          <p key={i} className="nb-message nb-note">{note}</p>
        ))}
        <NotebookCells
          edit={edit}
          runs={runs}
          foldKey={foldKey}
          onRun={runCell}
          onRunAbove={() => runAll()}
          onRemove={remove}
          stepOf={(cell) =>
            isReadyMade(pipeline, cell.id) && !code.has(cell.id) ? (
              <ViewInstance pin={cellPin(cell.id)} setPin={undefined}>
                <StepForm names={stepNames(pipeline, byRef, cell.id)} />
              </ViewInstance>
            ) : undefined
          }
          outputOf={(cell) =>
            hasOutputs(latest.get(cell.id)) ? (
              <ViewInstance pin={cellPin(cell.id)} setPin={undefined}>
                <StepOutput />
              </ViewInstance>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

/** Each step cell's state in the run on screen, as a kernel's result would show it. */
function cellRuns(cells: NotebookCell[], latest: Map<string, Attempt>, pipeline: PipelineVersion, code: Map<string, string>, starting: string | undefined) {
  const results: Record<string, Ran> = {};
  const live: string[] = [];
  cells.forEach((cell, index) => {
    const attempt = latest.get(cell.id);
    if (!attempt) return;
    if (LIVE.has(attempt.state)) return void live.push(cell.id);
    const node = pipeline.nodes.find((n) => n.id === cell.id);
    const ran = node && !isReadyMade(pipeline, cell.id) ? String(node.params["source"] ?? "") : (code.get(cell.id) ?? cell.source);
    const ok = attempt.state === "succeeded" || attempt.state === "cache_hit";
    results[cell.id] = {
      code: ran,
      result: ok
        ? { status: "ok", execution_count: index + 1, outputs: [] }
        : { status: attempt.state === "timed_out" ? "timed_out" : "error", outputs: [], error: { name: attempt.state, message: attempt.error?.message ?? attempt.state, traceback: [] } },
    };
  });
  const running = starting ?? live[0];
  return { results, running, queued: live.filter((id) => id !== running), live: undefined };
}

/** Equal but for empty cells the person added and never wrote in. */
const sameCells = (now: NotebookCell[], flow: NotebookCell[]) => {
  const written = now.filter((c) => c.source.trim() !== "" || flow.some((f) => f.id === c.id));
  return JSON.stringify(written.map((c) => [c.id, c.kind, c.source])) === JSON.stringify(flow.map((c) => [c.id, c.kind, c.source]));
};

/** A ready-made step's cell: what it reads and gives, its settings, and its code on request. */
function StepForm({ names }: { names: { reads: string[]; gives: string[] } }) {
  const step = useStep();
  const [showCode, setShowCode] = useState(false);
  if (!step.node) return <p role="alert" className="error">This step is not in the flow version on screen.</p>;
  if (!step.operator) return <p role="alert" className="error">{step.node.operator} is not installed, so this step cannot show its settings or run.</p>;
  return (
    <div className="flow-step">
      <p className="flow-step-head">
        <span className="flow-step-title">{stepTitle(step.node.operator)}</span>
        <span className="muted">{step.node.id}</span>
      </p>
      <p className="flow-step-names muted">{namesLine(names)}</p>
      <TabBody tab="parameters" step={step} />
      <button type="button" className="page-btn" aria-expanded={showCode} onClick={() => setShowCode(!showCode)}>
        {showCode ? "Hide code" : "Show code"}
      </button>
      {showCode && <TabBody tab="code" step={step} />}
    </div>
  );
}

/** What a step showed in the run on screen: a code step's output as a notebook shows it, a
 * ready-made step's figures or tables. */
function StepOutput() {
  const step = useStep();
  const display = useCodeDisplay(step.isCode ? step.done : undefined);
  if (step.isCode) {
    if (display.status === "ready") return <OutputItems items={display.value.items} />;
    if (display.status === "error") return <p role="alert" className="error">{display.message}</p>;
    return null;
  }
  return <TabBody tab={step.visuals > 0 ? "visuals" : "data"} step={step} />;
}

function namesLine({ reads, gives }: { reads: string[]; gives: string[] }): string {
  const read = reads.length > 0 ? `reads ${reads.join(", ")}` : "reads nothing";
  return gives.length > 0 ? `${read} → gives ${gives.join(", ")}` : read;
}

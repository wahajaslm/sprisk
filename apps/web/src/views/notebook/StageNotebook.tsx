import type { Attempt, NotebookCell, Operator, PipelineVersion } from "@sprisk/contracts";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";

import { plainCodeQuery, useCodeDisplay } from "../../api/code.ts";
import { useOperators, useRunAttempts } from "../../api/hooks.ts";
import { readersOf, removeStep } from "../../flow/edit.ts";
import { hasOutputs, latestByNode } from "../../flow/latest.ts";
import { type Stage, stepLabel } from "../../flow/stages.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { useCollapsed } from "../../notebook/collapsed.ts";
import type { Ran } from "../../notebook/outputs.ts";
import { codeRequest, isReadyMade, stageCells, stageNodes } from "../../notebook/stageCells.ts";
import { stepNames } from "../../notebook/stageNotebooks.ts";
import { ViewInstance } from "../../workbench/instance.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { Button } from "../../components/ui/Button.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { flowName } from "../../flow/labels.ts";
import { AddIcon, RedoIcon, TrashIcon, UndoIcon } from "../Icons.tsx";
import { TabBody, useStep } from "../inspector/step.tsx";
import { OutputItems } from "./CellOutputs.tsx";
import { codeCellIds, NotebookCells, notebookKeys } from "./NotebookCells.tsx";
import { useCellEditing } from "./useCellEditing.ts";
import { useStageSave } from "./useStageSave.ts";

const LIVE = new Set<Attempt["state"]>(["created", "validated", "queued", "leased", "running", "uploading"]);

/** One stage of the flow in the notebook editor (ADR-0055). The cells are the flow's steps,
 * read from the flow itself: a code step is its code, a ready-made step its settings form.
 * Running a cell saves the flow if its cells changed and runs it, reusing unchanged steps
 * (ADR-0026), so a cell's result is its step's result. There is no kernel. Mounted per flow
 * version: a save shows the new version's cells. */
export function StageNotebook({ pipeline, stage }: { pipeline: PipelineVersion; stage: Stage }) {
  const operators = useOperators();
  const byRef = new Map((operators.data ?? []).map((o) => [o.id, o]));
  // Only steps whose manifest names a writer have plain code to ask for.
  const writing = operators.data
    ? stageNodes(pipeline, byRef, stage).filter((n) => isReadyMade(pipeline, n.id) && byRef.get(n.operator)?.notebook_code !== undefined)
    : [];
  const plain = useQueries({ queries: writing.map((n) => plainCodeQuery(n.operator, codeRequest(pipeline, byRef, n.id))) });
  if (operators.isError) return <p role="alert" className="error pad">Steps could not be read: {operators.error.message}</p>;
  if (!operators.data || plain.some((q) => q.isPending)) return <Loading text="Loading the stage…" pad />;
  const code = new Map(writing.flatMap((n, i) => (plain[i]?.data ? [[n.id, plain[i].data] as const] : [])));
  // A step whose code could not be written shows why in its own cell, with its settings.
  const unwritten = new Map(writing.flatMap((n, i) => (plain[i]?.error ? [[n.id, plain[i].error.message] as const] : [])));
  return <StageEditor pipeline={pipeline} stage={stage} byRef={byRef} code={code} unwritten={unwritten} />;
}

/** The editor, made once the operators and the steps' code are known: its cells are read from
 * the flow once. */
function StageEditor({ pipeline, stage, byRef, code, unwritten }: { pipeline: PipelineVersion; stage: Stage; byRef: Map<string, Operator>; code: Map<string, string>; unwritten: Map<string, string> }) {
  const runId = useSelection((s) => s.runId);
  const attempts = useRunAttempts(pipeline.id, runId);
  const edit = useCellEditing(stageCells(pipeline, byRef, stage, code), stage);
  const { cells, active } = edit;
  const foldKey = `stage:${stage}`;
  const toggleFold = useCollapsed((s) => s.toggle);
  const foldOutputs = useCollapsed((s) => s.setOutputsCollapsed);
  const stageSave = useStageSave(pipeline, byRef, stage, code);
  const { busy, setProblem, notes } = stageSave;
  const problem = stageSave.problem;
  const [starting, setStarting] = useState<string>();
  const save = async (now: NotebookCell[], show: string | undefined) => {
    setStarting(show);
    await stageSave.save(now, show);
    setStarting(undefined);
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
    void stageSave.saveVersion(removeStep(pipeline, cell.id));
  };

  const runAll = () => void save(cells, undefined);
  const onKeyDown = notebookKeys(edit, { onRun: runCell, onRemove: remove, onSave: runAll, foldKey, toggleFold });

  const latest = latestByNode(attempts.data ?? []);
  const runs = cellRuns(cells, latest, pipeline, code, starting);
  const cellPin = (nodeId: string) => ({ pipelineVersionId: pipeline.id, runId, nodeId });

  return (
    <div className="notebook" aria-label="Notebook">
      <PageHeader
        eyebrow={`Notebook · ${flowName(pipeline)} · flow ${busy || runs.running ? "running" : "idle"}`}
        title={stage}
        description="Each cell is a step of the flow. Running a cell runs the flow, reusing the steps that did not change."
        actions={<Button variant="primary" disabled={busy} onClick={runAll}>Run all</Button>}
      />
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
        <button type="button" className="nb-action" aria-label="Collapse All Outputs" title="Collapse All Outputs" onClick={() => foldOutputs(foldKey, codeCellIds(cells), true)}>
          Collapse
        </button>
        <button type="button" className="nb-action" aria-label="Expand All Outputs" title="Expand All Outputs" onClick={() => foldOutputs(foldKey, codeCellIds(cells), false)}>
          Expand
        </button>
      </div>
      <div className="nb-scroll" onKeyDown={onKeyDown}>
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
          labelOf={(cell) => {
            const node = pipeline.nodes.find((n) => n.id === cell.id);
            return node && stepLabel(node);
          }}
          stepOf={(cell) =>
            isReadyMade(pipeline, cell.id) && !code.has(cell.id) ? (
              <ViewInstance pin={cellPin(cell.id)} setPin={undefined}>
                {unwritten.has(cell.id) && <p role="alert" className="error">{cell.id}'s code could not be written: {unwritten.get(cell.id)}</p>}
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
  cells.forEach((cell) => {
    const attempt = latest.get(cell.id);
    if (!attempt) return;
    if (LIVE.has(attempt.state)) return void live.push(cell.id);
    const node = pipeline.nodes.find((n) => n.id === cell.id);
    const ran = node && !isReadyMade(pipeline, cell.id) ? String(node.params["source"] ?? "") : (code.get(cell.id) ?? cell.source);
    const ok = attempt.state === "succeeded" || attempt.state === "cache_hit";
    results[cell.id] = {
      code: ran,
      result: ok
        ? { status: "ok", outputs: [] }
        : { status: attempt.state === "timed_out" ? "timed_out" : "error", outputs: [], error: { name: attempt.state, message: attempt.error?.message ?? attempt.state, traceback: [] } },
    };
  });
  const running = starting ?? live[0];
  return { results, running, queued: live.filter((id) => id !== running), live: undefined };
}

/** A ready-made step's cell: what it reads and gives, its settings, and its code on request. */
function StepForm({ names }: { names: { reads: string[]; gives: string[] } }) {
  const step = useStep();
  const [showCode, setShowCode] = useState(false);
  if (!step.node) return <p role="alert" className="error">This step is not in the flow version on screen.</p>;
  if (!step.operator) return <p role="alert" className="error">{step.node.operator} is not installed, so this step cannot show its settings or run.</p>;
  return (
    <div className="flow-step">
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

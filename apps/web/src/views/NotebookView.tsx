import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";

import { useOperators, useOperatorSources, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { isCodeOperator } from "../flow/edit.ts";
import { latestByNode, statusOf } from "../flow/latest.ts";
import {
  type CellAt,
  cellNumber,
  type NotebookStep,
  notebookSteps,
  toIpynb,
  withCell,
  withNewCell,
  withoutCell,
} from "../flow/notebook.ts";
import { roleOf } from "../flow/stages.ts";
import { useSelection } from "../workbench/selection.ts";
import { Loading } from "../components/ui/Loading.tsx";
import { CodeEditor } from "./CodeEditor.tsx";
import { CodeInput } from "./CodeInput.tsx";
import { OperatorCode } from "./inspector/OperatorCode.tsx";
import { PlayIcon } from "./Icons.tsx";
import { useSaveCells } from "./useSaveCells.ts";

/** The selected flow as notebook cells (ADR-0033). It is the same saved version the canvas
 * shows: every edit here saves the next version, and the canvas follows. */
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
  const steps = draft ?? notebookSteps(pipeline, operators);
  const cells = useSaveCells(pipeline, operators);
  const run = (next: NotebookStep[], at?: CellAt) => {
    if (!cells.pending) void cells.save(next, at ? cellNumber(next, at) : -1);
  };
  return (
    <div className="notebook" aria-label="Notebook">
      <div className="notebook-bar">
        <span className="muted">Each cell is a step of the flow · Shift+Enter runs · each run is saved as a new version</span>
        <span className="spacer" />
        {draft && (
          <>
            <button type="button" className="page-btn" onClick={() => setDraft(undefined)}>
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
      {cells.problem && <p role="alert" className="error">{cells.problem}</p>}
      {cells.notes.map((note, i) => (
        <p key={i} className="import-note">
          {note}
        </p>
      ))}
      <ol className="notebook-steps">
        {steps.map((step, i) => (
          <li key={step.nodeId ?? `new-${i}`} className={`notebook-step${step.nodeId !== undefined && step.nodeId === selected ? " selected" : ""}`}>
            <StepHead step={step} pipeline={pipeline} operators={operators} latest={latest} />
            {step.kind === "cells" ? (
              step.cells.map((cell, j) => {
                const at = { step: i, cell: j };
                const n = cellNumber(steps, at) + 1;
                return (
                  <div key={j} className="notebook-cell">
                    <span className="cell-number">[{n}]</span>
                    <CodeInput fit label={`Cell ${n}`} value={cell} onChange={(v) => setDraft(withCell(steps, at, v))} onRun={(v) => run(withCell(steps, at, v), at)} />
                    <div className="cell-actions">
                      <button type="button" className="page-btn" disabled={cells.pending} onClick={() => run(steps, at)}>
                        Run
                      </button>
                      <button type="button" className="page-btn" onClick={() => setDraft(withoutCell(steps, at))}>
                        Delete cell
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <OtherStep step={step} pipeline={pipeline} operators={operators} />
            )}
            <button type="button" className="page-btn notebook-add" aria-label={`Add a cell after ${step.nodeId ?? "this cell"}`} onClick={() => setDraft(withNewCell(steps, i))}>
              + Cell
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

type StepProps = { step: NotebookStep; pipeline: PipelineVersion; operators: Map<string, Operator> };

/** The step a cell belongs to: click to inspect it. Cells kept together say so. */
function StepHead({ step, pipeline, operators, latest }: StepProps & { latest: Map<string, Attempt> }) {
  const selectNode = useSelection((s) => s.selectNode);
  if (step.nodeId === undefined) return <p className="notebook-step-head">new step · runs when saved</p>;
  const operator = operators.get(pipeline.nodes.find((n) => n.id === step.nodeId)?.operator ?? "");
  const attempt = latest.get(step.nodeId);
  const status = attempt ? statusOf(attempt.state) : undefined;
  const together = step.kind === "cells" && step.cells.length > 1 ? ` · ${step.cells.length} cells run as one step` : "";
  return (
    <p className="notebook-step-head">
      <button type="button" onClick={() => selectNode(step.nodeId)}>
        {step.nodeId}
      </button>
      <span>
        {operator ? roleOf(operator) : "Step"}
        {together}
      </span>
      {status && <span className={`tone-${status.tone}`}>{status.text}</span>}
    </p>
  );
}

/** A built-in step: its call, and its code to read or edit (ADR-0028). A v1 code step: the
 * table it gets as `data`, and its code. */
function OtherStep({ step, pipeline, operators }: StepProps) {
  const [open, setOpen] = useState(false);
  const node = pipeline.nodes.find((n) => n.id === step.nodeId);
  const operator = operators.get(node?.operator ?? "");
  if (!node) return null;
  if (step.kind === "code") {
    return (
      <>
        <pre className="code notebook-call">data = {step.data ?? "None"}</pre>
        <CodeEditor pipeline={pipeline} nodeId={node.id} source={step.source} />
      </>
    );
  }
  if (step.kind !== "builtin") return null;
  return (
    <>
      <pre className="code notebook-call">{step.call}</pre>
      {operator && (
        // The editor is made only when opened: one per built-in step would be heavy.
        <details className="notebook-code" onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="menu-meta">{node.code ? "Code · edited in this flow" : "Code"}</summary>
          {open && <OperatorCode pipeline={pipeline} nodeId={node.id} operator={operator} />}
        </details>
      )}
    </>
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

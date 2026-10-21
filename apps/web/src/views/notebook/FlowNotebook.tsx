import type { PipelineVersion } from "@sprisk/contracts";
import { useState } from "react";
import Markdown from "react-markdown";

import { useOperators } from "../../api/hooks.ts";
import type { Stage } from "../../flow/stages.ts";
import { stepTitle } from "../../flow/stages.ts";
import { stageNotebooks, stepNames } from "../../notebook/stageNotebooks.ts";
import { ViewInstance } from "../../workbench/instance.tsx";
import { useSelection } from "../../workbench/selection.ts";
import { TabBody, useStep } from "../inspector/step.tsx";
import { stageDescription } from "../StageArtwork.tsx";
import { markdownUrl } from "./SessionNotebook.tsx";

/** One stage of the flow as a notebook (ADR-0055): each step is a cell, read from the flow
 * itself, so the canvas and the notebook show one record. A ready-made step is its settings
 * form; a code step is its code. Each cell shows its step's result in the run on screen. */
export function FlowNotebook({ pipeline, stage }: { pipeline: PipelineVersion; stage: Stage }) {
  const operators = useOperators();
  const runId = useSelection((s) => s.runId);
  const byRef = new Map((operators.data ?? []).map((o) => [o.id, o]));
  const nodes = stageNotebooks(pipeline, byRef).find((s) => s.stage === stage)?.nodes ?? [];
  return (
    <section className="nb-session flow-notebook" aria-label={`${stage} notebook`}>
      <header className="flow-notebook-head">
        <h2>{stage}</h2>
        <p className="muted">{stageDescription(stage)}</p>
      </header>
      <div className="nb-cells">
        {nodes.length === 0 && <p className="muted pad">This stage has no steps yet.</p>}
        {nodes.map((node, i) => (
          <ViewInstance key={`${pipeline.id}/${node.id}`} pin={{ runId, nodeId: node.id }} setPin={undefined}>
            {node.notes?.before?.map((text, k) => <Note key={`b${k}`} text={text} />)}
            <StepCell n={i + 1} names={stepNames(pipeline, byRef, node.id)} />
            {node.notes?.after?.map((text, k) => <Note key={`a${k}`} text={text} />)}
          </ViewInstance>
        ))}
      </div>
    </section>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className="nb-cell">
      <div className="nb-gutter" />
      <div className="nb-main nb-markdown">
        <Markdown urlTransform={markdownUrl}>{text}</Markdown>
      </div>
    </div>
  );
}

function StepCell({ n, names }: { n: number; names: { reads: string[]; gives: string[] } }) {
  const step = useStep();
  const [showCode, setShowCode] = useState(false);
  const { node, isCode, latest } = step;
  if (!node) return null;
  const title = isCode ? `Code · ${node.id}` : stepTitle(node.operator);
  const state = latest?.state;
  return (
    <article className="nb-cell flow-cell" aria-label={`Step ${node.id}`}>
      <div className="nb-gutter">
        <span className="nb-count">[{state === "succeeded" || state === "cache_hit" ? n : " "}]</span>
      </div>
      <div className="nb-main">
        <header className="flow-cell-head">
          <span className="flow-cell-title">{title}</span>
          {!isCode && <span className="muted">{node.id}</span>}
          <span className="spacer" />
          <span className={`flow-cell-state ${state ?? "none"}`}>{state ? state.replace("_", " ") : "not run"}</span>
        </header>
        <p className="flow-cell-names muted">{namesLine(names)}</p>
        <div className="nb-part">
          {isCode ? (
            <TabBody tab="code" step={step} />
          ) : !step.operator && step.operatorsById.size > 0 ? (
            <p role="alert" className="error">{node.operator} is not installed, so this step cannot show its settings or run.</p>
          ) : (
            <>
              <TabBody tab="parameters" step={step} />
              <button type="button" className="page-btn" aria-expanded={showCode} onClick={() => setShowCode(!showCode)}>
                {showCode ? "Hide code" : "Show code"}
              </button>
              {showCode && <TabBody tab="code" step={step} />}
            </>
          )}
        </div>
        {step.done && (
          <div className="nb-part flow-cell-output">
            <TabBody tab={step.visuals > 0 ? "visuals" : "data"} step={step} />
          </div>
        )}
      </div>
    </article>
  );
}

function namesLine({ reads, gives }: { reads: string[]; gives: string[] }): string {
  const read = reads.length > 0 ? `reads ${reads.join(", ")}` : "reads nothing";
  return gives.length > 0 ? `${read} → gives ${gives.join(", ")}` : read;
}

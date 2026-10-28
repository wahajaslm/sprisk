import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";

import type { RunChecks } from "../../api/checks.ts";
import { useFlowDecisions } from "../../api/walks.ts";
import { Fact } from "../../components/ui/Fact.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { hasOutputs, statusOf } from "../../flow/latest.ts";
import { readersOf } from "../../flow/edit.ts";
import { metricsPort, stepType } from "../../flow/stages.ts";
import { NodeFact } from "../NodeFact.tsx";
import { ChecksTab } from "./ChecksTab.tsx";
import { MethodDecision } from "./MethodDecision.tsx";

/** The design's Methodology tab grid: up to three columns that stack when the panel is narrow. */
const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: "20px 40px", alignItems: "start" } as const;
/** With only the step's facts, they keep one column's width instead of filling the panel. */
const ONE_COLUMN = { ...GRID, gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,240px),1fr))" } as const;
const COLUMN = { display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" } as const;
const LABEL = { fontSize: "12.5px", color: "var(--t-label,#959595)" } as const;


/** What the step is and what it measured: its type, what it does, and its facts. */
function StepFacts({ pipeline, nodeId, operator, latest }: { pipeline: PipelineVersion; nodeId: string; operator?: Operator | undefined; latest?: Attempt | undefined }) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const readers = readersOf(pipeline, nodeId).length;
  const status = latest ? statusOf(latest.state) : undefined;
  const metrics = operator ? metricsPort(operator) : undefined;
  return (
    <>
      <span style={LABEL}>{stepType(node, operator)}</span>
      {operator?.description && <span style={{ fontSize: "12.5px", color: "var(--t-muted,#ababab)", lineHeight: "1.5", textWrap: "pretty" }}>{operator.description}</span>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Fact k="Status" v={status?.text ?? "Not run"} warn={status?.tone === "bad"} />
        {latest && hasOutputs(latest) && <Fact k="Output" v={<NodeFact attemptId={latest.id} operator={node.operator} metricsPort={metrics} status="saved" />} />}
        <Fact k="Downstream" v={`${readers} ${readers === 1 ? "step" : "steps"}`} />
      </div>
    </>
  );
}

/** A step's methodology (ADR-0063): the step's own facts, then each method that shaped the
 * step on this flow, and the checks of the last run that cite it. */
export function MethodologyTab({ pipeline, nodeId, checks, operator, latest }: { pipeline: PipelineVersion; nodeId: string; checks: RunChecks; operator?: Operator | undefined; latest?: Attempt | undefined }) {
  const decided = useFlowDecisions(pipeline.id);
  const methods = (decided.data?.decisions ?? []).filter((d) => d.steps.includes(nodeId));
  if (!pipeline.nodes.some((n) => n.id === nodeId)) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {decided.isError && <p role="alert" className="error">The pipeline's decisions could not be read: {decided.error.message}</p>}
      {decided.isPending && <Loading />}
      <div style={ONE_COLUMN}>
        <div style={COLUMN}>
          <StepFacts pipeline={pipeline} nodeId={nodeId} operator={operator} latest={latest} />
          {decided.isSuccess && methods.length === 0 && <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", paddingTop: "4px" }}>No method decided this step.</span>}
        </div>
      </div>
      {methods.map((decision) => (
        <MethodDecision key={decision.decides} decision={decision} />
      ))}
      <ChecksTab run={checks} nodeId={nodeId} />
    </div>
  );
}

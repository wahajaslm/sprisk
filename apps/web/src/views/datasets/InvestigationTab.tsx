import type { Attempt, FlowDecision, FlowDecisions, LoadedTable, Operator, PipelineVersion, Report, ReportEvidence, Walk } from "@sprisk/contracts";
import { useState } from "react";

import { useOperatorsByRef, useOutputs, useRunAttempts } from "../../api/hooks.ts";
import { useQuestionVersions } from "../../api/questions.ts";
import { useFlowDecisionsOf, useWalk, useWalkReport } from "../../api/walks.ts";
import { Button } from "../../components/ui/Button.tsx";
import { ListRow } from "../../components/ui/ListRow.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { BodySection } from "../../components/ui/RowList.tsx";
import { latestByNode } from "../../flow/latest.ts";
import { useSelection } from "../../workbench/selection.ts";
import { FigurePort } from "../inspector/FiguresTab.tsx";
import { TAKEN } from "../inspector/MethodDecision.tsx";
import { PromiseList } from "../PromiseList.tsx";
import { when } from "../when.ts";

/** Flow versions whose decisions are read for one table. */
const MAX_VERSIONS = 20;

/** One walk that loaded the table: the flow version and run that show its decisions. */
type Investigation = { walkId: string; pipelineVersionId: string; runId: string; decisions: FlowDecision[] };

/** The investigations that used a table, each as its decisions and its report (ADR-0065). A
 * view over records: it decides nothing and runs nothing. */
export function InvestigationTab({ dataset, versions }: { dataset: LoadedTable; versions: PipelineVersion[] }) {
  const [picked, setPicked] = useState<string>();
  const all = [...new Set(dataset.used_by.map((u) => u.pipeline_version_id))];
  // One request per version: a bounded number, said on screen when more load the table.
  const ids = all.slice(0, MAX_VERSIONS);
  const read = useFlowDecisionsOf(ids);
  const failed = read.find((r) => r.isError);
  if (failed?.error) return <p role="alert" className="error">The decisions could not be read: {failed.error.message}</p>;
  if (read.some((r) => r.isPending)) return <Loading text="Reading the investigations…" />;
  const found = investigations(dataset, read.flatMap((r) => (r.data ? [r.data] : [])));
  if (found.length === 0)
    return <p className="muted">No investigation has used this table yet. Start one on the Objective page; its findings and decisions show here.</p>;
  const current = found.find((i) => i.walkId === picked) ?? found[0]!;
  return (
    <div className="ds-investigation">
      {all.length > ids.length && <p className="muted">{`Showing the investigations of the first ${ids.length} of ${all.length} flow versions that load this table.`}</p>}
      {found.length > 1 && (
        <div role="list" aria-label="Investigations" className="ds-investigations">
          {found.map((i) => (
            <div key={i.walkId} role="listitem">
              <WalkRow investigation={i} selected={i === current} onPick={() => setPicked(i.walkId)} />
            </div>
          ))}
        </div>
      )}
      <InvestigationView key={current.walkId} dataset={dataset} investigation={current} pipeline={versions.find((v) => v.id === current.pipelineVersionId)} />
    </div>
  );
}

/** Each walk once, shown on the use whose version carries the most of its decisions. A walk's
 * later versions keep every earlier decision, so that is the furthest one a run loaded. */
function investigations(dataset: LoadedTable, decided: FlowDecisions[]): Investigation[] {
  const byWalk = new Map<string, Investigation>();
  for (const use of dataset.used_by) {
    const flow = decided.find((d) => d.pipeline_version_id === use.pipeline_version_id);
    if (!flow?.walk_id) continue;
    const seen = byWalk.get(flow.walk_id);
    if (seen && seen.decisions.length >= flow.decisions.length) continue;
    byWalk.set(flow.walk_id, { walkId: flow.walk_id, pipelineVersionId: use.pipeline_version_id, runId: use.run_id, decisions: flow.decisions });
  }
  // Walk ids are ULIDs, so the newest walk sorts first.
  return [...byWalk.values()].sort((a, b) => b.walkId.localeCompare(a.walkId));
}

/** One walk in the list: when it started, how many decisions it made, and where it is. */
function WalkRow({ investigation, selected, onPick }: { investigation: Investigation; selected: boolean; onPick: () => void }) {
  const walk = useWalk(investigation.walkId).data?.walk;
  const n = investigation.decisions.length;
  const decisions = n === 0 ? "no decision yet" : `${n} ${n === 1 ? "decision" : "decisions"}`;
  return (
    <ListRow
      title={walk ? `Walk · ${when(walk.created_at)}` : `Walk ${investigation.walkId.slice(-6)}`}
      meta={walk ? `${decisions} · ${walkState(walk)}` : decisions}
      selected={selected}
      onClick={onPick}
    />
  );
}

function InvestigationView({ dataset, investigation, pipeline }: { dataset: LoadedTable; investigation: Investigation; pipeline: PipelineVersion | undefined }) {
  const walk = useWalk(investigation.walkId);
  const questions = useQuestionVersions();
  const operators = useOperatorsByRef();
  const attempts = useRunAttempts(investigation.pipelineVersionId, investigation.runId);
  const stopped = walk.data?.walk;
  const report = useWalkReport(stopped?.stop?.reason === "complete" ? investigation.walkId : undefined);
  const question = report.data?.question ?? questions.data?.find((q) => q.id === stopped?.question_version_id)?.objective.value;
  const latest = latestByNode(attempts.data ?? []);
  const operatorOf = (step: string) => {
    const node = pipeline?.nodes.find((n) => n.id === step);
    return node ? operators.data?.get(node.operator) : undefined;
  };
  return (
    <>
      <dl role="group" aria-label="Investigation context" className="ds-context">
        <div>
          <dt>Dataset</dt>
          <dd>{dataset.name}</dd>
        </div>
        <div>
          <dt>Investigation</dt>
          <dd>{question ?? `Walk ${investigation.walkId.slice(-6)}`}</dd>
        </div>
        <div>
          <dt>Walk</dt>
          <dd>{stopped ? walkState(stopped) : "…"}</dd>
        </div>
      </dl>
      {walk.isError && <p role="alert" className="error">The walk could not be read: {walk.error.message}</p>}
      <BodySection title="Analyses" note="One per question a method answered: what it read, how it was interpreted, what was decided, and whether its promises hold on this version.">
        {investigation.decisions.map((d) => (
          <Analysis key={d.decides} decision={d} investigation={investigation} operatorOf={operatorOf} latest={latest} />
        ))}
      </BodySection>
      <ReportSection walk={stopped} report={report.data} failure={report.error?.message} />
    </>
  );
}

const walkState = (walk: Walk) => (walk.stop ? walk.stop.reason.replaceAll("_", " ") : "walking");

/** One decision as the specification's connected analysis: the chart its producer drew first,
 * then which rows were read, the interpretation, the decision and its promises. */
function Analysis({
  decision,
  investigation,
  operatorOf,
  latest,
}: {
  decision: FlowDecision;
  investigation: Investigation;
  operatorOf: (step: string) => Operator | undefined;
  latest: Map<string, Attempt>;
}) {
  const showRun = useSelection((s) => s.showRun);
  const setNav = useSelection((s) => s.setNav);
  const charts = decision.steps.flatMap((step) =>
    (operatorOf(step)?.outputs ?? []).filter((o) => o.kind === "figure").map((o) => ({ step, port: o.name })),
  );
  const read = decision.steps.flatMap((step) => {
    const operator = operatorOf(step);
    const words = operator && scopeWords(operator);
    return words ? [`${operator.title} ${words}`] : [];
  });
  const first = decision.steps[0];
  return (
    <article className="ds-analysis" aria-label={decision.question}>
      <header className="ds-analysis-head">
        <p className="rd-label">{decision.activity}</p>
        <h3 className="rd-title">{decision.question}</h3>
      </header>
      {charts.length > 0 && (
        <div className="ds-analysis-charts">
          {charts.map((c) => (
            <AnalysisChart key={`${c.step}:${c.port}`} attempt={latest.get(c.step)} port={c.port} />
          ))}
        </div>
      )}
      <dl className="ds-analysis-facts">
        {read.length > 0 && (
          <div>
            <dt>Read</dt>
            <dd>
              {read.map((r) => (
                <span key={r} className="ds-line">
                  {r}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>Interpretation</dt>
          <dd>{decision.reason}</dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>
            <span className="ds-line">{decision.label}</span>
            <span className="rd-tag">{TAKEN[decision.assurance]}</span>
          </dd>
        </div>
        {decision.steps.length === 0 && (
          <div>
            <dt>Effect</dt>
            <dd>Leaves the flow unchanged.</dd>
          </div>
        )}
      </dl>
      <PromiseList promises={decision.promises} />
      {first && (
        <div className="ds-analysis-actions">
          <Button
            size="sm"
            onClick={() => {
              showRun(investigation.pipelineVersionId, investigation.runId, first);
              setNav("Flow");
            }}
          >
            Open in flow
          </Button>
        </div>
      )}
    </article>
  );
}

/** A producer's chart, when its run drew one. A run from before the producer drew charts
 * has no such output, and an empty frame would only say so. */
function AnalysisChart({ attempt, port }: { attempt: Attempt | undefined; port: string }) {
  const outputs = useOutputs(attempt?.id);
  if (outputs.isError) return <p role="alert" className="error">The step's outputs could not be read: {outputs.error.message}</p>;
  if (!outputs.data?.some((o) => o.port === port)) return null;
  return (
    <figure className="result-tile plot">
      <FigurePort attempt={attempt} port={port} />
    </figure>
  );
}

/** Which rows an evidence producer read, from its manifest. A step that is not a producer has
 * none to say. */
function scopeWords(operator: Operator): string | undefined {
  if (!operator.attach) return undefined;
  if (operator.attach.side === "output") return "read what the split wrote.";
  return operator.scope === "train" ? "read the training rows only." : "read every row, before the split.";
}

function ReportSection({ walk, report, failure }: { walk: Walk | undefined; report: Report | undefined; failure: string | undefined }) {
  if (!walk) return null;
  if (walk.stop?.reason !== "complete") {
    const why = walk.stop ? `The walk stopped: ${walk.stop.detail}` : "The walk is still walking.";
    return (
      <BodySection title="Report">
        <p className="muted">No report yet. {why}</p>
      </BodySection>
    );
  }
  if (failure) return <p role="alert" className="error">The report could not be read: {failure}</p>;
  if (!report) return <Loading text="Reading the report…" />;
  return (
    <BodySection title="Report" note="Built from the walk's records, never written by a model. It does not change once saved.">
      <p className="ds-answer">{report.answer.statement}</p>
      <ul className="ds-claims" aria-label="Claims">
        {report.claims.map((c) => (
          <li key={c.statement}>
            <span className="ds-line">{c.statement}</span>
            <small className="mono muted">{c.evidence.map(evidenceWords).join(" · ")}</small>
          </li>
        ))}
      </ul>
      <p className="rd-label">Limitations</p>
      <ul className="ds-limitations" aria-label="Limitations">
        {report.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </BodySection>
  );
}

function evidenceWords(e: ReportEvidence): string {
  if ("decision" in e) return `decision ${e.decision}`;
  if ("run" in e) return `run ${e.run}`;
  if ("pipeline_version" in e) return `version ${e.pipeline_version}`;
  return `walk step ${e.walk_step.round}`;
}
